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

/** 流式查询 - 第一批。传 statements 时后端不再分句，避免重复计算。 */
export async function queryStream(
  connectionId: string,
  queryOrStatements: string | string[],
  batchSize = 100
) {
  const payload =
    typeof queryOrStatements === "string"
      ? { query: queryOrStatements, connectionId, batchSize }
      : { statements: queryOrStatements, connectionId, batchSize };
  return api().request("postgres/query-stream", payload) as Promise<{
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

/** 执行 EXPLAIN ANALYZE，返回 JSON 格式执行计划 */
export async function explainQuery(connectionId: string, query: string) {
  return api().request("postgres/explain", { connectionId, query }) as Promise<{
    plan: Array<{ Plan: any; "Planning Time"?: number; "Execution Time"?: number }>;
    error?: string;
  }>;
}

/** 获取 schemas */
export async function getSchemas(connectionId: string) {
  return api().request("postgres/schemas", { connectionId }) as Promise<{ schemas: string[]; error?: string }>;
}

/** 获取表/视图/函数 */
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

/** 获取主键列名 */
export async function getPrimaryKeys(connectionId: string, schema: string, table: string) {
  return api().request("postgres/primary-keys", { connectionId, schema, table }) as Promise<{ columns: string[]; error?: string }>;
}

/** 获取唯一约束（含主键），用于导入时冲突处理 */
export async function getUniqueConstraints(connectionId: string, schema: string, table: string) {
  return api().request("postgres/unique-constraints", { connectionId, schema, table }) as Promise<{
    constraints: Array<{ name: string; type: string; columns: string[] }>;
    error?: string;
  }>;
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

/** 获取函数的源码 DDL */
export async function getFunctionDdl(connectionId: string, schema: string, funcName: string, oid?: number) {
  return api().request("postgres/function-ddl", { connectionId, schema, function: funcName, oid }) as Promise<{ ddl: string; error?: string }>;
}

/** 导出指定 schema 的 SQL dump */
export async function getSchemaDump(connectionId: string, schema: string, includeData = false) {
  return api().request("postgres/schema-dump", { connectionId, schema, includeData }) as Promise<{ dump: string; error?: string }>;
}

/** 导出全库的 SQL dump */
export async function getDatabaseDump(connectionId: string, includeData = false) {
  return api().request("postgres/database-dump", { connectionId, includeData }) as Promise<{ dump: string; error?: string }>;
}

/** 批量导入行到表 */
export async function importRows(
  connectionId: string,
  schema: string,
  table: string,
  columns: string[],
  rows: any[][],
  options?: {
    conflictColumns?: string[];
    onConflict?: "nothing" | "update";
    onError?: "rollback" | "discard";
  }
) {
  return api().request("postgres/import-rows", {
    connectionId,
    schema,
    table,
    columns,
    rows,
    conflictColumns: options?.conflictColumns,
    onConflict: options?.onConflict,
    onError: options?.onError,
  }) as Promise<{ success: boolean; rowCount?: number; error?: string }>;
}

/** 获取表注释 */
export async function getTableComment(connectionId: string, schema: string, table: string): Promise<{ comment: string | null }> {
  return api().request("postgres/table-comment", { connectionId, schema, table }) as Promise<{ comment: string | null }>;
}

/** 获取检查约束列表 */
export async function getCheckConstraints(connectionId: string, schema: string, table: string): Promise<{ constraints: Array<{ name: string; expression: string }> }> {
  return api().request("postgres/check-constraints", { connectionId, schema, table }) as Promise<{ constraints: Array<{ name: string; expression: string }> }>;
}

/** 分区表：父表/分区子表元数据（非分区表返回 role:none） */
export async function getPartitionInfo(connectionId: string, schema: string, table: string) {
  return api().request("postgres/partition-info", { connectionId, schema, table }) as Promise<
    | { role: "none" }
    | {
        role: "parent";
        strategy: string | null;
        partitionKey: string | null;
        partitions: Array<{ schema: string; name: string; qualified: string; bound: string }>;
      }
    | {
        role: "partition";
        parentQualified: string;
        parentSchema: string;
        parentName: string;
        thisBound: string;
        strategy: string | null;
        partitionKey: string | null;
      }
  >;
}

/** EXPLAIN 文本计划（不执行查询），用于分区裁剪预览 */
export async function explainQueryText(connectionId: string, query: string) {
  return api().request("postgres/explain-text", { connectionId, query }) as Promise<{ lines: string[] }>;
}

/** 订阅服务端推送事件 */
export function subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {  return api().subscribeEvents(connectionId, callback);
}

/** VSCode 插件内：保存文件到用户选择路径。返回 true 表示已保存，false 表示用户取消，抛错时可回退到浏览器下载。 */
export async function saveFileViaVscode(content: string, filename: string, options?: { isBase64?: boolean }): Promise<boolean> {
  const result = await api().request("vscode/save-file", {
    content,
    filename,
    isBase64: options?.isBase64,
  }) as { success?: boolean; cancelled?: boolean };
  if (result?.cancelled) return false;
  return !!result?.success;
}

/** VSCode 插件内：打开文件选择器并返回内容。返回 null 表示用户取消。 */
export async function readFileViaVscode(options?: { accept?: string[] }): Promise<{ content: string; filename: string } | { contentBase64: string; filename: string } | null> {
  const result = await api().request("vscode/read-file", { accept: options?.accept ?? [".csv", ".json", ".xlsx", ".xls"] }) as { cancelled?: boolean; content?: string; filename?: string; contentBase64?: string };
  if (result?.cancelled) return null;
  if (result?.contentBase64 != null && result?.filename) return { contentBase64: result.contentBase64, filename: result.filename };
  if (result?.content != null && result?.filename) return { content: result.content, filename: result.filename };
  return null;
}
