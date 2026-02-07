/**
 * 前端 API 客户端：基于 Transport 抽象，提供类型安全的接口
 */

import { getTransport } from "./transport";
import type { PostgresLoginParams, ColumnEditableInfo } from "@project/shared";

const api = () => getTransport();

/** 连接数据库 */
export async function connectPostgres(sessionId: string, params: PostgresLoginParams) {
  return api().request("connect-postgres", { ...params, sessionId }) as Promise<{ sucess: boolean; error?: unknown }>;
}

/** 流式查询 - 第一批 */
export async function queryStream(sessionId: string, query: string, batchSize = 100) {
  return api().request("postgres/query-stream", { query, sessionId, batchSize }) as Promise<{
    rows: any[][];
    columns: ColumnEditableInfo[];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 流式查询 - 加载更多 */
export async function queryStreamMore(sessionId: string, batchSize = 100) {
  return api().request("postgres/query-stream-more", { sessionId, batchSize }) as Promise<{
    rows: any[][];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 取消查询 */
export async function cancelQuery(sessionId: string) {
  return api().request("postgres/cancel-query", { sessionId }) as Promise<{ success: boolean; cancelled?: boolean; message?: string; error?: string }>;
}

/** 保存修改 */
export async function saveChanges(sessionId: string, sql: string) {
  return api().request("postgres/save-changes", { sql, sessionId }) as Promise<{ success: boolean; rowCount?: number; error?: string }>;
}

/** 只读查询（Sidebar 等） */
export async function queryReadonly(sessionId: string, query: string, limit = 1000) {
  return api().request("postgres/query-readonly", { sessionId, query, limit }) as Promise<{
    rows: any[][];
    columns: ColumnEditableInfo[];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 获取 schemas */
export async function getSchemas(sessionId: string) {
  return api().request("postgres/schemas", { sessionId }) as Promise<{ schemas: string[]; error?: string }>;
}

/** 获取表/视图 */
export async function getTables(sessionId: string, schema: string) {
  return api().request("postgres/tables", { sessionId, schema }) as Promise<{ tables: string[]; views: string[]; error?: string }>;
}

/** 获取列信息 */
export async function getColumns(sessionId: string, schema: string, table: string) {
  return api().request("postgres/columns", { sessionId, schema, table }) as Promise<{ columns: any[]; error?: string }>;
}

/** 获取索引 */
export async function getIndexes(sessionId: string, schema: string, table: string) {
  return api().request("postgres/indexes", { sessionId, schema, table }) as Promise<{ indexes: any[]; error?: string }>;
}

/** 获取外键 */
export async function getForeignKeys(sessionId: string, schema: string, table: string) {
  return api().request("postgres/foreign-keys", { sessionId, schema, table }) as Promise<{
    outgoing: any[];
    incoming: any[];
    error?: string;
  }>;
}

/** 订阅服务端推送事件 */
export function subscribeEvents(sessionId: string, callback: (msg: import("@project/shared").SSEMessage) => void): () => void {
  return api().subscribeEvents(sessionId, callback);
}
