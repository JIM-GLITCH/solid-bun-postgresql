/**
 * 前端 API：类型安全的 tRPC 封装；底层完全使用 tRPC
 * 不同平台的差异在 tRPC link 层各自实现
 */

import { getTrpcClient } from "./trpc/client";
import type {
  PostgresLoginParams,
  ColumnEditableInfo,
  SSEMessage,
  ServerPushMessage,
  AccountStateMessage,
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
  const trpc = getTrpcClient();
  const res = await trpc.db.connect.mutate({
    ...params,
    connectionId,
    dbType,
  });
  if (res.success) {
    registerConnectionDbType(connectionId, (res as any).dbType ?? dbType);
    void prefetchDbCapabilities(connectionId);
    void prefetchDbDataTypes(connectionId);
  }
  return res as { success: boolean; error?: unknown };
}

/** 断开指定连接 */
export async function disconnectPostgres(connectionId: string) {
  try {
    const trpc = getTrpcClient();
    return await trpc.db.disconnect.mutate(dbConn(connectionId));
  } finally {
    clearServerCapabilities(connectionId);
    unregisterConnectionDbType(connectionId);
  }
}

/** 当前会话的方言能力（用于按能力开关 UI） */
export async function getDbCapabilities(connectionId: string) {
  const trpc = getTrpcClient();
  return trpc.db.capabilities.query(dbConn(connectionId));
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
 * Web 使用 keepalive fetch，避免关页时普通请求被取消；VSCode webview 走 tRPC。
 */
export function disconnectPostgresOnPageUnload(connectionId: string): void {
  const w = typeof window !== "undefined" ? (window as unknown as { acquireVsCodeApi?: () => unknown }) : undefined;
  if (typeof w?.acquireVsCodeApi === "function") {
    void disconnectPostgres(connectionId);
    return;
  }
  const payload = dbConn(connectionId);
  try {
    void fetch(`/api/trpc/db.disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: JSON.stringify(payload),
      }),
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
  const trpc = getTrpcClient();
  return trpc.db.queryStream.mutate(payload);
}

/** 流式查询 - 加载更多 */
export async function queryStreamMore(connectionId: string, batchSize = 100, defaultSchema?: string) {
  const ds = defaultSchema?.trim();
  const trpc = getTrpcClient();
  return trpc.db.queryStreamMore.mutate({
    ...dbConn(connectionId),
    batchSize,
    ...(ds ? { defaultSchema: ds } : {}),
  });
}

/** 取消查询 */
export async function cancelQuery(connectionId: string) {
  const trpc = getTrpcClient();
  return trpc.db.cancelQuery.mutate(dbConn(connectionId));
}

/** 保存修改 */
export async function saveChanges(connectionId: string, sql: string) {
  const trpc = getTrpcClient();
  return trpc.db.saveChanges.mutate({ ...dbConn(connectionId), sql });
}

/** 执行 EXPLAIN ANALYZE，返回 JSON 格式执行计划 */
export async function explainQuery(connectionId: string, query: string, defaultSchema?: string) {
  const ds = defaultSchema?.trim();
  const trpc = getTrpcClient();
  return trpc.db.explain.query({
    ...dbConn(connectionId),
    query,
    ...(ds ? { defaultSchema: ds } : {}),
  });
}

/** 获取 schemas */
export async function getSchemas(connectionId: string) {
  const trpc = getTrpcClient();
  return trpc.db.schemas.query(dbConn(connectionId));
}

/** 获取表/视图/函数 */
export async function getTables(connectionId: string, schema: string) {
  const trpc = getTrpcClient();
  return trpc.db.tables.query({ ...dbConn(connectionId), schema });
}

/** 获取列信息 */
export async function getColumns(connectionId: string, schema: string, table: string) {
  const trpc = getTrpcClient();
  return trpc.db.columns.query({ ...dbConn(connectionId), schema, table });
}

/** 获取索引 */
export async function getIndexes(connectionId: string, schema: string, table: string) {
  const trpc = getTrpcClient();
  return trpc.db.indexes.query({ ...dbConn(connectionId), schema, table });
}

/** 获取主键列名 */
export async function getPrimaryKeys(connectionId: string, schema: string, table: string) {
  const trpc = getTrpcClient();
  return trpc.db.primaryKeys.query({ ...dbConn(connectionId), schema, table });
}

/** 获取唯一约束（含主键），用于导入时冲突处理 */
export async function getUniqueConstraints(connectionId: string, schema: string, table: string) {
  const trpc = getTrpcClient();
  return trpc.db.uniqueConstraints.query({ ...dbConn(connectionId), schema, table });
}

/** 获取外键 */
export async function getForeignKeys(connectionId: string, schema: string, table: string) {
  const trpc = getTrpcClient();
  return trpc.db.foreignKeys.query({ ...dbConn(connectionId), schema, table });
}

/** 获取 PostgreSQL 数据类型列表 */
export async function getDataTypes(connectionId: string) {
  const trpc = getTrpcClient();
  return trpc.db.dataTypes.query(dbConn(connectionId));
}

/** 执行 DDL（CREATE/ALTER TABLE 等） */
export async function executeDdl(connectionId: string, sql: string) {
  const trpc = getTrpcClient();
  return trpc.db.executeDdl.mutate({ ...dbConn(connectionId), sql });
}

/** 获取表/视图的 DDL */
export async function getTableDdl(connectionId: string, schema: string, table: string) {
  const trpc = getTrpcClient();
  return trpc.db.tableDdl.query({ ...dbConn(connectionId), schema, table });
}

/** 获取函数的源码 DDL */
export async function getFunctionDdl(connectionId: string, schema: string, funcName: string, oid?: number) {
  const trpc = getTrpcClient();
  return trpc.db.functionDdl.query({ ...dbConn(connectionId), schema, function: funcName, oid });
}

/** 导出指定 schema 的 SQL dump */
export async function getSchemaDump(connectionId: string, schema: string, includeData = false) {
  const trpc = getTrpcClient();
  return trpc.db.schemaDump.query({ ...dbConn(connectionId), schema, includeData });
}

/** 导出全库的 SQL dump */
export async function getDatabaseDump(connectionId: string, includeData = false) {
  const trpc = getTrpcClient();
  return trpc.db.databaseDump.query({ ...dbConn(connectionId), includeData });
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
  const trpc = getTrpcClient();
  return trpc.db.importRows.mutate({
    ...dbConn(connectionId),
    schema,
    table,
    columns,
    rows,
    conflictColumns: options?.conflictColumns,
    onConflict: options?.onConflict,
    onError: options?.onError,
  });
}

/** 获取表注释 */
export async function getTableComment(connectionId: string, schema: string, table: string): Promise<{ comment: string | null }> {
  const trpc = getTrpcClient();
  return trpc.db.tableComment.query({ ...dbConn(connectionId), schema, table });
}

/** 获取检查约束列表 */
export async function getCheckConstraints(connectionId: string, schema: string, table: string): Promise<{ constraints: Array<{ name: string; expression: string }> }> {
  const trpc = getTrpcClient();
  return trpc.db.checkConstraints.query({ ...dbConn(connectionId), schema, table });
}

/** 分区表：父表/分区子表元数据（非分区表返回 role:none） */
export async function getPartitionInfo(connectionId: string, schema: string, table: string) {
  const trpc = getTrpcClient();
  return trpc.db.partitionInfo.query({ ...dbConn(connectionId), schema, table });
}

/** EXPLAIN 文本计划（不执行查询），用于分区裁剪预览 */
export async function explainQueryText(connectionId: string, query: string) {
  const trpc = getTrpcClient();
  return trpc.db.explainText.query({ ...dbConn(connectionId), query });
}

/** 会话与锁监控摘要（PG / MySQL 共用 `db/session-monitor`） */
export async function getSessionMonitor(connectionId: string, limit = 20) {
  const trpc = getTrpcClient();
  return trpc.db.sessionMonitor.query({ ...dbConn(connectionId), limit });
}

/** 当前数据库已安装的扩展（名称、版本、说明） */
export async function getInstalledExtensions(connectionId: string) {
  const trpc = getTrpcClient();
  return trpc.db.installedExtensions.query(dbConn(connectionId));
}

/** 取消当前语句或终止连接（PG cancel/terminate backend；MySQL KILL QUERY / KILL） */
export async function sessionControl(connectionId: string, pid: number, action: "cancel" | "terminate") {
  const trpc = getTrpcClient();
  return trpc.db.sessionControl.mutate({ ...dbConn(connectionId), pid, action });
}

/** 订阅指定连接的会话事件（NOTICE/ERROR/…） */
export function subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
  // 使用 tRPC mutation 注册订阅
  const trpc = getTrpcClient();
  trpc.subscription.subscribeEvents.mutate({ connectionId }).catch(console.error);
  
  // 直接监听 postMessage 消息
  const handler = (event: MessageEvent) => {
    const msg = event.data;
    if (msg && typeof msg === 'object' && msg.type === 'sse' && msg.connectionId === connectionId) {
      callback(msg as SSEMessage);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** 订阅全部服务端推送（统一 `ServerPushMessage`） */
export function subscribeServerMessages(callback: (msg: ServerPushMessage) => void): () => void {
  // 使用 tRPC mutation 注册订阅
  const trpc = getTrpcClient();
  trpc.subscription.subscribeServerMessages.mutate({}).catch(console.error);
  
  // 直接监听 postMessage 消息
  const handler = (event: MessageEvent) => {
    const msg = event.data;
    if (msg && typeof msg === 'object' && msg.type === 'server-push') {
      callback(msg as ServerPushMessage);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

/** 订阅账号状态（如 VSCode 扩展推送）；Web 端若无对应推送源则可能从不触发 */
export function subscribeAccountState(handler: (msg: AccountStateMessage) => void): () => void {
  // 使用 tRPC mutation 注册订阅
  const trpc = getTrpcClient();
  trpc.subscription.subscribeAccountState.mutate({}).catch(console.error);
  
  // 直接监听 postMessage 消息
  const messageHandler = (event: MessageEvent) => {
    const msg = event.data;
    if (msg && typeof msg === 'object' && msg.type === 'dbplayer/account') {
      handler(msg as AccountStateMessage);
    }
  };
  window.addEventListener('message', messageHandler);
  return () => window.removeEventListener('message', messageHandler);
}

/** VSCode 插件内：保存文件到用户选择路径。返回 true 表示已保存，false 表示用户取消，抛错时可回退到浏览器下载。 */
export async function saveFileViaVscode(content: string, filename: string, options?: { isBase64?: boolean }): Promise<boolean> {
  const trpc = getTrpcClient();
  const result = await trpc.vscode.saveFile.mutate({
    content,
    filename,
    isBase64: options?.isBase64,
  });
  if (result?.cancelled) return false;
  return !!result?.success;
}

/** VSCode 插件内：打开文件选择器并返回内容。返回 null 表示用户取消。 */
export async function readFileViaVscode(options?: { accept?: string[] }): Promise<{ content: string; filename: string } | { contentBase64: string; filename: string } | null> {
  const trpc = getTrpcClient();
  const result = await trpc.vscode.readFile.mutate({ accept: options?.accept ?? [".csv", ".json", ".xlsx", ".xls"] }) as any;
  if (result?.cancelled) return null;
  if (result?.contentBase64 != null && result?.filename) return { contentBase64: result.contentBase64, filename: result.filename };
  if (result?.content != null && result?.filename) return { content: result.content, filename: result.filename };
  return null;
}

export async function getAiConfig() {
  const trpc = getTrpcClient();
  return trpc.ai.configGet.query();
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
  const trpc = getTrpcClient();
  return trpc.ai.configSet.mutate(payload);
}

export async function deleteAiKey(payload?: { keyRef?: string }) {
  const trpc = getTrpcClient();
  return trpc.ai.keyDelete.mutate(payload ?? {});
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
  const trpc = getTrpcClient();
  return trpc.ai.testConnection.mutate(payload ?? {});
}

export async function aiSqlEdit(payload: {
  connectionId: string;
  sql: string;
  instructions?: string;
  keyRef?: string;
  schema?: string;
}) {
  const trpc = getTrpcClient();
  return trpc.ai.sqlEdit.mutate(payload);
}

export async function aiBuildPrompt(payload: {
  connectionId: string;
  sql: string;
  schema?: string;
  instructions?: string;
}) {
  const trpc = getTrpcClient();
  return trpc.ai.promptBuild.mutate(payload);
}

export async function aiBuildDiffPrompt(payload: {
  connectionId: string;
  sql: string;
  schema?: string;
}) {
  const trpc = getTrpcClient();
  return trpc.ai.promptBuildDiff.mutate(payload);
}

export async function setAiKeyViaVscode(keyRef: string, apiKey: string) {
  const trpc = getTrpcClient();
  return trpc.vscode.aiKeySet.mutate({ keyRef, apiKey });
}

export async function deleteAiKeyViaVscode(keyRef: string) {
  const trpc = getTrpcClient();
  return trpc.vscode.aiKeyDelete.mutate({ keyRef });
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
  const trpc = getTrpcClient();
  await trpc.subscription.assert.mutate({ feature });
}

export async function getSubscriptionAccount(): Promise<{
  loggedIn: boolean;
  user?: { id?: number; email?: string | null };
}> {
  const trpc = getTrpcClient();
  return trpc.subscription.account.query();
}
