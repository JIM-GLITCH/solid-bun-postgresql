/**
 * 运行环境判定（无业务逻辑、无副作用，仅在首次调用时缓存探测结果）。
 *
 * 前端代码需要按宿主分流的场景统一用这里，避免各处重复探测 `window` 上的宿主标记。
 */

export type VsCodeWebviewApi = {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let apiSingleton: VsCodeWebviewApi | null | undefined;

/** 取得（并缓存）webview 的 VsCodeApi；非 VSCode 环境返回 null。 */
export function getVsCodeWebviewApi(): VsCodeWebviewApi | null {
  if (apiSingleton !== undefined) return apiSingleton;
  const w = typeof window !== "undefined" ? window : undefined;
  const fn = (w as Window & { acquireVsCodeApi?: () => VsCodeWebviewApi })?.acquireVsCodeApi;
  apiSingleton = typeof fn === "function" ? fn() : null;
  return apiSingleton;
}

/** 是否运行在 VSCode Webview 中。 */
export function isVsCodeWebview(): boolean {
  return getVsCodeWebviewApi() !== null;
}

/** 是否运行在 Electrobun 应用内（主进程通过 `__electrobunApiRequest` 暴露 RPC）。 */
export function isElectrobun(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & { __electrobunApiRequest?: unknown };
  return typeof w.__electrobunApiRequest === "function";
}
