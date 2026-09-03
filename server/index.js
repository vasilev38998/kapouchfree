import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';
import { getEventsAfter, latestCursor, publishEvent } from './realtime.js';

const PORT = Number(process.env.PORT || 3000);
const SMSRU_API_ID = process.env.SMSRU_API_ID || '';
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const IP_WINDOW_MS = 15 * 60 * 1000;
const IP_MAX_SENDS = 8;

const otpStore = new Map();
const sessions = new Map();
const ipRate = new Map();

const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'};

function json(res,status,body,extraHeaders={}){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...extraHeaders});res.end(JSON.stringify(body));}
async function bodyJson(req){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw new Error('body_too_large');chunks.push(chunk)}if(!chunks.length)return{};return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
function normalizePhone(value){const digits=String(value||'').replace(/\D/g,'');if(digits.length===11&&digits.startsWith('8'))return`7${digits.slice(1)}`;if(digits.length===11&&digits.startsWith('7'))return digits;if(digits.length===10)return`7${digits}`;return'';}
function hashOtp(phone,code){return createHash('sha256').update(`${phone}:${code}`).digest();}
function parseCookies(req){const raw=req.headers.cookie||'';return Object.fromEntries(raw.split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return[decodeURIComponent(v.slice(0,i)),decodeURIComponent(v.slice(i+1))]}));}
function requestIp(req){return(req.socket.remoteAddress||'').replace(/^::ffff:/,'')||'unknown';}
function getSession(req){const id=parseCookies(req).vibe_session;return id?sessions.get(id):null;}
function checkIpRate(ip){const now=Date.now();const recent=(ipRate.get(ip)||[]).filter(ts=>now-ts<IP_WINDOW_MS);if(recent.length>=IP_MAX_SENDS){ipRate.set(ip,recent);return false}recent.push(now);ipRate.set(ip,recent);return true;}

async function sendSms(phone,code,ip){
  if(!SMSRU_API_ID){console.log(`[DEV OTP] +${phone}: ${code}`);return{dev:true};}
  const form=new URLSearchParams({api_id:SMSRU_API_ID,to:phone,msg:`Vibe: код входа ${code}. Никому его не сообщайте.`,json:'1'});
  if(ip&&ip!=='unknown')form.set('ip',ip);
  const response=await fetch('https://sms.ru/sms/send',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form});
  if(!response.ok)throw new Error(`SMS.RU HTTP ${response.status}`);
  const data=await response.json();const item=data.sms?.[phone];
  if(data.status!=='OK'||Number(data.status_code)!==100||!item||item.status!=='OK')throw new Error(item?.status_text||data.status_text||'SMS.RU request failed');
  return data;
}
function requireSameOrigin(req){const origin=req.headers.origin;return!origin||origin===APP_ORIGIN;}

