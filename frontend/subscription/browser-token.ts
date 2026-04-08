/**
 * Standalone 订阅令牌：只允许后端持有（HttpOnly Cookie）。
 * 前端不再读写 localStorage，不再回退到浏览器存储。
 */

export function syncBrowserJwtFromUrl(): void {
  if (typeof window === "undefined") return;
  const u = new URL(window.location.href);
  const token = u.searchParams.get("token")?.trim();
  if (!token) return;

  if (typeof fetch !== "undefined") {
    void fetch(`${window.location.origin}/api/dbplayer/subscription-token`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => {});
  }

  u.searchParams.delete("token");
  u.searchParams.delete("source");
  window.history.replaceState({}, "", `${u.pathname}${u.search}${u.hash}`);
}

/** 仅后端 Cookie 持有，前端 Bearer 始终为空。 */
export function getBrowserJwt(): string | null {
  return null;
}

/** 不再清理前端 token 存储（已弃用）。 */
export function clearBrowserJwt(): void {
  // noop
}
