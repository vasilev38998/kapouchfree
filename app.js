const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const stories = ['Добавить','Аня','Дмитрий','Мария','Илья','Саша','Вика','Егор'];
const posts = [
  {id:1,name:'Алексей Морозов',handle:'@alex.moroz',time:'2 ч назад',initials:'АМ',text:'Иногда нужно просто остановиться и насладиться моментом ✨',image:'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',likes:128,comments:24,shares:7},
  {id:2,name:'Анна Смирнова',handle:'@anna.smirnova',time:'5 ч назад',initials:'АС',text:'Маленькие шаги каждый день приводят к большим результатам.',image:'https://images.unsplash.com/photo-1499750310107-5fef28a66643?auto=format&fit=crop&w=1200&q=80',likes:96,comments:18,shares:4}
];
const people = [
  ['Ирина Волкова','@irina.volkova','ИВ'],['Никита Лебедев','@nik.lebe','НЛ'],['Полина Козлова','@polina.koz','ПК']
];
const communities = [
  ['Путешествия','125K участников','П'],['Фотография','98K участников','Ф'],['Книги и мысли','76K участников','К']
];

function renderStories(){
  $('#stories').innerHTML = stories.map((name,i)=>`<div class="story ${i===0?'add':''}"><div class="story-ring"><div>${i===0?'＋':name.slice(0,1)}</div></div><span>${name}</span></div>`).join('');
}

function renderFeed(items = posts){
  $('#feed').innerHTML = items.map(p=>`<article class="post" data-id="${p.id}">
    <div class="post-head"><div class="avatar">${p.initials}</div><div class="post-user"><strong>${p.name}</strong><span>${p.handle} · ${p.time}</span></div><button class="more">•••</button></div>
    <p class="post-text">${escapeHtml(p.text)}</p>
    ${p.image?`<img class="post-image" src="${p.image}" alt="Публикация ${p.name}">`:''}
    <div class="post-actions"><button class="like">♡ <span>${p.likes}</span></button><button>▢ ${p.comments}</button><button>↗ ${p.shares}</button><button class="save">⌑</button></div>
  </article>`).join('');
}

function renderSidebars(){
  $('#events').innerHTML = `<div class="event"><div class="date-box"><strong>12</strong><span>ИЮН</span></div><div><p>Концерт группы «Свет»</p><small>19:00 · Москва</small></div></div><div class="event"><div class="date-box"><strong>18</strong><span>ИЮН</span></div><div><p>Выставка современного искусства</p><small>12:00 · ЦСИ Винзавод</small></div></div>`;
  $('#people').innerHTML = people.map(p=>`<div class="person"><div class="avatar">${p[2]}</div><div><strong>${p[0]}</strong><span>${p[1]}</span></div><button class="follow">Подписаться</button></div>`).join('');
  $('#communities').innerHTML = communities.map(c=>`<div class="community"><div class="avatar">${c[2]}</div><div><strong>${c[0]}</strong><span>${c[1]}</span></div><button>＋</button></div>`).join('');
}

function openComposer(){ $('#composerModal').showModal(); }
$('#openComposer').addEventListener('click', openComposer);
$('#composerPlaceholder').addEventListener('click', openComposer);
$('#mobileCreate').addEventListener('click', openComposer);

$('#postForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  const data = new FormData(e.target);
  posts.unshift({
    id:Date.now(),name:'Екатерина',handle:'@kate_light',time:'только что',initials:'ЕК',
    text:data.get('text'),image:data.get('image'),likes:0,comments:0,shares:0
  });
  renderFeed(posts);
  e.target.reset();
  $('#composerModal').close();
  toast('Пост опубликован');
});

document.addEventListener('click',(e)=>{
  const like = e.target.closest('.like');
  if(like){
    const article = like.closest('.post');
    const post = posts.find(p=>String(p.id)===article.dataset.id);
    const on = like.classList.toggle('liked');
    post.likes += on ? 1 : -1;
    like.innerHTML = `${on?'♥':'♡'} <span>${post.likes}</span>`;
  }
  const follow = e.target.closest('.follow');
  if(follow){
    const on = follow.classList.toggle('following');
    follow.textContent = on ? 'Вы подписаны' : 'Подписаться';
  }
});

$('#themeToggle').addEventListener('click',()=>{
  document.body.classList.toggle('dark');
  $('#themeToggle span').textContent = document.body.classList.contains('dark') ? 'Светлая тема' : 'Тёмная тема';
});

$('#searchInput').addEventListener('input',(e)=>{
  const q = e.target.value.trim().toLowerCase();
  renderFeed(!q ? posts : posts.filter(p=>`${p.name} ${p.handle} ${p.text}`.toLowerCase().includes(q)));
});

$$('.feed-tabs button').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.feed-tabs button').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');
  toast(`Раздел «${btn.textContent}» открыт`);
}));

$$('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
  $$('.nav-item').forEach(x=>x.classList.remove('active'));
  btn.classList.add('active');
  toast(`${btn.dataset.view}: экран будет подключён следующим этапом`);
}));

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(text){
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),1800);
}

renderStories();
renderFeed();
renderSidebars();