/**
 * VSCode Webview 传输实现：jsonrpc 会话经 postMessage 通道与 Extension Host 通信
 * 用于 VSCode 插件构建时替换 RpcTransport（Web）
 *
 * 使用方式：
 *   import { setTransport } from "./transport";
 *   import { VsCodeTransport } from "./transport/vscode-transport";
 *   setTransport(new VsCodeTransport());
 *
 * 宿主侧（extension.ts）用 PostMessageServerTransport + buildRpcStack 承载同一套
 * DbServer/AppServer；`vscode/*` 方法仍由扩展宿主拦截，不进 jsonrpc。
 */

import { ResponseError, type Message, type RequestType } from "vscode-jsonrpc";
import {
  CONNECTION_EVENT_NOTIFICATION,
  SERVER_PUSH_NOTIFICATION,
  SUBSCRIPTION_ASSERT,
  type AccountStateMessage,
  type IApiTransport,
  type ApiMethod,
  type ApiRequestPayload,
  type ServerPushMessage,
  type SSEMessage,
  type TransportOnSubscribe,
} from "../../shared/src";
import { RpcSessionClient } from "../../backend/rpc/rpc-session/rpc-session-client";
import {
  PostMessageClientTransport,
  type PostMessageClientMsg,
} from "./post-message-client-transport";
import { METHOD_TYPES } from "./method-types";
import { formatUnknownError } from "../format-unknown-error";
import { SubscriptionRequiredError } from "../subscription/subscription-error";
import { raiseSubscriptionRequired } from "../subscription/subscription-prompt";

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
  /** rpc-transport 消息的往返序号（postMessage 无原生应答，用 tid 配对） */
  private transportId = 0;
  private pendingTransport = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  /** vscode/* 方法走宿主拦截的旧 id 协议（不进 jsonrpc） */
  private hostMessageId = 0;
  private pendingHost = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private clientTransport: PostMessageClientTransport;
  private session: RpcSessionClient;
  private ready: Promise<void>;

  private readonly connectionListeners = new Map<string, Set<(msg: SSEMessage) => void>>();
  private readonly pushListeners = new Set<(msg: ServerPushMessage) => void>();
  private readonly accountListeners = new Set<(msg: AccountStateMessage) => void>();

  constructor() {
    this.clientTransport = new PostMessageClientTransport({
      post: (m: PostMessageClientMsg) => this.postWithAck(m),
    });
    this.session = new RpcSessionClient(this.clientTransport);

    // 每次会话（重）建立都要在新连接上重挂通知处理器
    this.session.onSession(() => {
      this.session.onNotification(CONNECTION_EVENT_NOTIFICATION, ({ connectionId, event }) => {
        const set = this.connectionListeners.get(connectionId);
        if (!set) return;
        for (const handler of set) handler(event);
      });
      this.session.onNotification(SERVER_PUSH_NOTIFICATION, (params) => {
        if (params.topic === "account") {
          const msg: ServerPushMessage = { topic: "account", account: params.account };
          for (const handler of this.pushListeners) handler(msg);
          for (const handler of this.accountListeners) handler(params.account);
        }
      });
    });

    this.ready = new Promise<void>((resolve, reject) => {
      const off = this.session.onSession(() => {
        off();
        resolve();
      });
      this.session.listen().catch((e) => {
        off();
        reject(e);
      });
    });

    if (typeof window !== "undefined") {
      window.addEventListener("message", (event) => {
        const msg = event.data as {
          type?: string;
          tid?: number;
          result?: unknown;
          error?: string;
          msg?: Message;
          loggedIn?: boolean;
          user?: { id?: number; email?: string | null };
        };
        if (!msg || typeof msg !== "object") return;

        // vscode/* 旧协议应答：{ id, data?, error?, subscriptionRequired? }
        const legacy = event.data as {
          id?: number;
          data?: unknown;
          error?: string;
          subscriptionRequired?: boolean;
        };
        if (typeof legacy.id === "number" && this.pendingHost.has(legacy.id)) {
          const p = this.pendingHost.get(legacy.id)!;
          this.pendingHost.delete(legacy.id);
          if (legacy.error) {
            if (legacy.subscriptionRequired) {
              const m = typeof legacy.error === "string" && legacy.error.trim() ? legacy.error : "";
              raiseSubscriptionRequired(m);
              p.reject(new SubscriptionRequiredError(m || undefined));
            } else {
              p.reject(new Error(legacy.error));
            }
          } else {
            p.resolve(legacy.data);
          }
          return;
        }

        if (msg.type === "rpc-transport-ack" && typeof msg.tid === "number") {
          const p = this.pendingTransport.get(msg.tid);
          if (p) {
            this.pendingTransport.delete(msg.tid);
            msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
          }
          return;
        }
        if (msg.type === "rpc-server-msg" && msg.msg) {
          this.clientTransport.receiveServerMessage(msg.msg);
          return;
        }
        // 扩展宿主直推的账号态（SecretStorage 登录/登出时），与 jsonrpc 通知并行保留
        if (msg.type === "dbplayer/account") {
          const account: AccountStateMessage = {
            loggedIn: !!msg.loggedIn,
            user: msg.user,
          };
          const pushMsg: ServerPushMessage = { topic: "account", account };
          for (const handler of this.pushListeners) handler(pushMsg);
          for (const handler of this.accountListeners) handler(account);
        }
      });
    }
  }

  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown> {
    // vscode/* 方法由扩展宿主拦截（save-file、clipboard 等），不进 jsonrpc，保留旧 id 协议
    if (method.startsWith("vscode/")) {
      return this.requestHostMethod(method, payload);
    }
    const type = METHOD_TYPES[method as keyof typeof METHOD_TYPES] as
      | RequestType<unknown, unknown, void>
      | undefined;
    if (!type) throw new Error(`VsCodeTransport 不支持该方法：${method}`);
    try {
      await this.ready;
    } catch {
      throw new Error(`网络请求失败（${method}）：jsonrpc 会话未建立`);
    }
    try {
      // accessToken 由扩展宿主注入（token 存 SecretStorage，不落 webview）
      return await this.session.sendRequest(type, payload as unknown);
    } catch (e) {
      if (e instanceof ResponseError) {
        const data = e.data as { subscriptionRequired?: boolean } | undefined;
        if (data?.subscriptionRequired) {
          const err = new SubscriptionRequiredError(formatUnknownError(e.message, "") || undefined);
          raiseSubscriptionRequired(err.message);
          throw err;
        }
        throw new Error(formatUnknownError(e.message, `请求失败: ${method}`));
      }
      throw e instanceof Error ? e : new Error(String(e));
    }
  }

  on(sub: TransportOnSubscribe): () => void {
    switch (sub.event) {
      case "push":
        this.pushListeners.add(sub.handler);
        return () => this.pushListeners.delete(sub.handler);
      case "account":
        this.accountListeners.add(sub.handler);
        return () => this.accountListeners.delete(sub.handler);
      case "connection": {
        const { connectionId } = sub;
        let set = this.connectionListeners.get(connectionId);
        if (!set) {
          set = new Set();
          this.connectionListeners.set(connectionId, set);
        }
        const handlers = set;
        handlers.add(sub.handler);
        return () => {
          handlers.delete(sub.handler);
          if (handlers.size === 0) this.connectionListeners.delete(connectionId);
        };
      }
    }
  }

  /** vscode/* 宿主方法：旧 { id, method, payload } 协议，宿主以 { id, data|error } 回包 */
  private requestHostMethod(method: string, payload: unknown): Promise<unknown> {
    if (!this.vscode) {
      return Promise.reject(new Error("VsCodeTransport: acquireVsCodeApi 不可用，请在 VSCode Webview 中使用"));
    }
    const id = ++this.hostMessageId;
    return new Promise((resolve, reject) => {
      this.pendingHost.set(id, { resolve, reject });
      this.vscode!.postMessage({ id, method, payload });
      setTimeout(() => {
        if (this.pendingHost.has(id)) {
          this.pendingHost.delete(id);
          reject(new Error(`VsCodeTransport: 请求超时（${method}）`));
        }
      }, 30000);
    });
  }

  /** postMessage 无应答语义：自造 tid 往返，宿主以 `rpc-transport-ack` 回包 */
  private postWithAck(m: PostMessageClientMsg): Promise<unknown> {
    if (!this.vscode) {
      return Promise.reject(new Error("VsCodeTransport: acquireVsCodeApi 不可用，请在 VSCode Webview 中使用"));
    }
    const tid = ++this.transportId;
    return new Promise((resolve, reject) => {
      this.pendingTransport.set(tid, { resolve, reject });
      this.vscode!.postMessage({ type: "rpc-transport", tid, m });
      setTimeout(() => {
        if (this.pendingTransport.has(tid)) {
          this.pendingTransport.delete(tid);
          reject(new Error("VsCodeTransport: rpc-transport 请求超时"));
        }
      }, 30000);
    });
  }
}
