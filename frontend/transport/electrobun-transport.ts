/**
 * Electrobun 传输实现：jsonrpc 会话经 electrobun BrowserView RPC 通道与主进程通信。
 * 主进程侧用 PostMessageServerTransport + buildRpcStack 承载同一套 DbServer/AppServer。
 *
 * 通道约定（见 electrobun-rpc.ts / electrobun-app/src/bun/index.ts）：
 * - 上行：`api_request({ method: "rpc-transport", payload: PostMessageClientMsg, licenseJwt })`
 * - 下行：`backend_event({ rpcMsg })` → `handleBackendEvent` 喂入本传输
 */

import { ResponseError } from "vscode-jsonrpc";
import {
  CONNECTION_EVENT_NOTIFICATION,
  SERVER_PUSH_NOTIFICATION,
  type AccountStateMessage,
  type HttpRpcMethod,
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

export type ElectrobunTransportOptions = {
  /** 上行通道：把客户端消息发给主进程并等待应答（electrobun rpc request） */
  post: (m: PostMessageClientMsg) => Promise<unknown>;
};

let singleton: ElectrobunTransport | undefined;

/** 主进程 backend_event 推送入口（index-electrobun.tsx 注册到 electrobun RPC） */
export function handleBackendEvent(payload: { rpcMsg?: unknown }): void {
  if (payload?.rpcMsg) singleton?.receiveServerMessage(payload.rpcMsg);
}

export class ElectrobunTransport implements IApiTransport {
  private clientTransport: PostMessageClientTransport;
  private session: RpcSessionClient;
  private ready: Promise<void>;

  private readonly connectionListeners = new Map<string, Set<(msg: SSEMessage) => void>>();
  private readonly pushListeners = new Set<(msg: ServerPushMessage) => void>();
  private readonly accountListeners = new Set<(msg: AccountStateMessage) => void>();

  constructor(opts: ElectrobunTransportOptions) {
    singleton = this;
    this.clientTransport = new PostMessageClientTransport({ post: opts.post });
    this.session = new RpcSessionClient(this.clientTransport);

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
  }

  /** 主进程下行 jsonrpc 消息喂入 */
  receiveServerMessage(msg: unknown): void {
    this.clientTransport.receiveServerMessage(msg as never);
  }

  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown> {
    const type = METHOD_TYPES[method as HttpRpcMethod];
    if (!type) throw new Error(`ElectrobunTransport 不支持该方法：${method}`);
    try {
      await this.ready;
    } catch {
      throw new Error(`请求失败（${method}）：与主进程的 jsonrpc 会话未建立`);
    }
    try {
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
}
