(function () {
  const API_URL = window.DBPLAYER_API_URL || 'http://localhost:9000';
  const TOKEN_KEY = 'dbplayer_token';

  const $ = (id) => document.getElementById(id);
  const $btnLogin = $('btn-login');
  const $btnLogout = $('btn-logout');
  const $btnSubscribe = $('btn-subscribe');
  const $btnSubscribeYearly = $('btn-subscribe-yearly');
  const $userInfo = $('user-info');
  const $subscriptionStatus = $('subscription-status');
  const $statusContent = $('status-content');

  function getToken() {
    const params = new URLSearchParams(location.search);
    const token = params.get('token') || localStorage.getItem(TOKEN_KEY);
    if (params.get('token')) {
      localStorage.setItem(TOKEN_KEY, token);
      history.replaceState({}, '', location.pathname);
    }
    return token;
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
  }

  function init() {
    const token = getToken();
    if (token) {
      $btnLogin.classList.add('hidden');
      $btnLogout.classList.remove('hidden');
      fetchSubscription(token);
    } else {
      $btnLogin.classList.remove('hidden');
      $btnLogout.classList.add('hidden');
      $subscriptionStatus.classList.add('hidden');
    }
  }

  $btnLogin.addEventListener('click', () => {
    window.location.href = `${API_URL}/api/auth/github`;
  });

  $btnLogout.addEventListener('click', () => {
    clearToken();
    location.reload();
  });

  async function fetchSubscription(token) {
    try {
      const res = await fetch(`${API_URL}/api/subscription`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.success && data.subscription) {
        const sub = data.subscription;
        $subscriptionStatus.classList.remove('hidden');
        $statusContent.innerHTML = sub.active
          ? `<p class="active">✓ 已订阅 (${sub.plan})${sub.expiresAt ? ' · 到期: ' + formatDate(sub.expiresAt) : ''}</p>`
          : `<p class="inactive">未订阅或已过期</p>`;

        if (sub.active) {
          $btnSubscribe.textContent = '已订阅';
          $btnSubscribe.disabled = true;
          $btnSubscribeYearly.textContent = '已订阅';
          $btnSubscribeYearly.disabled = true;
        } else {
          $btnSubscribe.textContent = '立即订阅';
          $btnSubscribe.disabled = false;
          $btnSubscribeYearly.textContent = '年付订阅';
          $btnSubscribeYearly.disabled = false;
        }
      }
    } catch (e) {
      console.error('fetch subscription:', e);
      $userInfo.textContent = '获取订阅状态失败';
    }
  }

  function formatDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp * 1000);
    return d.toLocaleDateString('zh-CN');
  }

  $btnSubscribe.addEventListener('click', () => {
    const token = getToken();
    if (!token) {
      window.location.href = `${API_URL}/api/auth/github`;
      return;
    }
    // 支付宝支付待接入，暂时提示
    alert('支付功能即将上线，请稍后关注。');
  });

  $btnSubscribeYearly.addEventListener('click', () => {
    const token = getToken();
    if (!token) {
      window.location.href = `${API_URL}/api/auth/github`;
      return;
    }
    alert('支付功能即将上线，请稍后关注。');
  });

  init();
})();
