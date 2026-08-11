/**
 * RPC 传输实现（Web）：基于 RpcSessionClient 的 jsonrpc 会话，
 * 替代旧 `POST /api/${method}` + `/api/events` SSE。
 * `IApiTransport` 接口不变，业务调用点零改动。
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
import { createHttpClientTransport } from "./http-client-transport";
import { METHOD_TYPES } from "./method-types";
import { formatUnknownError } from "../format-unknown-error";
import { SubscriptionRequiredError } from "../subscription/subscription-error";
import { raiseSubscriptionRequired } from "../subscription/subscription-prompt";

export type RpcTransportOptions = {
  /** RPC 服务基址；空串为同源（开发时由 Vite 代理 /rpc 到后端） */
  baseUrl?: string;
  /** 随 subscription/assert 载荷注入的 Bearer token（原 Authorization 头语义） */
  getBearerToken?: () => string | null;
};

export class RpcTransport implements IApiTransport {
  private readonly client: RpcSessionClient;
  /** 会话就绪（shakehand + buildconnection 完成）后 resolve */
  private readonly ready: Promise<void>;
  private readonly connectionListeners = new Map<string, Set<(msg: SSEMessage) => void>>();
  private readonly pushListeners = new Set<(msg: ServerPushMessage) => void>();
  private readonly accountListeners = new Set<(msg: AccountStateMessage) => void>();

  constructor(private readonly opts: RpcTransportOptions = {}) {
    this.client = new RpcSessionClient(createHttpClientTransport(opts.baseUrl ?? ""));

    // 每次会话（重）建立都要在新连接上重挂通知处理器
    this.client.onSession(() => {
      this.client.onNotification(CONNECTION_EVENT_NOTIFICATION, ({ connectionId, event }) => {
        const set = this.connectionListeners.get(connectionId);
        if (!set) return;
        for (const handler of set) handler(event);
      });
      this.client.onNotification(SERVER_PUSH_NOTIFICATION, (params) => {
        if (params.topic === "account") {
          const msg: ServerPushMessage = { topic: "account", account: params.account };
          for (const handler of this.pushListeners) handler(msg);
          for (const handler of this.accountListeners) handler(params.account);
        }
      });
    });

    this.ready = new Promise<void>((resolve, reject) => {
      const off = this.client.onSession(() => {
        off();
        resolve();
      });
      // listen 会一直挂着维持 SSE；会话建立即视为就绪，失败才 reject
      this.client.listen().catch((e) => {
        off();
        reject(e);
      });
    });
  }

  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown> {
    const type = METHOD_TYPES[method as HttpRpcMethod];
    if (!type) throw new Error(`RpcTransport 不支持该方法：${method}`);
    try {
      await this.ready;
    } catch {
      throw new Error(
        `网络请求失败（${method}）：无法连接 API。请确认后端已启动（如 127.0.0.1:3101），且开发服务器已将 /rpc 代理到该地址。`
      );
    }
    let params: unknown = payload;
    if (method === "subscription/assert") {
      params = { ...(payload as object), accessToken: this.opts.getBearerToken?.() ?? null };
    }
    try {
      return await this.client.sendRequest(type, params);
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
