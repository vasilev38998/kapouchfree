(() => {
  let cursor = 0;
  let timer = null;
  let running = false;
  let unread = 0;
  const items = [];
  const bell = document.querySelector('.top-actions button:nth-child(2)');
  if (!bell) return;

  bell.id = 'notificationsButton';
  bell.setAttribute('aria-label', 'Уведомления');
  const panel = document.createElement('section');
  panel.className = 'notifications-panel';
  panel.hidden = true;
  panel.innerHTML = '<div class="notifications-head"><strong>Уведомления</strong><button type="button" data-close>×</button></div><div class="notifications-list"><p class="notifications-empty">Новых уведомлений пока нет</p></div>';
  document.body.append(panel);

  const badge = document.createElement('span');
  badge.className = 'realtime-badge';
  badge.hidden = true;
  bell.append(badge);

  function render() {
    badge.hidden = unread === 0;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    const list = panel.querySelector('.notifications-list');
    if (!items.length) {
      list.innerHTML = '<p class="notifications-empty">Новых уведомлений пока нет</p>';
      return;
    }
    list.innerHTML = items.slice(0, 30).map(event => {
      const title = event.payload?.title || titleFor(event.type);
      const text = event.payload?.text || textFor(event.type);
      return `<article class="notification-item"><span class="notification-icon">${iconFor(event.type)}</span><div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p><time>${formatTime(event.createdAt)}</time></div></article>`;
    }).join('');
  }

  function titleFor(type) {
    if (type.startsWith('message.')) return 'Новое сообщение';
    if (type.startsWith('comment.')) return 'Новый комментарий';
    if (type.startsWith('reaction.')) return 'Новая реакция';
    if (type.startsWith('follow.')) return 'Новый подписчик';
    if (type.startsWith('mention.')) return 'Вас упомянули';
    return 'Новое событие';
  }
  function textFor(type) { return `Событие: ${type}`; }
  function iconFor(type) {
    if (type.startsWith('message.')) return '◌';
    if (type.startsWith('comment.')) return '▢';
    if (type.startsWith('reaction.')) return '♥';
    if (type.startsWith('follow.')) return '＋';
    return '♢';
  }
  function formatTime(value) {
    try { return new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  }
  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function receive(event) {
    items.unshift(event);
    unread += 1;
    render();
    document.dispatchEvent(new CustomEvent('vibe:realtime', { detail: event }));
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(event.payload?.title || titleFor(event.type), { body: event.payload?.text || '' });
    }
  }

  async function poll() {
    if (!running) return;
    try {
      const response = await fetch(`/api/realtime/events?cursor=${cursor}`, { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) {
        stop();
        return;
      }
      if (response.ok) {
        const data = await response.json();
        for (const event of data.events || []) receive(event);
        cursor = Number(data.nextCursor || cursor);
      }
    } catch {}
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (!running) return;
    timer = setTimeout(poll, document.hidden ? 10000 : 2000);
  }
  function start(nextCursor = 0) {
    cursor = Math.max(cursor, Number(nextCursor || 0));
    if (running) return;
    running = true;
    poll();
  }
  function stop() {
    running = false;
    clearTimeout(timer);
  }

  async function detectSession() {
    try {
      const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return stop();
      const data = await response.json();
      start(data.realtimeCursor || 0);
    } catch { stop(); }
  }

  bell.addEventListener('click', event => {
    event.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { unread = 0; render(); }
  });
  panel.querySelector('[data-close]').addEventListener('click', () => panel.hidden = true);
  document.addEventListener('click', event => { if (!panel.hidden && !panel.contains(event.target) && event.target !== bell) panel.hidden = true; });
  document.addEventListener('visibilitychange', () => { if (running) { clearTimeout(timer); poll(); } });
  window.addEventListener('online', () => { if (running) poll(); else detectSession(); });
  document.addEventListener('vibe:auth-success', event => start(event.detail?.realtimeCursor || 0));
  document.addEventListener('vibe:logout', stop);

  window.VibeRealtime = { start, stop, refresh: poll };
  detectSession();
})();
