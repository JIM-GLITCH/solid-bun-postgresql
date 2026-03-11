/**
 * 前端 API 客户端：基于 Transport 抽象，提供类型安全的接口
 */

import { getTransport } from "./transport";
import type { PostgresLoginParams, ColumnEditableInfo, SSEMessage } from "../shared/src";

const api = () => getTransport();

/** 连接数据库，返回 connectionId */
export async function connectPostgres(connectionId: string, params: PostgresLoginParams) {
  const payload = { ...params, connectionId };
  return api().request("connect-postgres", payload) as Promise<{ sucess: boolean; error?: unknown }>;
}

/** 断开指定连接 */
export async function disconnectPostgres(connectionId: string) {
  return api().request("disconnect-postgres", { connectionId }) as Promise<{ success: boolean; error?: string }>;
}

/** 流式查询 - 第一批 */
export async function queryStream(connectionId: string, query: string, batchSize = 100) {
  return api().request("postgres/query-stream", { query, connectionId, batchSize }) as Promise<{
    rows: any[][];
    columns: ColumnEditableInfo[];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 流式查询 - 加载更多 */
export async function queryStreamMore(connectionId: string, batchSize = 100) {
  return api().request("postgres/query-stream-more", { connectionId, batchSize }) as Promise<{
    rows: any[][];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 取消查询 */
export async function cancelQuery(connectionId: string) {
  return api().request("postgres/cancel-query", { connectionId }) as Promise<{ success: boolean; cancelled?: boolean; message?: string; error?: string }>;
}

/** 保存修改 */
export async function saveChanges(connectionId: string, sql: string) {
  return api().request("postgres/save-changes", { sql, connectionId }) as Promise<{ success: boolean; rowCount?: number; error?: string }>;
}

/** 只读查询（Sidebar 等） */
export async function queryReadonly(connectionId: string, query: string, limit = 1000) {
  return api().request("postgres/query-readonly", { connectionId, query, limit }) as Promise<{
    rows: any[][];
    columns: ColumnEditableInfo[];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 获取 schemas */
export async function getSchemas(connectionId: string) {
  return api().request("postgres/schemas", { connectionId }) as Promise<{ schemas: string[]; error?: string }>;
}

/** 获取表/视图 */
export async function getTables(connectionId: string, schema: string) {
  return api().request("postgres/tables", { connectionId, schema }) as Promise<{
    tables: string[];
    views: string[];
    functions?: Array<{ oid: number; schema: string; name: string; args: string }>;
    error?: string;
  }>;
}

/** 获取列信息 */
export async function getColumns(connectionId: string, schema: string, table: string) {
  return api().request("postgres/columns", { connectionId, schema, table }) as Promise<{ columns: any[]; error?: string }>;
}

/** 获取索引 */
export async function getIndexes(connectionId: string, schema: string, table: string) {
  return api().request("postgres/indexes", { connectionId, schema, table }) as Promise<{ indexes: any[]; error?: string }>;
}

/** 获取外键 */
export async function getForeignKeys(connectionId: string, schema: string, table: string) {
  return api().request("postgres/foreign-keys", { connectionId, schema, table }) as Promise<{
    outgoing: any[];
    incoming: any[];
    error?: string;
  }>;
}

/** 获取 PostgreSQL 数据类型列表 */
export async function getDataTypes(connectionId: string) {
  return api().request("postgres/data-types", { connectionId }) as Promise<{ types: string[]; error?: string }>;
}

/** 执行 DDL（CREATE/ALTER TABLE 等） */
export async function executeDdl(connectionId: string, sql: string) {
  return api().request("postgres/execute-ddl", { connectionId, sql }) as Promise<{ success: boolean; error?: string }>;
}

/** 获取表/视图的 DDL */
export async function getTableDdl(connectionId: string, schema: string, table: string) {
  return api().request("postgres/table-ddl", { connectionId, schema, table }) as Promise<{ ddl: string; error?: string }>;
}

/** 订阅服务端推送事件 */
export function subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
  return api().subscribeEvents(connectionId, callback);
}

/** 调试：检查 pldebugger 是否可用 */
export async function debugCheck(connectionId: string) {
  return api().request("postgres/debug/check", { connectionId }) as Promise<{ available: boolean; error?: string }>;
}

/** 调试：获取可调试函数列表 */
export async function debugGetFunctions(connectionId: string, schema?: string) {
  return api().request("postgres/debug/functions", { connectionId, schema }) as Promise<{
    functions: Array<{ oid: number; schema: string; name: string; args: string }>;
  }>;
}

/** 调试：开始直接调试 */
export async function debugStartDirect(connectionId: string, funcOid: number, args: string[] = []) {
  return api().request("postgres/debug/start-direct", { connectionId, funcOid, args }) as Promise<{
    debugSessionId: string;
    breakpoint?: { funcOid: number; lineNumber: number };
    source?: string;
    stack?: any[];
    variables?: any[];
  }>;
}

/** 调试：继续 */
export async function debugContinue(connectionId: string, debugSessionId: string) {
  return api().request("postgres/debug/continue", { connectionId, debugSessionId }) as Promise<{
    stopped: boolean;
    breakpoint?: { funcOid: number; lineNumber: number };
    source?: string;
    stack?: any[];
    variables?: any[];
    done?: boolean;
  }>;
}

/** 调试：单步进入 */
export async function debugStepInto(connectionId: string, debugSessionId: string) {
  return api().request("postgres/debug/step-into", { connectionId, debugSessionId }) as Promise<{
    stopped: boolean;
    breakpoint?: { funcOid: number; lineNumber: number };
    source?: string;
    stack?: any[];
    variables?: any[];
  }>;
}

/** 调试：单步越过 */
export async function debugStepOver(connectionId: string, debugSessionId: string) {
  return api().request("postgres/debug/step-over", { connectionId, debugSessionId }) as Promise<{
    stopped: boolean;
    breakpoint?: { funcOid: number; lineNumber: number };
    source?: string;
    stack?: any[];
    variables?: any[];
  }>;
}

/** 调试：中止 */
export async function debugAbort(connectionId: string, debugSessionId: string) {
  return api().request("postgres/debug/abort", { connectionId, debugSessionId }) as Promise<{ success: boolean }>;
}

/** 调试：获取状态 */
export async function debugGetState(connectionId: string, debugSessionId: string) {
  return api().request("postgres/debug/state", { connectionId, debugSessionId }) as Promise<{
    source?: string;
    stack?: any[];
    variables?: any[];
    breakpoints?: any[];
  }>;
}

/** 调试：设置断点 */
export async function debugSetBreakpoint(
  connectionId: string,
  debugSessionId: string,
  funcOid: number,
  lineNumber: number
) {
  return api().request("postgres/debug/set-breakpoint", {
    connectionId,
    debugSessionId,
    funcOid,
    lineNumber,
  }) as Promise<{ success: boolean }>;
}

/** 调试：删除断点 */
export async function debugDropBreakpoint(
  connectionId: string,
  debugSessionId: string,
  funcOid: number,
  lineNumber: number
) {
  return api().request("postgres/debug/drop-breakpoint", {
    connectionId,
    debugSessionId,
    funcOid,
    lineNumber,
  }) as Promise<{ success: boolean }>;
}
