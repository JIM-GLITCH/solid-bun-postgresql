/**
 * 前后端消息通信抽象层
 * 支持不同运行环境：Web (fetch+SSE) / VSCode (postMessage)
 */

import type { PostgresLoginParams, SSEMessage, ConnectPostgresRequest } from "./types";

/** API 方法名 */
export type ApiMethod =
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
  | "postgres/foreign-keys";

/** 请求载荷 */
export type ApiRequestPayload = {
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
