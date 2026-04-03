/**
 * 后端 API 处理器 - VSCode 实现：postMessage
 * 用于 VSCode 扩展的 Extension Host 端
 *
 * 使用方式：
 *   import { createVscodeMessageHandler } from "../backend/api-handlers-vscode";
 *   const handleMessage = createVscodeMessageHandler(webview);
 *   webview.webview.onDidReceiveMessage(handleMessage);
 */

import type { ApiMethod, ApiRequestPayload } from "../shared/src";
import { handleApiRequest, subscribeSessionEvents } from "./api-core";

export interface VscodeWebview {
  postMessage(message: unknown): Thenable<boolean>;
}

/** 创建 VSCode Webview 的消息处理器 */
export function createVscodeMessageHandler(webview: VscodeWebview) {
  const eventUnsubscribes = new Map<string, () => void>();

  return async (message: {
    id?: number;
    method?: string;
    payload?: unknown;
    type?: string;
    sessionId?: string;
    /** 旧版 webview；与 `sessionId` 同义 */
    connectionId?: string;
    /** 与 `db/*` 载荷中的 `connectionId` 相同（会话键） */
    connectionSessionId?: string;
  }) => {
    const { id, method, payload, type, sessionId, connectionId, connectionSessionId } = message;
    const sid = sessionId ?? connectionSessionId ?? connectionId;

    // 订阅/取消订阅事件推送
    if (type === "subscribe-events" && sid) {
      try {
        const unsub = subscribeSessionEvents(sid, (msg) => {
          webview.postMessage({ type: "sse", data: msg });
        });
        eventUnsubscribes.set(sid, unsub);
      } catch (e) {
        webview.postMessage({ id, error: (e as Error).message });
      }
      return;
    }

    if (type === "unsubscribe-events" && sid) {
      eventUnsubscribes.get(sid)?.();
      eventUnsubscribes.delete(sid);
      return;
    }

    // RPC 请求（统一转发到 api-core）
    if (typeof id !== "number" || !method || payload == null) return;

    try {
      const result = await handleApiRequest(method as ApiMethod, payload as any);
      webview.postMessage({ id, data: result });
    } catch (e: any) {
      webview.postMessage({ id, error: e?.message ?? String(e) });
    }
  };
}
