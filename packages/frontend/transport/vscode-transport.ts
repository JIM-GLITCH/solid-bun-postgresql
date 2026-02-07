/**
 * VSCode Webview 传输实现：使用 postMessage 与 Extension Host 通信
 * 用于 VSCode 插件构建时替换 HttpTransport
 *
 * 使用方式：
 *   import { setTransport } from "./transport";
 *   import { VsCodeTransport } from "./transport/vscode-transport";
 *   setTransport(new VsCodeTransport());
 */

import type { IApiTransport, ApiMethod, ApiRequestPayload } from "@project/shared";
import type { SSEMessage } from "@project/shared";

declare const acquireVsCodeApi: () => {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

export class VsCodeTransport implements IApiTransport {
  private vscode = typeof acquireVsCodeApi !== "undefined" ? acquireVsCodeApi() : null;
  private messageId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => {
        const { id, data, error } = event.data || {};
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          if (error) p.reject(new Error(error));
          else p.resolve(data);
        }
      });
    }
  }

  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M] & { sessionId: string }
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

  subscribeEvents(sessionId: string, callback: (msg: SSEMessage) => void): () => void {
    // VSCode 下由 Extension Host 通过 webview.postMessage 推送
    // 此处监听 type: 'sse' 的消息
    const handler = (event: MessageEvent) => {
      const { type, data } = event.data || {};
      if (type === "sse" && data) callback(data as SSEMessage);
    };

    if (typeof window !== "undefined") {
      window.addEventListener("message", handler);
      this.vscode?.postMessage({ type: "subscribe-events", sessionId });
    }

    return () => {
      window.removeEventListener("message", handler);
      this.vscode?.postMessage({ type: "unsubscribe-events", sessionId });
    };
  }
}
