/**
 * VS Code Webview ↔ Extension Host 的**传输协议**（TypeFox vscode-messenger）。
 *
 * vscode-messenger 只负责 postMessage 的请求/响应配对与通知分发。这里刻意**不定义任何
 * 业务/宿主方法名**——唯一的请求 method 是 `RPC_CALL`，tRPC 的 `path`、调用类型与 `input`
 * 全部作为 params 传递；宿主侧按 `params.path` 分派：
 *
 * - 业务 procedure（`db.*` / `ai.*` / …）→ 直接调 tRPC `appRouter`
 * - 宿主能力（`host.*`）与宿主专属的订阅（如 `subscription.onAccountState`）
 *   → 由 extension host 用 procedure override 就地实现（见 `backend/vscode-messenger-bridge`）
 *
 * 因此客户端调用面只有 tRPC，不存在第二条「宿主方法」通道。
 *
 * 仅类型与常量，无副作用。
 */

import type { NotificationType, RequestType } from "vscode-messenger-common";

// ── 查询 / 变更：一次请求一次响应 ────────────────────────────────────────

export interface RpcCallParams {
  /** tRPC procedure 路径，如 `db.schemas` / `host.saveFile` */
  path: string;
  type: "query" | "mutation";
  input: unknown;
}

export const RPC_CALL: RequestType<RpcCallParams, unknown> = { method: "dbplayer/rpc" };

// ── 订阅：建立（request）→ 数据/错误/完成（notification）→ 取消（notification）──

export interface SubscriptionStartParams {
  /** 订阅 id（直接复用 tRPC 的 op.id，前端据此多路复用） */
  opId: number;
  path: string;
  input: unknown;
}

export const SUBSCRIBE: RequestType<SubscriptionStartParams, void> = { method: "dbplayer/subscribe" };

export const UNSUBSCRIBE: NotificationType<{ opId: number }> = { method: "dbplayer/unsubscribe" };

export interface SubscriptionDataPayload {
  opId: number;
  value: unknown;
}

export interface SubscriptionErrorPayload {
  opId: number;
  message: string;
  /** 透传业务错误附加信息（如 `{ subscriptionRequired: true }`） */
  data?: unknown;
}

export const SUBSCRIBE_DATA: NotificationType<SubscriptionDataPayload> = { method: "dbplayer/subscribe/data" };
export const SUBSCRIBE_ERROR: NotificationType<SubscriptionErrorPayload> = { method: "dbplayer/subscribe/error" };
export const SUBSCRIBE_COMPLETE: NotificationType<{ opId: number }> = { method: "dbplayer/subscribe/complete" };
