/**
 * VSCode Webview 传输实现：使用 postMessage 与 Extension Host 通信
 * 用于 VSCode 插件构建时替换 HttpTransport
 *
 * 注意：主要 API 调用已迁移到 tRPC，此 transport 系统暂时保留用于订阅功能
 *
 * 使用方式：
 *   import { setTransport } from "./transport";
 *   import { VsCodeTransport } from "./transport/vscode-transport";
 *   setTransport(new VsCodeTransport());
 */

import type {
  AccountStateMessage,
  IApiTransport,
  ApiMethod,
  ApiRequestPayload,
  ApiRpcResult,
  SSEMessage,
  ServerPushMessage,
  TransportOnSubscribe,
} from "../../shared/src";
import { SubscriptionRequiredError } from "../subscription/subscription-error";
import { raiseSubscriptionRequired } from "../subscription/subscription-prompt";

import { getVsCodeWebviewApi } from "./vscode-api";

export { getVsCodeWebviewApi };

export class VsCodeTransport implements IApiTransport {
  private vscode = getVsCodeWebviewApi();
  private messageId = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly serverPushListeners = new Set<(msg: ServerPushMessage) => void>();
  private readonly connectionSubscriptions = new Map<string, number>();

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => {
        const { id, data, error, subscriptionRequired } = event.data || {};
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          if (error) {
            if (subscriptionRequired) {
              const m = typeof error === "string" && error.trim() ? error : "";
              raiseSubscriptionRequired(m);
              p.reject(new SubscriptionRequiredError(m || undefined));
            } else {
              p.reject(new Error(error));
            }
          } else p.resolve(data);
        }

        const msg = event.data as {
          type?: string;
          data?: unknown;
          connectionId?: string;
          loggedIn?: boolean;
          user?: { id?: number; email?: string | null };
        };
        if (msg?.type === "sse" && msg.data && msg.connectionId) {
          this.emitServerPush({
            topic: "connection-event",
            connectionId: msg.connectionId,
            event: msg.data as SSEMessage,
          });
        } else if (msg?.type === "dbplayer/account") {
          const account: AccountStateMessage = {
            loggedIn: !!msg.loggedIn,
            user: msg.user,
          };
          this.emitServerPush({ topic: "account", account });
        }
      });
    }
  }

  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<ApiRpcResult<M>> {
    if (!this.vscode) {
      throw new Error("VsCodeTransport: acquireVsCodeApi 不可用，请在 VSCode Webview 中使用");
    }

    const id = ++this.messageId;
    return new Promise((resolve: (value: ApiRpcResult<M> | PromiseLike<ApiRpcResult<M>>) => void, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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

  on(sub: TransportOnSubscribe): () => void {
    switch (sub.event) {
      case "push":
        this.serverPushListeners.add(sub.handler);
        return () => this.serverPushListeners.delete(sub.handler);
      case "account": {
        const wrapped = (msg: ServerPushMessage) => {
          if (msg.topic === "account") sub.handler(msg.account);
        };
        this.serverPushListeners.add(wrapped);
        return () => this.serverPushListeners.delete(wrapped);
      }
      case "connection": {
        const { connectionId } = sub;
        const wrapped = (msg: ServerPushMessage) => {
          if (msg.topic !== "connection-event" || msg.connectionId !== connectionId) return;
          sub.handler(msg.event);
        };
        this.serverPushListeners.add(wrapped);

        const count = this.connectionSubscriptions.get(connectionId) ?? 0;
        this.connectionSubscriptions.set(connectionId, count + 1);
        if (count === 0) {
          this.vscode?.postMessage({ type: "subscribe-events", connectionId });
        }

        return () => {
          this.serverPushListeners.delete(wrapped);
          const current = this.connectionSubscriptions.get(connectionId) ?? 0;
          if (current <= 1) {
            this.connectionSubscriptions.delete(connectionId);
            this.vscode?.postMessage({ type: "unsubscribe-events", connectionId });
          } else {
            this.connectionSubscriptions.set(connectionId, current - 1);
          }
        };
      }
    }
  }

  private emitServerPush(msg: ServerPushMessage): void {
    for (const listener of this.serverPushListeners) listener(msg);
  }
}
