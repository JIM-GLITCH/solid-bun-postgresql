import { getVsCodeWebviewApi } from "../transport/vscode-transport";

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

/** Standalone：仅用于 `?return=` 存 sessionStorage；用户点「返回本地 DB Player」时再带 token 打开，由本地业务后端写 Cookie。GitHub OAuth 不再直接 redirect 到此。 */
export function getStandaloneSubscriptionOAuthCallbackUrl(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/api/dbplayer/subscription-callback`;
}

/**
 * 当前运行环境下的订阅站入口：VS Code 由扩展 host 打开外部浏览器；
 * Standalone/Web 整页跳转带 return；其它环境新窗口打开门户。
 */
export function openSubscriptionPortalForCurrentEnvironment(): void {
  const vsc = getVsCodeWebviewApi();
  if (vsc) {
    vsc.postMessage({ type: "dbplayer/open-subscription-login" });
    return;
  }
  if (canAutoRedirectToWebLogin()) {
    openWebSubscriptionLogin();
    return;
  }
  if (typeof window !== "undefined") {
    window.open(getSubscriptionPortalUrl(), "_blank", "noopener,noreferrer");
  }
}

/** 先打开订阅前端页面，由用户点击「用 GitHub 登录」再走 OAuth（与扩展行为一致） */
export function openWebSubscriptionLogin(): void {
  if (!canAutoRedirectToWebLogin()) return;
  const portal = getSubscriptionPortalUrl().replace(/\/$/, "");
  const callback = getStandaloneSubscriptionOAuthCallbackUrl();
  markLoginRedirecting();
  const u = new URL(portal.includes("://") ? portal : `https://${portal}`);
  u.searchParams.set("source", "standalone");
  u.searchParams.set("return", callback);
  window.location.href = u.toString();
}