async function handleApi(req,res,url){
  if(!requireSameOrigin(req))return json(res,403,{error:'origin_not_allowed'});

  if(req.method==='POST'&&url.pathname==='/api/auth/request-code'){
    let payload;try{payload=await bodyJson(req)}catch{return json(res,400,{error:'invalid_json'})}
    const phone=normalizePhone(payload.phone);if(!phone)return json(res,400,{error:'invalid_phone'});
    const ip=requestIp(req);if(!checkIpRate(ip))return json(res,429,{error:'ip_rate_limited'});
    const existing=otpStore.get(phone),now=Date.now();
    if(existing&&now-existing.sentAt<OTP_RESEND_MS)return json(res,429,{error:'too_many_requests',retryAfter:Math.ceil((OTP_RESEND_MS-(now-existing.sentAt))/1000)});
    const code=String(randomInt(100000,1000000));
    try{await sendSms(phone,code,ip);otpStore.set(phone,{hash:hashOtp(phone,code),expiresAt:now+OTP_TTL_MS,sentAt:now,attempts:0});return json(res,200,{ok:true,phone:`+${phone}`,expiresIn:OTP_TTL_MS/1000,devMode:!SMSRU_API_ID});}
    catch(error){console.error('SMS delivery failed:',error.message);return json(res,502,{error:'sms_delivery_failed'});}
  }

  if(req.method==='POST'&&url.pathname==='/api/auth/verify-code'){
    let payload;try{payload=await bodyJson(req)}catch{return json(res,400,{error:'invalid_json'})}
    const phone=normalizePhone(payload.phone),code=String(payload.code||'').replace(/\D/g,''),record=otpStore.get(phone);
    if(!phone||code.length!==6||!record)return json(res,400,{error:'invalid_code'});
    if(Date.now()>record.expiresAt){otpStore.delete(phone);return json(res,400,{error:'code_expired'});}
    if(record.attempts>=OTP_MAX_ATTEMPTS){otpStore.delete(phone);return json(res,429,{error:'too_many_attempts'});}
    record.attempts+=1;const candidate=hashOtp(phone,code);if(!timingSafeEqual(record.hash,candidate))return json(res,400,{error:'invalid_code'});
    otpStore.delete(phone);const sessionId=randomUUID();sessions.set(sessionId,{phone,createdAt:Date.now()});
    publishEvent({type:'account.session_started',recipientPhone:phone,payload:{title:'Добро пожаловать в Vibe',text:'Авторизация выполнена успешно.'}});
    return json(res,200,{ok:true,user:{phone:`+${phone}`},realtimeCursor:latestCursor()},{'set-cookie':`vibe_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`});
  }

  if(req.method==='GET'&&url.pathname==='/api/auth/me'){
    const session=getSession(req);if(!session)return json(res,401,{authenticated:false});
    return json(res,200,{authenticated:true,user:{phone:`+${session.phone}`},realtimeCursor:latestCursor()});
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){
    const sessionId=parseCookies(req).vibe_session;if(sessionId)sessions.delete(sessionId);
    return json(res,200,{ok:true},{'set-cookie':'vibe_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'});
  }

  if(req.method==='GET'&&url.pathname==='/api/realtime/events'){
    const session=getSession(req);if(!session)return json(res,401,{error:'unauthorized'});
    const cursor=Number(url.searchParams.get('cursor')||0);
    const events=getEventsAfter(cursor,session.phone);
    const nextCursor=events.length?events[events.length-1].id:Math.max(cursor,latestCursor());
    return json(res,200,{events,nextCursor,transport:'adaptive-polling'});
  }

  if(req.method==='POST'&&url.pathname==='/api/realtime/demo'){
    const session=getSession(req);if(!session)return json(res,401,{error:'unauthorized'});
    const event=publishEvent({type:'notification.demo',recipientPhone:session.phone,payload:{title:'Новое уведомление',text:'Realtime-канал работает.'}});
    return json(res,201,{ok:true,event});
  }

  return json(res,404,{error:'not_found'});
}

async function serveStatic(req,res,url){const requested=url.pathname==='/'?'/index.html':url.pathname;const safe=normalize(requested).replace(/^([/\\])+/,'').replace(/^([.][.][/\\])+/,'');const filePath=join(process.cwd(),safe);try{const data=await readFile(filePath);res.writeHead(200,{'content-type':mime[extname(filePath)]||'application/octet-stream','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'});res.end(data)}catch{res.writeHead(404,{'content-type':'text/plain; charset=utf-8'});res.end('Not found')}}
const server=http.createServer(async(req,res)=>{const url=new URL(req.url,APP_ORIGIN);if(url.pathname.startsWith('/api/'))return handleApi(req,res,url);return serveStatic(req,res,url)});
server.listen(PORT,()=>{console.log(`Vibe running on ${APP_ORIGIN}`);if(!SMSRU_API_ID)console.log('SMSRU_API_ID is not set: OTP codes will be printed to the server console.');});
