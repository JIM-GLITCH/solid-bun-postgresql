/**
 * 前后端消息通信抽象层
 * 支持不同运行环境：Web (fetch+SSE) / VSCode (postMessage)
 */

import type { PostgresLoginParams, SSEMessage, ConnectPostgresRequest } from "./types";

/** API 方法名 */
export type ApiMethod =
  | "connections/list"
  | "connections/save"
  | "connections/delete"
  | "connections/connect"
  | "query-history/add"
  | "query-history/search"
  | "query-history/delete"
  | "query-history/clear"
  | "connect-postgres"
  | "disconnect-postgres"
  | "postgres/query"
  | "postgres/query-stream"
  | "postgres/query-stream-more"
  | "postgres/save-changes"
  | "postgres/cancel-query"
  | "postgres/query-readonly"
  | "postgres/schemas"
  | "postgres/tables"
  | "postgres/columns"
  | "postgres/indexes"
  | "postgres/foreign-keys"
  | "postgres/data-types"
  | "postgres/execute-ddl"
  | "postgres/table-ddl"
  | "postgres/function-ddl";

/** 请求载荷 */
export type ApiRequestPayload = {
  "connections/list": {};
  "connections/save": { id: string } & PostgresLoginParams;
  "connections/delete": { id: string };
  "connections/connect": { id: string };
  "query-history/add": { sql: string; connectionId?: string };
  "query-history/search": { keyword?: string; since?: number; until?: number };
  "query-history/delete": { id: string };
  "query-history/clear": {};
  "connect-postgres": ConnectPostgresRequest;
  "disconnect-postgres": { connectionId: string };
  "postgres/query": { query: string; connectionId: string };
  "postgres/query-stream": { query: string; batchSize?: number; connectionId: string };
  "postgres/query-stream-more": { batchSize?: number; connectionId: string };
  "postgres/save-changes": { sql: string; connectionId: string };
  "postgres/cancel-query": { connectionId: string };
  "postgres/query-readonly": { query: string; limit?: number; connectionId: string };
  "postgres/schemas": { connectionId: string };
  "postgres/tables": { schema: string; connectionId: string };
  "postgres/columns": { schema: string; table: string; connectionId: string };
  "postgres/indexes": { schema: string; table: string; connectionId: string };
  "postgres/foreign-keys": { schema: string; table: string; connectionId: string };
  "postgres/data-types": { connectionId: string };
  "postgres/execute-ddl": { connectionId: string; sql: string };
  "postgres/table-ddl": { connectionId: string; schema: string; table: string };
  "postgres/function-ddl": { connectionId: string; schema: string; function: string; oid?: number };
};

/** 传输层接口：前端通过此接口与后端通信 */
export interface IApiTransport {
  /** 发送 RPC 请求 */
  request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown>;

  /** 订阅服务端推送（数据库 NOTICE/ERROR 等） */
  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void;
}
