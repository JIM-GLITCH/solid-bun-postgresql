const DEFAULT_PORTAL = "https://dbplayer.top";
const DEFAULT_API = "https://api.dbplayer.top";
const LOGIN_REDIRECT_LOCK = "dbplayer_login_redirecting";
const LOGIN_REDIRECT_AT = "dbplayer_login_redirect_at";

export function getSubscriptionPortalUrl(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    const v = env?.VITE_SUBSCRIPTION_FRONTEND_URL;
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\/$/, "");
  } catch {
    /* noop */
  }
  return DEFAULT_PORTAL;
}

export function getSubscriptionApiUrl(): string {
  try {
    const env = (import.meta as ImportMeta & { env?: Record<string, string> }).env;
    const v = env?.VITE_SUBSCRIPTION_API_URL;
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\/$/, "");
  } catch {
    /* noop */
  }
  return DEFAULT_API;
}

export function canAutoRedirectToWebLogin(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { acquireVsCodeApi?: unknown; __electrobunApiRequest?: unknown };
  if (typeof w.acquireVsCodeApi === "function") return false;
  if (typeof w.__electrobunApiRequest === "function") return false;
  return true;
}

export function markLoginRedirecting(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(LOGIN_REDIRECT_LOCK, "1");
  sessionStorage.setItem(LOGIN_REDIRECT_AT, String(Date.now()));
}

export function clearLoginRedirectingMark(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(LOGIN_REDIRECT_LOCK);
  sessionStorage.removeItem(LOGIN_REDIRECT_AT);
}

export function isLoginRedirectingRecently(windowMs = 15000): boolean {
  if (typeof sessionStorage === "undefined") return false;
  if (sessionStorage.getItem(LOGIN_REDIRECT_LOCK) !== "1") return false;
  const t = Number(sessionStorage.getItem(LOGIN_REDIRECT_AT) || "0");
  return Date.now() - t < windowMs;
}

export function openWebSubscriptionLogin(): void {
  if (!canAutoRedirectToWebLogin()) return;
  const api = getSubscriptionApiUrl();
  // 保留当前路径与查询，登录后尽量回到用户原位置
  const redirect = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  markLoginRedirecting();
  window.location.href = `${api}/api/auth/github?source=webapp&redirect=${encodeURIComponent(redirect)}`;
}

