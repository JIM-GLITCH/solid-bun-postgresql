/**
 * 前端 API 客户端：基于 Transport 抽象，提供类型安全的接口
 */

import { getTransport } from "./transport";
import type {
  PostgresLoginParams,
  ColumnEditableInfo,
  SSEMessage,
  DatabaseCapabilities,
  DbKind,
} from "../shared/src";
import { getRegisteredDbType, registerConnectionDbType, unregisterConnectionDbType } from "./db-session-meta";
import {
  clearServerCapabilities,
  registerServerCapabilities,
  registerServerDataTypes,
} from "./db-capabilities-cache";
import { defaultDatabaseCapabilities } from "../shared/src";
import { normalizeDbDataTypesList } from "./table-designer-shared";

const api = () => getTransport();

/** 与当前会话一致：db/* 请求须带 dbType，与 connectionMap 中方言一致。 */
function dbConn(connectionId: string) {
  return { connectionId, dbType: getRegisteredDbType(connectionId) };
}

/** 连接数据库（params 与 PG/MySQL 共用形状）；dbType 由调用方指定并在成功后登记。 */
export async function connectPostgres(
  connectionId: string,
  params: PostgresLoginParams,
  dbType: DbKind = "postgres"
) {
  const res = (await api().request("db/connect", {
    ...params,
    connectionId,
    dbType,
  })) as { success?: boolean; error?: unknown; dbType?: DbKind };
  if (res.success) {
    registerConnectionDbType(connectionId, res.dbType ?? dbType);
    void prefetchDbCapabilities(connectionId);
    void prefetchDbDataTypes(connectionId);
  }
  return res as { success: boolean; error?: unknown };
}

/** 断开指定连接 */
export async function disconnectPostgres(connectionId: string) {
  try {
    return (await api().request("db/disconnect", dbConn(connectionId))) as { success: boolean; error?: string };
  } finally {
    clearServerCapabilities(connectionId);
    unregisterConnectionDbType(connectionId);
  }
}

/** 当前会话的方言能力（用于按能力开关 UI） */
export async function getDbCapabilities(connectionId: string) {
  return api().request("db/capabilities", dbConn(connectionId)) as Promise<{ capabilities: DatabaseCapabilities }>;
}

/** 建连后拉取并缓存能力（失败则写入与方言一致的默认矩阵） */
export async function prefetchDbCapabilities(connectionId: string): Promise<void> {
  try {
    const { capabilities } = await getDbCapabilities(connectionId);
    registerServerCapabilities(connectionId, capabilities);
  } catch {
    registerServerCapabilities(
      connectionId,
      defaultDatabaseCapabilities(getRegisteredDbType(connectionId))
    );
  }
}

/** 建连后拉取 `db/data-types` 并缓存（仅库返回类型；失败则表设计器内再请求） */
export async function prefetchDbDataTypes(connectionId: string): Promise<void> {
  try {
    const { types } = await getDataTypes(connectionId);
    const list = normalizeDbDataTypesList(types);
    if (list.length > 0) registerServerDataTypes(connectionId, list);
  } catch {
    /* 忽略 */
  }
}

/**
 * 页面关闭/隐藏且即将卸载时调用：释放服务端 connectionMap。
 * Web 使用 keepalive fetch，避免关页时普通请求被取消；VSCode webview 走 postMessage。
 */
