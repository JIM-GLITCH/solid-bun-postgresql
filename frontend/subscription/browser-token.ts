/** 与订阅页 localStorage（dbplayer_token）、扩展 Secret（同步到 webview 时可用 dbplayer.jwt）对齐 */

const KEYS = ["dbplayer.jwt", "dbplayer_token"] as const;

export function syncBrowserJwtFromUrl(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  const u = new URL(window.location.href);
  const token = u.searchParams.get("token")?.trim();
  if (!token) return;
  localStorage.setItem("dbplayer_token", token);
  u.searchParams.delete("token");
  // 来源参数仅用于登录后识别，不需要长期留在地址栏
  u.searchParams.delete("source");
  window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
}

export function getBrowserJwt(): string | null {
  if (typeof localStorage === "undefined") return null;
  for (const k of KEYS) {
    const t = localStorage.getItem(k)?.trim();
    if (t) return t;
  }
  return null;
}

export function clearBrowserJwt(): void {
  if (typeof localStorage === "undefined") return;
  for (const k of KEYS) localStorage.removeItem(k);
}
