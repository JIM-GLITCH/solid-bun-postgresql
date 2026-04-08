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
import { SubscriptionRequiredError } from "./subscription-license";

export interface VscodeWebview {
  postMessage(message: unknown): Thenable<boolean>;
}

export type VscodeMessageHandlerOptions = {
  /** 在 RPC 与 subscribe-events 前执行（Extension Host 从 Secret 取 token 并调订阅服务） */
  assertLicensed?: () => Promise<void>;
};

function postRpcError(
  webview: VscodeWebview,
  id: number | undefined,
  e: unknown
): void {
  if (e instanceof SubscriptionRequiredError) {
    const msg = e.message;
    if (typeof id === "number") {
      void webview.postMessage({ id, error: msg, subscriptionRequired: true });
    } else {
      // subscribe-events 无 id：用伪 SSE 推给已注册的 onmessage
      void webview.postMessage({
        type: "sse",
        data: { type: "ERROR", message: msg, timestamp: Date.now() },
      });
    }
    return;
  }
  if (typeof id === "number") {
    void webview.postMessage({ id, error: (e as Error)?.message ?? String(e) });
  }
}

/** 创建 VSCode Webview 的消息处理器 */
export function createVscodeMessageHandler(webview: VscodeWebview, opts?: VscodeMessageHandlerOptions) {
  const eventUnsubscribes = new Map<string, () => void>();
  const assertLicensed = opts?.assertLicensed;

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
        if (assertLicensed) await assertLicensed();
        const unsub = subscribeSessionEvents(sid, (msg) => {
          webview.postMessage({ type: "sse", data: msg });
        });
        eventUnsubscribes.set(sid, unsub);
      } catch (e) {
        postRpcError(webview, id, e);
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
      if (assertLicensed) await assertLicensed();
      const result = await handleApiRequest(method as ApiMethod, payload as any);
      webview.postMessage({ id, data: result });
    } catch (e: unknown) {
      postRpcError(webview, id, e);
    }
  };
}
