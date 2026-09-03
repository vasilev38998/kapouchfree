import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { randomInt, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const SMSRU_API_ID = process.env.SMSRU_API_ID || '';
const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const otpStore = new Map();
const sessions = new Map();

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  if (digits.length === 10) return `7${digits}`;
  return '';
}

function hashOtp(phone, code) {
  return createHash('sha256').update(`${phone}:${code}`).digest();
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map(v => v.trim()).filter(Boolean).map(v => {
    const i = v.indexOf('=');
    return [decodeURIComponent(v.slice(0, i)), decodeURIComponent(v.slice(i + 1))];
  }));
}

async function sendSms(phone, code) {
  if (!SMSRU_API_ID) {
    console.log(`[DEV OTP] +${phone}: ${code}`);
    return { dev: true };
  }
  const endpoint = new URL('https://sms.ru/sms/send');
  endpoint.searchParams.set('api_id', SMSRU_API_ID);
  endpoint.searchParams.set('to', phone);
  endpoint.searchParams.set('msg', `Vibe: код входа ${code}. Никому его не сообщайте.`);
  endpoint.searchParams.set('json', '1');
  const response = await fetch(endpoint);
  const data = await response.json();
  if (Number(data.status) !== 1) throw new Error(data.status_text || 'SMS.RU request failed');
  return data;
}

function requireSameOrigin(req) {
  const origin = req.headers.origin;
  return !origin || origin === APP_ORIGIN;
}

async function handleApi(req, res, url) {
  if (!requireSameOrigin(req)) return json(res, 403, { error: 'origin_not_allowed' });

  if (req.method === 'POST' && url.pathname === '/api/auth/request-code') {
    let payload;
    try { payload = await bodyJson(req); } catch { return json(res, 400, { error: 'invalid_json' }); }
    const phone = normalizePhone(payload.phone);
    if (!phone) return json(res, 400, { error: 'invalid_phone' });

    const existing = otpStore.get(phone);
    const now = Date.now();
    if (existing && now - existing.sentAt < OTP_RESEND_MS) {
      return json(res, 429, { error: 'too_many_requests', retryAfter: Math.ceil((OTP_RESEND_MS - (now - existing.sentAt)) / 1000) });
    }

    const code = String(randomInt(100000, 1000000));
    try {
      await sendSms(phone, code);
      otpStore.set(phone, { hash: hashOtp(phone, code), expiresAt: now + OTP_TTL_MS, sentAt: now, attempts: 0 });
      return json(res, 200, { ok: true, phone: `+${phone}`, expiresIn: OTP_TTL_MS / 1000, devMode: !SMSRU_API_ID });
    } catch (error) {
      console.error(error);
      return json(res, 502, { error: 'sms_delivery_failed' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/verify-code') {
    let payload;
    try { payload = await bodyJson(req); } catch { return json(res, 400, { error: 'invalid_json' }); }
    const phone = normalizePhone(payload.phone);
    const code = String(payload.code || '').replace(/\D/g, '');
    const record = otpStore.get(phone);
    if (!phone || code.length !== 6 || !record) return json(res, 400, { error: 'invalid_code' });
    if (Date.now() > record.expiresAt) {
      otpStore.delete(phone);
      return json(res, 400, { error: 'code_expired' });
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      otpStore.delete(phone);
      return json(res, 429, { error: 'too_many_attempts' });
    }

    record.attempts += 1;
    const candidate = hashOtp(phone, code);
    if (!timingSafeEqual(record.hash, candidate)) return json(res, 400, { error: 'invalid_code' });

    otpStore.delete(phone);
    const sessionId = randomUUID();
    sessions.set(sessionId, { phone, createdAt: Date.now() });
    return json(res, 200, { ok: true, user: { phone: `+${phone}` } }, {
      'set-cookie': `vibe_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/me') {
    const sessionId = parseCookies(req).vibe_session;
    const session = sessions.get(sessionId);
    if (!session) return json(res, 401, { authenticated: false });
    return json(res, 200, { authenticated: true, user: { phone: `+${session.phone}` } });
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    const sessionId = parseCookies(req).vibe_session;
    if (sessionId) sessions.delete(sessionId);
    return json(res, 200, { ok: true }, { 'set-cookie': 'vibe_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  return json(res, 404, { error: 'not_found' });
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const safe = normalize(requested).replace(/^([.][.][/\\])+/, '');
  const filePath = join(process.cwd(), safe);
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'content-type': mime[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, APP_ORIGIN);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  return serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Vibe running on ${APP_ORIGIN}`);
  if (!SMSRU_API_ID) console.log('SMSRU_API_ID is not set: OTP codes will be printed to the server console.');
});
