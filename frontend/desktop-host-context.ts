/**
 * VS Code 扩展在 Webview HTML 注入的宿主信息（与 subscription ?source=&host= 一致）
 */

declare global {
  interface Window {
    __DBPLAYER_DESKTOP_HOST__?: { source?: string; displayName?: string };
  }
}

/** 扩展注入：优先于侧栏手写逻辑 */
export function getInjectedDesktopHost(): { source: string; displayName: string } | null {
  if (typeof window === "undefined") return null;
  const h = window.__DBPLAYER_DESKTOP_HOST__;
  if (h?.source && h.displayName) {
    return { source: h.source.trim().toLowerCase(), displayName: h.displayName.trim() };
  }
  return null;
}
