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
  | "postgres/debug/check"
  | "postgres/debug/functions"
  | "postgres/debug/start-direct"
  | "postgres/debug/continue"
  | "postgres/debug/step-into"
  | "postgres/debug/step-over"
  | "postgres/debug/abort"
  | "postgres/debug/state"
  | "postgres/debug/set-breakpoint"
  | "postgres/debug/drop-breakpoint";

/** 请求载荷 */
export type ApiRequestPayload = {
  "connections/list": {};
  "connections/save": { id: string } & PostgresLoginParams;
  "connections/delete": { id: string };
  "connections/connect": { id: string };
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
  "postgres/debug/check": { connectionId: string };
  "postgres/debug/functions": { connectionId: string; schema?: string };
  "postgres/debug/start-direct": { connectionId: string; funcOid: number; args?: string[] };
  "postgres/debug/continue": { connectionId: string; debugSessionId: string };
  "postgres/debug/step-into": { connectionId: string; debugSessionId: string };
  "postgres/debug/step-over": { connectionId: string; debugSessionId: string };
  "postgres/debug/abort": { connectionId: string; debugSessionId: string };
  "postgres/debug/state": { connectionId: string; debugSessionId: string };
  "postgres/debug/set-breakpoint": { connectionId: string; debugSessionId: string; funcOid: number; lineNumber: number };
  "postgres/debug/drop-breakpoint": { connectionId: string; debugSessionId: string; funcOid: number; lineNumber: number };
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
