/**
 * Electrobun 传输实现：通过 RPC 与主进程通信，主进程直接调用 api-core
 * 用于 electrobun-app 桌面构建，无 Rust 依赖
 */

import type {
  IApiTransport,
  ApiMethod,
  ApiRequestPayload,
  SSEMessage,
  ServerPushMessage,
  TransportOnSubscribe,
} from "../../shared/src";

/** 全局 RPC 桥，由 index-electrobun 在页面加载时注入 */
declare global {
  interface Window {
    __electrobunApiRequest?: (method: string, payload: unknown) => Promise<unknown>;
  }
}

const serverPushListeners = new Set<(msg: ServerPushMessage) => void>();

/** 注册全局事件回调（主进程 push 时由 index-electrobun 调用） */
export function handleBackendEvent(payload: { connectionId?: string; data?: SSEMessage; error?: string }) {
  const cid = payload.connectionId;
  if (payload.error && cid) {
    const event: SSEMessage = { type: "ERROR", message: payload.error!, timestamp: Date.now() };
    for (const listener of serverPushListeners) listener({ topic: "connection-event", connectionId: cid, event });
    return;
  }
  if (payload.data && cid) {
    for (const listener of serverPushListeners) {
      listener({ topic: "connection-event", connectionId: cid, event: payload.data });
    }
  }
}

export class ElectrobunTransport implements IApiTransport {
  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown> {
    const fn = window.__electrobunApiRequest;
    if (!fn) throw new Error("Electrobun RPC 未就绪，请确保在桌面应用内运行");
    return fn(method, payload);
  }

  on(sub: TransportOnSubscribe): () => void {
    switch (sub.event) {
      case "push":
        serverPushListeners.add(sub.handler);
        return () => serverPushListeners.delete(sub.handler);
      case "account": {
        const wrapped = (msg: ServerPushMessage) => {
          if (msg.topic === "account") sub.handler(msg.account);
        };
        serverPushListeners.add(wrapped);
        return () => serverPushListeners.delete(wrapped);
      }
      case "connection": {
        const { connectionId } = sub;
        const wrapped = (msg: ServerPushMessage) => {
          if (msg.topic !== "connection-event" || msg.connectionId !== connectionId) return;
          sub.handler(msg.event);
        };
        serverPushListeners.add(wrapped);
        return () => serverPushListeners.delete(wrapped);
      }
    }
  }
}
