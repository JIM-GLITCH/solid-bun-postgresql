/**
 * Tauri 传输实现：通过 invoke("api_request") 与 sidecar 后端 pipe 通信
 * 用于 tauri-app 构建时替换 HttpTransport
 *
 * 使用方式：
 *   import { setTransport } from "./transport";
 *   import { TauriTransport } from "./transport/tauri-transport";
 *   setTransport(new TauriTransport());
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { IApiTransport, ApiMethod, ApiRequestPayload, SSEMessage } from "../../shared/src";

export class TauriTransport implements IApiTransport {
  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M] & { sessionId: string }
  ): Promise<unknown> {
    const result = await invoke("api_request", { method, payload });
    return result;
  }

  subscribeEvents(sessionId: string, callback: (msg: SSEMessage) => void): () => void {
    const holder = { unlisten: null as (() => void) | null, cancelled: false };

    listen<{ sessionId?: string; data?: SSEMessage; error?: string }>("backend-event", (event) => {
      const payload = event.payload;
      if (payload.sessionId !== sessionId) return;
      if (payload.error) {
        callback({
          type: "ERROR",
          message: payload.error,
          timestamp: Date.now(),
        });
        return;
      }
      if (payload.data) callback(payload.data);
    }).then((fn) => {
      holder.unlisten = fn;
      if (holder.cancelled) fn();
    });

    invoke("api_request", {
      method: "subscribe-events",
      payload: { sessionId },
    }).catch(() => {});

    return () => {
      holder.cancelled = true;
      invoke("api_request", {
        method: "unsubscribe-events",
        payload: { sessionId },
      }).catch(() => {});
      holder.unlisten?.();
    };
  }
}
