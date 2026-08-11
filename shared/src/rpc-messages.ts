/**
 * JSON-RPC 消息契约：以 `API_METHODS` / `ApiRequestPayload` 为唯一真源，
 * 为每个 RPC 方法定义带类型的 `RequestType`（vscode-jsonrpc）。
 * 前后端共用：后端 `RpcMultiSessionServer.onRequest(TYPE, ...)` 注册，
 * 前端 `RpcSessionClient.sendRequest(TYPE, payload)` 调用。
 *
 * 方法名与旧 HTTP API（`POST /api/${method}`）保持一致，载荷结构不变。
 */

import { NotificationType, RequestType, type Message } from "vscode-jsonrpc";
import type { ApiRequestPayload } from "./transport";
import type {
  DatabaseCapabilities,
  SSEMessage,
  AccountStateMessage,
} from "./types";

// ─── connections/* ───────────────────────────────────────────────────────────

export const CONNECTIONS_LIST = new RequestType<
  ApiRequestPayload["connections/list"],
  unknown,
  void
>("connections/list");

export const CONNECTIONS_SAVE = new RequestType<
  ApiRequestPayload["connections/save"],
  { success: boolean },
  void
>("connections/save");

export const CONNECTIONS_DELETE = new RequestType<
  ApiRequestPayload["connections/delete"],
  { success: boolean },
  void
>("connections/delete");

export const CONNECTIONS_UPDATE_META = new RequestType<
  ApiRequestPayload["connections/update-meta"],
  { success: boolean },
  void
>("connections/update-meta");

export const CONNECTIONS_REORDER = new RequestType<
  ApiRequestPayload["connections/reorder"],
  { success: boolean },
  void
>("connections/reorder");

export const CONNECTIONS_GET_PARAMS = new RequestType<
  ApiRequestPayload["connections/get-params"],
  unknown,
  void
>("connections/get-params");

export const CONNECTIONS_CONNECT = new RequestType<
  ApiRequestPayload["connections/connect"],
  unknown,
  void
>("connections/connect");

// ─── query-history/* ─────────────────────────────────────────────────────────

export const QUERY_HISTORY_ADD = new RequestType<
  ApiRequestPayload["query-history/add"],
  { success: boolean },
  void
>("query-history/add");

export const QUERY_HISTORY_SEARCH = new RequestType<
  ApiRequestPayload["query-history/search"],
  unknown,
  void
>("query-history/search");

export const QUERY_HISTORY_DELETE = new RequestType<
  ApiRequestPayload["query-history/delete"],
  { success: boolean },
  void
>("query-history/delete");

export const QUERY_HISTORY_CLEAR = new RequestType<
  ApiRequestPayload["query-history/clear"],
  { success: boolean },
  void
>("query-history/clear");

// ─── subscription/* ──────────────────────────────────────────────────────────

/** accessToken：Web 端随载荷携带 Bearer token（原 HTTP Authorization 头语义迁入） */
export const SUBSCRIPTION_ASSERT = new RequestType<
  ApiRequestPayload["subscription/assert"] & { accessToken?: string | null },
  { success: boolean },
  void
>("subscription/assert");

export const SUBSCRIPTION_ACCOUNT = new RequestType<
  ApiRequestPayload["subscription/account"],
  unknown,
  void
>("subscription/account");

// ─── db/* ────────────────────────────────────────────────────────────────────

export const DB_CONNECT = new RequestType<
  ApiRequestPayload["db/connect"],
  { connectionId: string },
  void
>("db/connect");

export const DB_DISCONNECT = new RequestType<
  ApiRequestPayload["db/disconnect"],
  void,
  void
>("db/disconnect");

export const DB_QUERY = new RequestType<
  ApiRequestPayload["db/query"],
  unknown,
  void
>("db/query");

export const DB_CAPABILITIES = new RequestType<
  ApiRequestPayload["db/capabilities"],
  DatabaseCapabilities,
  void
>("db/capabilities");

export const DB_QUERY_STREAM = new RequestType<
  ApiRequestPayload["db/query-stream"],
  unknown,
  void
>("db/query-stream");

export const DB_QUERY_STREAM_MORE = new RequestType<
  ApiRequestPayload["db/query-stream-more"],
  unknown,
  void
>("db/query-stream-more");

export const DB_SAVE_CHANGES = new RequestType<
  ApiRequestPayload["db/save-changes"],
  unknown,
  void
>("db/save-changes");

export const DB_CANCEL_QUERY = new RequestType<
  ApiRequestPayload["db/cancel-query"],
  unknown,
  void
>("db/cancel-query");

export const DB_EXPLAIN = new RequestType<
  ApiRequestPayload["db/explain"],
  unknown,
  void
>("db/explain");

export const DB_EXPLAIN_TEXT = new RequestType<
  ApiRequestPayload["db/explain-text"],
  unknown,
  void
>("db/explain-text");

export const DB_SCHEMAS = new RequestType<
  ApiRequestPayload["db/schemas"],
  unknown,
  void
>("db/schemas");

export const DB_TABLES = new RequestType<
  ApiRequestPayload["db/tables"],
  unknown,
  void
>("db/tables");

export const DB_COLUMNS = new RequestType<
  ApiRequestPayload["db/columns"],
  unknown,
  void
>("db/columns");

export const DB_INDEXES = new RequestType<
  ApiRequestPayload["db/indexes"],
  unknown,
  void
>("db/indexes");

export const DB_FOREIGN_KEYS = new RequestType<
  ApiRequestPayload["db/foreign-keys"],
  unknown,
  void
>("db/foreign-keys");

