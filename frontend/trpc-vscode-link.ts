/**
 * 自定义 tRPC link：把 tRPC 的 query / mutation / subscription 经
 * vscode-messenger（TypeFox）转发给 Extension Host。
 *
 * 设计要点：
 * - vscode-messenger 只做「纯传输层」——请求/响应配对与通知分发由库完成，
 *   这里不手写 messageId / pending 表；
 * - messenger 的 method 与业务无关，`path` / `type` / `input` 全部塞进 params
 *   （宿主能力同样是 tRPC procedure，不存在第二条通道）；
 * - 查询 / 变更：`sendExtensionRequest(RPC_CALL, ...)` 一次往返；
 * - 订阅：`sendExtensionRequest(SUBSCRIBE, ...)` 建立，数据经
 *   SUBSCRIBE_DATA / SUBSCRIBE_ERROR / SUBSCRIBE_COMPLETE 通知回流（按 op.id 多路复用），
 *   取消时发送 UNSUBSCRIBE 通知。
 */

import { observable } from "@trpc/server/observable";
import type { TRPCLink } from "@trpc/client";
import type { AppRouter } from "../backend/trpc";
import {
  RPC_CALL,
  SUBSCRIBE,
  SUBSCRIBE_COMPLETE,
  SUBSCRIBE_DATA,
  SUBSCRIBE_ERROR,
  UNSUBSCRIBE,
} from "../shared/src/vscode-messenger-rpc";
import { getWebviewMessenger } from "./vscode-messenger";

/** messenger 抛出的 `ResponseError`（普通对象）→ 带 `data` 的标准 Error，便于上层统一映射。 */
function toError(err: unknown): Error {
  const e = err as { message?: string; data?: unknown } | undefined;
  const out = new Error(typeof e?.message === "string" ? e.message : String(err));
  if (e && typeof e === "object" && "data" in e) {
    (out as Error & { data?: unknown }).data = e.data;
  }
  return out;
}

type SubscriptionEmitter = {
  next(value: unknown): void;
  error(err: unknown): void;
  complete(): void;
};

/** 活跃订阅：按 tRPC op.id 多路复用宿主回推的通知。 */
const activeSubscriptions = new Map<number, SubscriptionEmitter>();
let subscriptionListenerReady = false;

function ensureSubscriptionListener(): void {
  if (subscriptionListenerReady) return;
  subscriptionListenerReady = true;
  const messenger = getWebviewMessenger();
  messenger.onNotification(SUBSCRIBE_DATA, ({ opId, value }) => {
    activeSubscriptions.get(opId)?.next(value);
  });
  messenger.onNotification(SUBSCRIBE_ERROR, ({ opId, message, data }) => {
    const emitter = activeSubscriptions.get(opId);
    if (!emitter) return;
    activeSubscriptions.delete(opId);
    emitter.error(toError({ message, data }));
  });
  messenger.onNotification(SUBSCRIBE_COMPLETE, ({ opId }) => {
    const emitter = activeSubscriptions.get(opId);
    if (!emitter) return;
    activeSubscriptions.delete(opId);
    emitter.complete();
  });
}

/** 创建经 vscode-messenger 通信的 tRPC link（仅在 VSCode Webview 使用）。 */
export function createVscodeMessengerLink(): TRPCLink<AppRouter> {
  return () => ({ op }) =>
    observable((observer) => {
      const messenger = getWebviewMessenger();

      if (op.type === "subscription") {
        ensureSubscriptionListener();
        const opId = op.id;
        let disposed = false;
        activeSubscriptions.set(opId, {
          next: (value) => observer.next({ result: { type: "data", data: value } }),
          error: (err) => observer.error(err as never),
          complete: () => observer.complete(),
        });

        messenger
          .sendExtensionRequest(SUBSCRIBE, { opId, path: op.path, input: op.input })
          .catch((err) => {
            if (disposed) return;
            activeSubscriptions.delete(opId);
            observer.error(toError(err) as never);
          });

        return () => {
          disposed = true;
          activeSubscriptions.delete(opId);
          messenger.sendExtensionNotification(UNSUBSCRIBE, { opId });
        };
      }

      messenger
        .sendExtensionRequest(RPC_CALL, {
          path: op.path,
          type: op.type,
          input: op.input,
        })
        .then((data) => {
          observer.next({ result: { type: "data", data } });
          observer.complete();
        })
        .catch((err) => observer.error(toError(err) as never));

      return () => {
        /* 查询 / 变更无需取消 */
      };
    });
}
