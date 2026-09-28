/**
 * VS Code Webview API 单例。
 *
 * `acquireVsCodeApi()` 整个页面只能调用一次，重复调用会抛
 * "An instance of the VS Code API has already been acquired"。
 * 因此全应用必须共用一个单例：transport / tRPC link / 侧栏登录 / 订阅门户
 * 都从这里拿，绝不再各自调用 acquireVsCodeApi。
 */

export type VsCodeWebviewApi = {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vscodeApiSingleton: VsCodeWebviewApi | null | undefined;

export function getVsCodeWebviewApi(): VsCodeWebviewApi | null {
  if (vscodeApiSingleton !== undefined) return vscodeApiSingleton;
  const w = typeof window !== "undefined" ? window : undefined;
  const fn = (w as Window & { acquireVsCodeApi?: () => VsCodeWebviewApi })?.acquireVsCodeApi;
  if (typeof fn !== "function") {
    vscodeApiSingleton = null;
    return null;
  }
  vscodeApiSingleton = fn();
  return vscodeApiSingleton;
}
