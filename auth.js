(() => {
  const phoneForm = document.querySelector('#phoneForm');
  const codeForm = document.querySelector('#codeForm');
  const phoneInput = document.querySelector('#phoneInput');
  const codeInput = document.querySelector('#codeInput');
  const phoneStep = document.querySelector('#phoneStep');
  const codeStep = document.querySelector('#codeStep');
  const sentPhone = document.querySelector('#sentPhone');
  const authMessage = document.querySelector('#authMessage');
  const resendCode = document.querySelector('#resendCode');
  const authBack = document.querySelector('#authBack');
  const authScreen = document.querySelector('#authScreen');
  const profilePhone = document.querySelector('#profilePhone');
  const logoutBtn = document.querySelector('#logoutBtn');
  let currentPhone = '';
  let timer = null;

  function showMessage(text = '', type = '') {
    authMessage.textContent = text;
    authMessage.className = `auth-message ${type}`.trim();
  }

  function setLoading(form, loading) {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = loading;
    button.dataset.original ||= button.textContent;
    button.textContent = loading ? 'Подождите…' : button.dataset.original;
  }

  function showApp(user) {
    if (profilePhone && user?.phone) profilePhone.textContent = user.phone;
    authScreen.hidden = true;
    document.body.classList.remove('auth-pending');
  }

  function showAuth() {
    authScreen.hidden = false;
    document.body.classList.add('auth-pending');
  }

  function startResendCountdown(seconds = 60) {
    clearInterval(timer);
    let left = seconds;
    resendCode.disabled = true;
    resendCode.textContent = `Отправить код повторно через ${left} сек.`;
    timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        resendCode.disabled = false;
        resendCode.textContent = 'Отправить код повторно';
      } else {
        resendCode.textContent = `Отправить код повторно через ${left} сек.`;
      }
    }, 1000);
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'request_failed');
      error.data = data;
      throw error;
    }
    return data;
  }

  function friendlyError(error) {
    const map = {
      invalid_phone: 'Проверьте номер телефона.',
      invalid_code: 'Неверный код. Попробуйте ещё раз.',
      code_expired: 'Срок действия кода истёк. Запросите новый.',
      too_many_attempts: 'Слишком много попыток. Запросите новый код.',
      too_many_requests: 'Код уже отправлен. Немного подождите перед повторной отправкой.',
      sms_delivery_failed: 'Не удалось отправить SMS. Попробуйте ещё раз чуть позже.'
    };
    return map[error.message] || 'Что-то пошло не так. Попробуйте ещё раз.';
  }

  phoneInput.addEventListener('input', () => {
    const digits = phoneInput.value.replace(/\D/g, '').slice(0, 10);
    const chunks = [];
    if (digits.length) chunks.push(digits.slice(0, 3));
    if (digits.length > 3) chunks.push(digits.slice(3, 6));
    let result = chunks.join(' ');
    if (digits.length > 6) result += `-${digits.slice(6, 8)}`;
    if (digits.length > 8) result += `-${digits.slice(8, 10)}`;
    phoneInput.value = result;
  });

  phoneForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage();
    setLoading(phoneForm, true);
    try {
      const data = await api('/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ phone: `+7${phoneInput.value}` })
      });
      currentPhone = data.phone;
      sentPhone.textContent = currentPhone;
      phoneStep.hidden = true;
      codeStep.hidden = false;
      codeInput.focus();
      startResendCountdown(60);
      showMessage(data.devMode ? 'Режим разработки: код выведен в консоль сервера.' : 'SMS отправлено.', 'success');
    } catch (error) {
      showMessage(friendlyError(error), 'error');
    } finally {
      setLoading(phoneForm, false);
    }
  });

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 6);
  });

  codeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage();
    setLoading(codeForm, true);
    try {
      const data = await api('/api/auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({ phone: currentPhone, code: codeInput.value })
      });
      showApp(data.user);
    } catch (error) {
      showMessage(friendlyError(error), 'error');
      codeInput.select();
    } finally {
      setLoading(codeForm, false);
    }
  });

  resendCode.addEventListener('click', async () => {
    if (!currentPhone) return;
    resendCode.disabled = true;
    showMessage();
    try {
      const data = await api('/api/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ phone: currentPhone })
      });
      startResendCountdown(60);
      showMessage(data.devMode ? 'Новый код выведен в консоль сервера.' : 'Новый код отправлен.', 'success');
    } catch (error) {
      showMessage(friendlyError(error), 'error');
      if (error.data?.retryAfter) startResendCountdown(error.data.retryAfter);
      else resendCode.disabled = false;
    }
  });

  authBack.addEventListener('click', () => {
    clearInterval(timer);
    codeStep.hidden = true;
    phoneStep.hidden = false;
    currentPhone = '';
    codeInput.value = '';
    showMessage();
    phoneInput.focus();
  });

  logoutBtn?.addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    showAuth();
    phoneStep.hidden = false;
    codeStep.hidden = true;
    phoneInput.value = '';
    codeInput.value = '';
    showMessage();
  });

  (async () => {
    try {
      const data = await api('/api/auth/me', { method: 'GET', headers: {} });
      showApp(data.user);
    } catch {
      showAuth();
    }
  })();
})();
