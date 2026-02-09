/**
 * 前后端消息通信抽象层
 * 支持不同运行环境：Web (fetch+SSE) / VSCode (postMessage)
 */

import type { PostgresLoginParams, SSEMessage, ConnectPostgresRequest } from "./types";

/** API 方法名 */
export type ApiMethod =
  | "get-public-key"
  | "connect-postgres"
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
  | "postgres/foreign-keys";

/** 请求载荷（不含 sessionId，由调用方注入） */
export type ApiRequestPayload = {
  "get-public-key": { sessionId?: string };
  "connect-postgres": ConnectPostgresRequest;
  "postgres/query": { query: string };
  "postgres/query-stream": { query: string; batchSize?: number };
  "postgres/query-stream-more": { batchSize?: number };
  "postgres/save-changes": { sql: string };
  "postgres/cancel-query": {};
  "postgres/query-readonly": { query: string; limit?: number };
  "postgres/schemas": {};
  "postgres/tables": { schema: string };
  "postgres/columns": { schema: string; table: string };
  "postgres/indexes": { schema: string; table: string };
  "postgres/foreign-keys": { schema: string; table: string };
};

/** 传输层接口：前端通过此接口与后端通信 */
export interface IApiTransport {
  /** 发送 RPC 请求 */
  request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M] & { sessionId: string }
  ): Promise<unknown>;

  /** 订阅服务端推送（数据库 NOTICE/ERROR 等） */
  subscribeEvents(sessionId: string, callback: (msg: SSEMessage) => void): () => void;
}