export function disconnectPostgresOnPageUnload(connectionId: string): void {
  const w = typeof window !== "undefined" ? (window as unknown as { acquireVsCodeApi?: () => unknown }) : undefined;
  if (typeof w?.acquireVsCodeApi === "function") {
    void disconnectPostgres(connectionId);
    return;
  }
  const payload = dbConn(connectionId);
  try {
    void fetch(`/api/db/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    void disconnectPostgres(connectionId);
  }
  clearServerCapabilities(connectionId);
  unregisterConnectionDbType(connectionId);
}

/** 流式查询 - 第一批。传 statements 时后端不再分句，避免重复计算。 */
export async function queryStream(
  connectionId: string,
  queryOrStatements: string | string[],
  batchSize = 100,
  defaultSchema?: string
) {
  const ds = defaultSchema?.trim();
  const base = { ...dbConn(connectionId), batchSize, ...(ds ? { defaultSchema: ds } : {}) };
  const payload =
    typeof queryOrStatements === "string"
      ? { ...base, query: queryOrStatements }
      : { ...base, statements: queryOrStatements };
  return api().request("db/query-stream", payload) as Promise<{
    rows: any[][];
    columns: ColumnEditableInfo[];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 流式查询 - 加载更多 */
export async function queryStreamMore(connectionId: string, batchSize = 100, defaultSchema?: string) {
  const ds = defaultSchema?.trim();
  return api().request("db/query-stream-more", {
    ...dbConn(connectionId),
    batchSize,
    ...(ds ? { defaultSchema: ds } : {}),
  }) as Promise<{
    rows: any[][];
    hasMore: boolean;
    error?: string;
  }>;
}

/** 取消查询 */
export async function cancelQuery(connectionId: string) {
  return api().request("db/cancel-query", dbConn(connectionId)) as Promise<{
    success: boolean;
    cancelled?: boolean;
    message?: string;
    error?: string;
  }>;
}

/** 保存修改 */
export async function saveChanges(connectionId: string, sql: string) {
  return api().request("db/save-changes", { ...dbConn(connectionId), sql }) as Promise<{ success: boolean; rowCount?: number; error?: string }>;
}

/** 执行 EXPLAIN ANALYZE，返回 JSON 格式执行计划 */
export async function explainQuery(connectionId: string, query: string, defaultSchema?: string) {
  const ds = defaultSchema?.trim();
  return api().request("db/explain", {
    ...dbConn(connectionId),
    query,
    ...(ds ? { defaultSchema: ds } : {}),
  }) as Promise<{
    plan: Array<{ Plan: any; "Planning Time"?: number; "Execution Time"?: number }>;
    error?: string;
  }>;
}

/** 获取 schemas */
export async function getSchemas(connectionId: string) {
  return api().request("db/schemas", dbConn(connectionId)) as Promise<{ schemas: string[]; error?: string }>;
}

/** 获取表/视图/函数 */
export async function getTables(connectionId: string, schema: string) {
  return api().request("db/tables", { ...dbConn(connectionId), schema }) as Promise<{
    tables: string[];
    views: string[];
    functions?: Array<{ oid: number; schema: string; name: string; args: string }>;
    error?: string;
  }>;
}

/** 获取列信息 */
export async function getColumns(connectionId: string, schema: string, table: string) {
  return api().request("db/columns", { ...dbConn(connectionId), schema, table }) as Promise<{ columns: any[]; error?: string }>;
}

/** 获取索引 */
export async function getIndexes(connectionId: string, schema: string, table: string) {
  return api().request("db/indexes", { ...dbConn(connectionId), schema, table }) as Promise<{ indexes: any[]; error?: string }>;
}

/** 获取主键列名 */
export async function getPrimaryKeys(connectionId: string, schema: string, table: string) {
  return api().request("db/primary-keys", { ...dbConn(connectionId), schema, table }) as Promise<{
    columns: string[];
    constraintName?: string;
    error?: string;
  }>;
}

/** 获取唯一约束（含主键），用于导入时冲突处理 */
export async function getUniqueConstraints(connectionId: string, schema: string, table: string) {
  return api().request("db/unique-constraints", { ...dbConn(connectionId), schema, table }) as Promise<{
    constraints: Array<{ name: string; type: string; columns: string[] }>;
    error?: string;
  }>;
}

/** 获取外键 */
export async function getForeignKeys(connectionId: string, schema: string, table: string) {
  return api().request("db/foreign-keys", { ...dbConn(connectionId), schema, table }) as Promise<{
    outgoing: any[];
    incoming: any[];
    error?: string;
  }>;
}

/** 获取 PostgreSQL 数据类型列表 */
export async function getDataTypes(connectionId: string) {
  return api().request("db/data-types", dbConn(connectionId)) as Promise<{ types: string[]; error?: string }>;
}

/** 执行 DDL（CREATE/ALTER TABLE 等） */
export async function executeDdl(connectionId: string, sql: string) {
  return api().request("db/execute-ddl", { ...dbConn(connectionId), sql }) as Promise<{ success: boolean; error?: string }>;
}

/** 获取表/视图的 DDL */
export async function getTableDdl(connectionId: string, schema: string, table: string) {
  return api().request("db/table-ddl", { ...dbConn(connectionId), schema, table }) as Promise<{ ddl: string; error?: string }>;
}

/** 获取函数的源码 DDL */
export async function getFunctionDdl(connectionId: string, schema: string, funcName: string, oid?: number) {
  return api().request("db/function-ddl", { ...dbConn(connectionId), schema, function: funcName, oid }) as Promise<{ ddl: string; error?: string }>;
}

/** 导出指定 schema 的 SQL dump */
export async function getSchemaDump(connectionId: string, schema: string, includeData = false) {
  return api().request("db/schema-dump", { ...dbConn(connectionId), schema, includeData }) as Promise<{ dump: string; error?: string }>;
}

/** 导出全库的 SQL dump */
export async function getDatabaseDump(connectionId: string, includeData = false) {
  return api().request("db/database-dump", { ...dbConn(connectionId), includeData }) as Promise<{ dump: string; error?: string }>;
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
  return api().request("db/import-rows", {
    ...dbConn(connectionId),
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
  return api().request("db/table-comment", { ...dbConn(connectionId), schema, table }) as Promise<{ comment: string | null }>;
}

/** 获取检查约束列表 */
export async function getCheckConstraints(connectionId: string, schema: string, table: string): Promise<{ constraints: Array<{ name: string; expression: string }> }> {
  return api().request("db/check-constraints", { ...dbConn(connectionId), schema, table }) as Promise<{ constraints: Array<{ name: string; expression: string }> }>;
}

/** 分区表：父表/分区子表元数据（非分区表返回 role:none） */
export async function getPartitionInfo(connectionId: string, schema: string, table: string) {
  return api().request("db/partition-info", { ...dbConn(connectionId), schema, table }) as Promise<
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
  return api().request("db/explain-text", { ...dbConn(connectionId), query }) as Promise<{ lines: string[] }>;
}

/** 会话与锁监控摘要（PG / MySQL 共用 `db/session-monitor`） */
export async function getSessionMonitor(connectionId: string, limit = 20) {
  return api().request("db/session-monitor", { ...dbConn(connectionId), limit }) as Promise<{
    connectionStats: { total: number; active: number; idle: number; waiting: number };
    lockWaits: Array<{
      waiting_pid: number;
      waiting_user: string;
      waiting_query: string;
      blocking_pid: number;
      blocking_user: string;
      blocking_query: string;
      wait_event_type?: string | null;
      wait_event?: string | null;
    }>;
    slowQueries: Array<Record<string, unknown>>;
    slowQuerySource:
      | "pg_stat_statements"
      | "pg_stat_activity"
      | "mysql_processlist"
      | "mysql_events_statements"
      | "mssql_requests";
    collectedAt: number;
  }>;
}

/** 当前数据库已安装的扩展（名称、版本、说明） */
export async function getInstalledExtensions(connectionId: string) {
  return api().request("db/installed-extensions", dbConn(connectionId)) as Promise<{
    extensions: Array<{
      name: string;
      installedVersion: string;
      schema: string;
      relocatable: boolean;
      defaultVersion: string | null;
      description: string | null;
    }>;
  }>;
}

/** 取消当前语句或终止连接（PG cancel/terminate backend；MySQL KILL QUERY / KILL） */
export async function sessionControl(connectionId: string, pid: number, action: "cancel" | "terminate") {
  return api().request("db/session-control", { ...dbConn(connectionId), pid, action }) as Promise<{
    success: boolean;
    pid: number;
    action: "cancel" | "terminate";
  }>;
}

/** 订阅服务端推送事件 */
export function subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
  return api().subscribeEvents(connectionId, callback);
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

export async function getAiConfig() {
  return api().request("ai/config/get", {}) as Promise<{
    apiMode: "openai-compatible" | "anthropic";
    baseUrl?: string;
    model: string;
    keyRef: string;
    temperature: number;
    topP?: number;
    stream?: boolean;
    maxTokens: number;
    hasKey: boolean;
  }>;
}

export async function setAiConfig(payload: {
  apiMode: "openai-compatible" | "anthropic";
  baseUrl?: string;
  model: string;
  keyRef?: string;
  apiKey?: string;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  maxTokens?: number;
}) {
  return api().request("ai/config/set", payload) as Promise<{ success: boolean }>;
}

export async function deleteAiKey(payload?: { keyRef?: string }) {
  return api().request("ai/key/delete", payload ?? {}) as Promise<{ success: boolean }>;
}

export async function testAiConnection(payload?: {
  apiMode?: "openai-compatible" | "anthropic";
  baseUrl?: string;
  model?: string;
  keyRef?: string;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  maxTokens?: number;
}) {
  return api().request("ai/test-connection", payload ?? {}) as Promise<{ success: boolean }>;
}

export async function aiSqlEdit(payload: {
  connectionId: string;
  sql: string;
  instructions?: string;
  keyRef?: string;
  schema?: string;
}) {
  return api().request("ai/sql-edit", payload) as Promise<{
    sql: string;
    rationale: string;
    warnings: string[];
    alternatives?: string[];
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    elapsedMs?: number;
    schemaInjected?: string[];
  }>;
}

export async function aiBuildPrompt(payload: {
  connectionId: string;
  sql: string;
  schema?: string;
  instructions?: string;
}) {
  return api().request("ai/prompt-build", payload) as Promise<{
    prompt: string;
    schemaInjected?: string[];
  }>;
}

export async function aiBuildDiffPrompt(payload: {
  connectionId: string;
  sql: string;
  schema?: string;
}) {
  return api().request("ai/prompt-build-diff", payload) as Promise<{
    prompt: string;
    schemaInjected?: string[];
  }>;
}

export async function setAiKeyViaVscode(keyRef: string, apiKey: string) {
  return api().request("vscode/ai-key-set", { keyRef, apiKey }) as Promise<{ success: boolean }>;
}

export async function deleteAiKeyViaVscode(keyRef: string) {
  return api().request("vscode/ai-key-delete", { keyRef }) as Promise<{ success: boolean }>;
}

/**
 * 进入付费功能前做一次显式 assert：
 * - VS Code：由 extension host 校验
 * - 浏览器 / Standalone：由业务 API 的 POST subscription/assert 校验（与扩展策略一致）
 * - Electrobun：由主进程侧处理，此处不重复请求
 */
export async function assertFeatureSubscription(feature: "visual-query-builder" | "table-designer"): Promise<void> {
  const w = window as Window & { __electrobunApiRequest?: unknown };
  if (typeof w.__electrobunApiRequest === "function") return;
  await api().request("subscription/assert", { feature });
}

export async function getSubscriptionAccount(): Promise<{
  loggedIn: boolean;
  user?: { id?: number; email?: string | null };
}> {
  return api().request("subscription/account", {}) as Promise<{
    loggedIn: boolean;
    user?: { id?: number; email?: string | null };
  }>;
}