export const DB_DATA_TYPES = new RequestType<
  ApiRequestPayload["db/data-types"],
  unknown,
  void
>("db/data-types");

export const DB_EXECUTE_DDL = new RequestType<
  ApiRequestPayload["db/execute-ddl"],
  unknown,
  void
>("db/execute-ddl");

export const DB_TABLE_DDL = new RequestType<
  ApiRequestPayload["db/table-ddl"],
  unknown,
  void
>("db/table-ddl");

export const DB_FUNCTION_DDL = new RequestType<
  ApiRequestPayload["db/function-ddl"],
  unknown,
  void
>("db/function-ddl");

export const DB_SCHEMA_DUMP = new RequestType<
  ApiRequestPayload["db/schema-dump"],
  unknown,
  void
>("db/schema-dump");

export const DB_DATABASE_DUMP = new RequestType<
  ApiRequestPayload["db/database-dump"],
  unknown,
  void
>("db/database-dump");

export const DB_PRIMARY_KEYS = new RequestType<
  ApiRequestPayload["db/primary-keys"],
  unknown,
  void
>("db/primary-keys");

export const DB_UNIQUE_CONSTRAINTS = new RequestType<
  ApiRequestPayload["db/unique-constraints"],
  unknown,
  void
>("db/unique-constraints");

export const DB_IMPORT_ROWS = new RequestType<
  ApiRequestPayload["db/import-rows"],
  unknown,
  void
>("db/import-rows");

export const DB_TABLE_COMMENT = new RequestType<
  ApiRequestPayload["db/table-comment"],
  unknown,
  void
>("db/table-comment");

export const DB_CHECK_CONSTRAINTS = new RequestType<
  ApiRequestPayload["db/check-constraints"],
  unknown,
  void
>("db/check-constraints");

export const DB_PARTITION_INFO = new RequestType<
  ApiRequestPayload["db/partition-info"],
  unknown,
  void
>("db/partition-info");

export const DB_SESSION_MONITOR = new RequestType<
  ApiRequestPayload["db/session-monitor"],
  unknown,
  void
>("db/session-monitor");

export const DB_SESSION_CONTROL = new RequestType<
  ApiRequestPayload["db/session-control"],
  unknown,
  void
>("db/session-control");

export const DB_INSTALLED_EXTENSIONS = new RequestType<
  ApiRequestPayload["db/installed-extensions"],
  unknown,
  void
>("db/installed-extensions");

// ─── ai/* ────────────────────────────────────────────────────────────────────

export const AI_CONFIG_GET = new RequestType<
  ApiRequestPayload["ai/config/get"],
  unknown,
  void
>("ai/config/get");

export const AI_CONFIG_SET = new RequestType<
  ApiRequestPayload["ai/config/set"],
  { success: boolean },
  void
>("ai/config/set");

export const AI_KEY_DELETE = new RequestType<
  ApiRequestPayload["ai/key/delete"],
  { success: boolean },
  void
>("ai/key/delete");

export const AI_TEST_CONNECTION = new RequestType<
  ApiRequestPayload["ai/test-connection"],
  { success: boolean },
  void
>("ai/test-connection");

export const AI_SQL_EDIT = new RequestType<
  ApiRequestPayload["ai/sql-edit"],
  unknown,
  void
>("ai/sql-edit");

export const AI_PROMPT_BUILD = new RequestType<
  ApiRequestPayload["ai/prompt-build"],
  unknown,
  void
>("ai/prompt-build");

export const AI_PROMPT_BUILD_DIFF = new RequestType<
  ApiRequestPayload["ai/prompt-build-diff"],
  unknown,
  void
>("ai/prompt-build-diff");

// ─── server → client 通知 ──────────────────────────────────────────────

/** jsonrpc 错误码：需订阅（error.data 携带 `{ subscriptionRequired: true }`，对应旧 HTTP 403 语义） */
export const SUBSCRIPTION_REQUIRED_ERROR_CODE = -32100;

/** 数据库会话事件推送（替代旧 `/api/events` SSE） */
export type ConnectionEventParams = {
  connectionId: string;
  event: SSEMessage;
};
export const CONNECTION_EVENT_NOTIFICATION =
  new NotificationType<ConnectionEventParams>("connection-event");

/** 全局推送（账号状态等，对应旧 `TransportOnSubscribe.push`） */
export type ServerPushNotificationParams = {
  topic: "account";
  account: AccountStateMessage;
};
export const SERVER_PUSH_NOTIFICATION =
  new NotificationType<ServerPushNotificationParams>("server-push");

// ─── reliable tunnel ─────────────────────────────────────────────────────────
// 在 JSON-RPC 之上建立的可靠隧道协议。
// 每条业务消息被包装为 { seq, msg } 信封，通过 reliable/deliver 通知发送。
// 对端累积确认 reliable/ack，发送方丢弃已确认项。
// 重连后通过 reliable/sync + reliable/sync-response 重放未确认消息。
// 协议在客户端 ↔ 服务端双向对称，各维护独立的 seq / 缓冲 / ack。

export type ReliableEnvelope = { seq: number; msg: Message };

export const RELIABLE_DELIVER = new NotificationType<ReliableEnvelope>("reliable/deliver");
export const RELIABLE_ACK = new NotificationType<{ upTo: number }>("reliable/ack");
export const RELIABLE_SYNC = new NotificationType<{ lastRecvSeq: number }>("reliable/sync");
export const RELIABLE_SYNC_RESPONSE = new NotificationType<{
  replay: ReliableEnvelope[];
  gap?: boolean;
}>("reliable/sync-response");
