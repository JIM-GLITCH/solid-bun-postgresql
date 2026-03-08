/**
 * Electrobun 传输实现：通过 RPC 与主进程通信，主进程直接调用 api-core
 * 用于 electrobun-app 桌面构建，无 Rust 依赖
 */

import type { IApiTransport, ApiMethod, ApiRequestPayload, SSEMessage } from "../../shared/src";

/** 全局 RPC 桥，由 index-electrobun 在页面加载时注入 */
declare global {
  interface Window {
    __electrobunApiRequest?: (method: string, payload: unknown) => Promise<unknown>;
  }
}

/** 按 connectionId 存储的回调，用于分发主进程推送的 backend_event */
const eventCallbacks = new Map<string, Set<(msg: SSEMessage) => void>>();

/** 注册全局事件回调（主进程 push 时由 index-electrobun 调用） */
export function handleBackendEvent(payload: { connectionId?: string; data?: SSEMessage; error?: string }) {
  const cid = payload.connectionId;
  if (payload.error && cid) {
    const cbs = eventCallbacks.get(cid);
    cbs?.forEach((cb) => cb({ type: "ERROR", message: payload.error!, timestamp: Date.now() }));
    return;
  }
  if (payload.data && cid) {
    const cbs = eventCallbacks.get(cid);
    cbs?.forEach((cb) => cb(payload.data!));
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

  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
    let set = eventCallbacks.get(connectionId);
    if (!set) {
      set = new Set();
      eventCallbacks.set(connectionId, set);
    }
    set.add(callback);

    return () => {
      set?.delete(callback);
      if (set?.size === 0) eventCallbacks.delete(connectionId);
    };
  }
}
