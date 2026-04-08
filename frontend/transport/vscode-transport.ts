/**
 * VSCode Webview 传输实现：使用 postMessage 与 Extension Host 通信
 * 用于 VSCode 插件构建时替换 HttpTransport
 *
 * 使用方式：
 *   import { setTransport } from "./transport";
 *   import { VsCodeTransport } from "./transport/vscode-transport";
 *   setTransport(new VsCodeTransport());
 */

import type { IApiTransport, ApiMethod, ApiRequestPayload, SSEMessage } from "../../shared/src";
import { SubscriptionRequiredError } from "../subscription/subscription-error";

export type VsCodeWebviewApi = {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vscodeApiSingleton: VsCodeWebviewApi | null | undefined;

/**
 * VS Code Webview 中 `acquireVsCodeApi()` 整个页面只能调用一次。
 * Transport、侧栏登录等必须共用同一实例，否则会抛错且 postMessage 无效。
 */
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

export class VsCodeTransport implements IApiTransport {
  private vscode = getVsCodeWebviewApi();
  private messageId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => {
        const { id, data, error, subscriptionRequired } = event.data || {};
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          if (error) {
            p.reject(
              subscriptionRequired
                ? new SubscriptionRequiredError(
                    typeof error === "string" && error.trim() ? error : undefined
                  )
                : new Error(error)
            );
          } else p.resolve(data);
        }
      });
    }
  }

  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown> {
    if (!this.vscode) {
      throw new Error("VsCodeTransport: acquireVsCodeApi 不可用，请在 VSCode Webview 中使用");
    }

    const id = ++this.messageId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.vscode!.postMessage({ id, method, payload });
      // 超时保护
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error("VsCodeTransport: 请求超时"));
        }
      }, 30000);
    });
  }

  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
    const handler = (event: MessageEvent) => {
      const { type, data } = event.data || {};
      if (type === "sse" && data) callback(data as SSEMessage);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("message", handler);
      this.vscode?.postMessage({ type: "subscribe-events", connectionId });
    }

    return () => {
      window.removeEventListener("message", handler);
      this.vscode?.postMessage({ type: "unsubscribe-events", connectionId });
    };
  }
}
