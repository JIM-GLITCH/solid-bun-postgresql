/** 与订阅页 localStorage（dbplayer_token）、扩展 Secret（同步到 webview 时可用 dbplayer.jwt）对齐 */

const KEYS = ["dbplayer.jwt", "dbplayer_token"] as const;

export function getBrowserJwt(): string | null {
  if (typeof localStorage === "undefined") return null;
  for (const k of KEYS) {
    const t = localStorage.getItem(k)?.trim();
    if (t) return t;
  }
  return null;
}
