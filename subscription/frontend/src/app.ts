import { getApiUrl } from "./config";

const TOKEN_KEY = "dbplayer_token";

const $ = (id: string) => document.getElementById(id)!;
const $btnLogin = $("btn-login");
const $btnLogout = $("btn-logout");
const $btnSubscribe = $("btn-subscribe");
const $btnSubscribeYearly = $("btn-subscribe-yearly");
const $userInfo = $("user-info");
const $subscriptionStatus = $("subscription-status");
const $statusContent = $("status-content");

function getToken(): string | null {
  const params = new URLSearchParams(location.search);
  const token = params.get("token") || localStorage.getItem(TOKEN_KEY);
  if (params.get("token") && token) {
    localStorage.setItem(TOKEN_KEY, token);
    history.replaceState({}, "", location.pathname);
  }
  return token;
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

function init(): void {
  const token = getToken();
  if (token) {
    $btnLogin.classList.add("hidden");
    $btnLogout.classList.remove("hidden");
    fetchSubscription(token);
  } else {
    $btnLogin.classList.remove("hidden");
    $btnLogout.classList.add("hidden");
    $subscriptionStatus.classList.add("hidden");
  }
}

$btnLogin.addEventListener("click", () => {
  const apiUrl = getApiUrl();
  window.location.href = `${apiUrl}/api/auth/github`;
});

$btnLogout.addEventListener("click", () => {
  clearToken();
  location.reload();
});

interface SubscriptionRes {
  success: boolean;
  subscription?: {
    active: boolean;
    plan: string;
    expiresAt: number | null;
  };
}

async function fetchSubscription(token: string): Promise<void> {
  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as SubscriptionRes;

    if (data.success && data.subscription) {
      const sub = data.subscription;
      $subscriptionStatus.classList.remove("hidden");
      $statusContent.innerHTML = sub.active
        ? `<p class="active">✓ 已订阅 (${sub.plan})${sub.expiresAt ? " · 到期: " + formatDate(sub.expiresAt) : ""}</p>`
        : `<p class="inactive">未订阅或已过期</p>`;

      if (sub.active) {
        $btnSubscribe.textContent = "已订阅";
        ($btnSubscribe as HTMLButtonElement).disabled = true;
        $btnSubscribeYearly.textContent = "已订阅";
        ($btnSubscribeYearly as HTMLButtonElement).disabled = true;
      } else {
        $btnSubscribe.textContent = "立即订阅";
        ($btnSubscribe as HTMLButtonElement).disabled = false;
        $btnSubscribeYearly.textContent = "年付订阅";
        ($btnSubscribeYearly as HTMLButtonElement).disabled = false;
      }
    }
  } catch (e) {
    console.error("fetch subscription:", e);
    $userInfo.textContent = "获取订阅状态失败";
  }
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const d = new Date(timestamp * 1000);
  return d.toLocaleDateString("zh-CN");
}

function handleSubscribe(): void {
  const token = getToken();
  if (!token) {
    const apiUrl = getApiUrl();
    window.location.href = `${apiUrl}/api/auth/github`;
    return;
  }
  alert("支付功能即将上线，请稍后关注。");
}

$btnSubscribe.addEventListener("click", handleSubscribe);
$btnSubscribeYearly.addEventListener("click", handleSubscribe);

init();
