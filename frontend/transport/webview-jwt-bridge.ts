/**
 * Webview 向 Extension Host 索取 JWT（与 SecretStorage 中 dbplayer.jwt 一致）
 */

declare const acquireVsCodeApi: () => { postMessage(message: unknown): void };

export function createWebviewJwtGetter(): () => Promise<string | null> {
  return () =>
    new Promise((resolve) => {
      const vscode = typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;
      if (!vscode) {
        resolve(null);
        return;
      }
      const requestId = Date.now() + Math.random();
      const handler = (e: MessageEvent) => {
        const d = e.data as { type?: string; requestId?: number; token?: string | null };
        if (d?.type === "dbplayer/jwt-response" && d.requestId === requestId) {
          window.removeEventListener("message", handler);
          const t = d.token;
          resolve(typeof t === "string" && t.trim() ? t.trim() : null);
        }
      };
      window.addEventListener("message", handler);
      vscode.postMessage({ type: "dbplayer/get-jwt", requestId });
      setTimeout(() => {
        window.removeEventListener("message", handler);
        resolve(null);
      }, 8000);
    });
}
