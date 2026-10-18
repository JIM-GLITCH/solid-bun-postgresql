/**
 * 后端 API 核心：纯业务逻辑，与传输方式无关
 * 供 HTTP 处理器（`api-handlers-http`）与 tRPC router 共同调用
 *
 * 连接生命周期（注册表 / 建连 / 断开 / 重连 / keepalive / 事件推送）已抽到
 * `backend/db/sessions.ts`；本文件只做「method → 业务」分发，不持有任何连接句柄。
 * 为兼容既有调用方（tRPC context、Electrobun、VSCode），相关读取入口在此再导出。
 */

import {
  getSqlSegments,
  type ApiMethod,
  type ApiRequestPayload,
  type ConnectDbRequest,
  type ConnectionSavePayload,
  type DbKind,
  type StoredConnectionParams,
  type SSEMessage,
  isMysqlFamily,
  isSqlServer,
} from "../shared/src";
import type { Pool as MysqlPool } from "mysql2/promise";
import type { Pool } from "pg";
import { handlePostgresDbRequest, type PostgresDbHandlerContext } from "./postgres-db-handlers";
import { handleMysqlDbRequest, type MysqlDbHandlerContext } from "./mysql-db-handlers";
import { handleSqlServerDbRequest, type SqlServerDbHandlerContext } from "./sqlserver-db-handlers";
import { listConnections, saveConnection, removeConnection, getConnectionParams, updateConnectionMeta, reorderConnections } from "./connections-store";
import { addQuery as addQueryHistory, searchHistory, deleteEntry as deleteHistoryEntry, clearHistory as clearQueryHistory } from "./query-history-store";
import { getAiKey as getAiKeyFromStore, setAiKey as setAiKeyToStore, deleteAiKey as deleteAiKeyFromStore } from "./ai-key-store";
import { getStoredSubscriptionToken } from "./subscription-token-store";
import { getSubscriptionApiBaseFromEnv } from "./subscription-license";
import { runAiSqlTask, type AiApiMode } from "./ai-service";
import type { SessionConnection } from "./session-connection";
import type { DbConnector } from "./db/contract";
import {
  assertSessionDbType,
  attachPostgresClientHandlers,
  capabilitiesForKind,
  connectSession,
  disconnectConnection,
  disposeAllSessions,
  getSession,
  getSessionInfo,
  installSessionDisposeOnExit,
  isPgUserClientDeadError,
  recreateUserUsedClient,
  sendSSEMessage,
  sessionConnectorOf,
  shouldRouteDbRequestToMysql,
  shouldRouteDbRequestToSqlServer,
  startMysqlUserClientKeepalive,
  startUserClientKeepalive,
  stopUserClientKeepalive,
  subscribeSessionEvents,
} from "./db/sessions";

export type { SessionConnection } from "./session-connection";
export type { SSEMessage };
/** 传输层应当读的收窄形状（不含连接句柄） */
export type { SessionInfo } from "./db/contract";

// 传输层读取入口：实现已移到 `db/sessions.ts`，此处再导出以保持既有 import 路径可用
export { getSession, getSessionInfo, subscribeSessionEvents, sendSSEMessage, disconnectConnection };

/** 进程退出收口（供宿主入口显式调用；`installSessionDisposeOnExit` 已自动挂钩） */
export { disposeAllSessions };

// Phase 2：keepalive 是 Effect 常驻 fiber，安装进程退出收口（幂等）
installSessionDisposeOnExit();

/** 按不在引号/注释内的 ; 拆成多条语句（与前端分块规则一致，仅不分空行）。 */
function getStatements(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

const aiKeyStore = new Map<string, string>();

let aiKeyResolver: ((keyRef: string) => Promise<string | undefined>) | null = null;

export function setAiKeyResolver(resolver: ((keyRef: string) => Promise<string | undefined>) | null): void {
  aiKeyResolver = resolver;
}

interface AiRuntimeConfig {
  /** 与前端「接口格式」一致 */
  apiMode: AiApiMode;
  baseUrl?: string;
  model: string;
  keyRef: string;
  temperature: number;
  topP?: number;
  stream: boolean;
  maxTokens: number;
}

let aiConfig: AiRuntimeConfig = {
  apiMode: "openai-compatible",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen-plus",
  keyRef: "default",
  temperature: 0.2,
  topP: undefined,
  stream: true,
  maxTokens: 700,
};

/** 业务 handler 访问连接能力的唯一入口 */
function sessionConnectorFor(cid: string): DbConnector {
  const c = sessionConnectorOf(cid);
  if (!c) throw new Error("未找到数据库连接，请先连接数据库");
  return c;
}

async function resolveAiApiKey(keyRef: string): Promise<string | undefined> {
  const inMemory = aiKeyStore.get(keyRef);
  if (inMemory) return inMemory;
  const fromFileStore = getAiKeyFromStore(keyRef);
  if (fromFileStore) {
    aiKeyStore.set(keyRef, fromFileStore);
    return fromFileStore;
  }
  if (aiKeyResolver) {
    const fromResolver = await aiKeyResolver(keyRef);
    if (fromResolver) return fromResolver;
  }
  if (keyRef === "default") {
    return process.env.ALIYUN_API_KEY || process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  }
  return undefined;
}

function aiDialectDisplayLabel(dialect: DbKind): string {
  if (dialect === "postgres") return "PostgreSQL";
  if (dialect === "mariadb") return "MariaDB";
  if (dialect === "sqlserver") return "Microsoft SQL Server";
  return "MySQL";
}

async function buildAiSchemaContext(
  connector: DbConnector,
  schema?: string
): Promise<{ context: string; injected: string[] }> {
  // schema 采集已整体下沉到连接层（各 DbConnector 的 buildSchemaContext）
  return connector.buildSchemaContext(schema);
}

// ── AI 提示词组装 ────────────────────────────────────────────

function buildPortableSqlPrompt(params: {
  sql: string;
  schemaContext: string;
  extraInstruction?: string;
  dialect: DbKind;
}): string {
  const { sql, schemaContext, extraInstruction, dialect } = params;
  const dbLabel = aiDialectDisplayLabel(dialect);
  return [
    "你是 SQL 助手，请严格按要求输出。",
    "任务: 按用户要求编辑当前 SQL",
    `数据库: ${dbLabel}`,
    "",
    "Schema Context (可使用表/列):",
    schemaContext || "(empty)",
    "",
    "当前 SQL:",
    sql.trim(),
    ...(extraInstruction?.trim()
      ? ["", "用户要求:", extraInstruction.trim()]
      : []),
    "",
    "输出要求:",
    "1) 仅输出 SQL，不要 markdown 代码块，所有解释要以sql注释形式给出。",
    "2) 必须保留原 SQL 中已有注释（-- 和 /* */），并随结果一起返回。",
    "3) 不要生成高风险语句（DROP/TRUNCATE/无 WHERE 的 UPDATE/DELETE）。",
  ].join("\n");
}

function buildDiffSqlPrompt(params: { sql: string; schemaContext: string; dialect: DbKind }): string {
  const { sql, schemaContext, dialect } = params;
  const dbLabel = aiDialectDisplayLabel(dialect);
  return [
    "[DIFF MODE] 你是 SQL 助手，请严格按要求输出。",
    "任务: 输出最小改动的 SQL diff JSON",
    `数据库: ${dbLabel}`,
    "",
    "Schema Context (仅可使用以下表/列):",
    schemaContext || "(empty)",
    "",
    "当前 SQL:",
    sql.trim(),
    "",
    "输出格式（必须严格遵守）:",
    "只输出一个 JSON，不要 markdown，不要解释：",
    "{",
    '  "type": "sql_diff_v1",',
    '  "before": "<原始SQL（逐字）>",',
    '  "after": "<修改后SQL>",',
    '  "changes": [{"kind":"replace","old":"<片段>","new":"<片段>"}]',
    "}",
    "",
    "硬约束:",
    "1) before 必须与“当前 SQL”逐字一致。",
    `2) after 必须是可执行 ${dbLabel} SQL。`,
    "3) 最小修改，changes 尽量少。",
    "4) 不允许 DROP/TRUNCATE/无 WHERE 的 UPDATE/DELETE。",
    "5) 若无需修改，after=before，changes=[]。",
    "6) 仅输出 JSON，不允许输出任何额外文字。",
  ].join("\n");
}

function buildAiJsonSystemPrompt(dialect: DbKind): string {
  const label = aiDialectDisplayLabel(dialect);
  return [
    "You are a SQL assistant for database developers.",
    "Output MUST be valid JSON only, no markdown fences.",
    "Do NOT output LaTeX, math boxes, markdown tables, or prose outside JSON.",
    "JSON keys MUST be exactly: sql, rationale, warnings, alternatives.",
    `Target dialect is ${label} unless explicitly overridden.`,
    "Do not include dangerous SQL unless user explicitly asks.",
    "When suggesting UPDATE/DELETE, require clear WHERE conditions.",
    "Prefer deterministic, production-safe SQL.",
  ].join("\n");
}

function normalizeAiSqlRequest(
  payload: unknown,
  fallbackKeyRef: string
): {
  connectionId: string;
  sql: string;
  keyRef: string;
  schema?: string;
  instructions?: string;
} {
  const p = payload as {
    connectionId?: string;
    sql?: string;
    keyRef?: string;
    schema?: string;
    instructions?: string;
  };
  return {
    connectionId: String(p.connectionId ?? ""),
    sql: String(p.sql ?? ""),
    keyRef: p.keyRef || fallbackKeyRef,
    schema: p.schema,
    instructions: p.instructions,
  };
}

async function buildPortablePromptWithSchema(
  connector: DbConnector,
  params: { sql: string; schema?: string; instructions?: string }
): Promise<{ prompt: string; schemaInjected: string[] }> {
  const schemaMeta = await buildAiSchemaContext(connector, params.schema);
  const prompt = buildPortableSqlPrompt({
    sql: params.sql,
    schemaContext: schemaMeta.context,
    extraInstruction: params.instructions,
    dialect: connector.dbKind,
  });
  return { prompt, schemaInjected: schemaMeta.injected };
}

async function executeAiSqlEdit(params: {
  connector: DbConnector;
  sql: string;
  keyRef: string;
  schema?: string;
  instruction?: string;
}): Promise<{
  sql: string;
  rationale: string;
  warnings: string[];
  alternatives?: string[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  elapsedMs?: number;
  schemaInjected: string[];
}> {
  const promptMeta = await buildPortablePromptWithSchema(params.connector, {
    sql: params.sql,
    schema: params.schema,
    instructions: params.instruction,
  });
  const apiKey = await resolveAiApiKey(params.keyRef);
  if (!apiKey) throw new Error("未配置 AI API Key");
  const result = await runAiSqlTask(
    {
      apiMode: aiConfig.apiMode,
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
      apiKey,
      temperature: aiConfig.temperature,
      topP: aiConfig.topP,
      stream: aiConfig.stream,
      maxTokens: aiConfig.maxTokens,
    },
    {
      systemPrompt: buildAiJsonSystemPrompt(params.connector.dbKind),
      userPrompt: promptMeta.prompt,
    }
  );
  return { ...result, schemaInjected: promptMeta.schemaInjected };
}

// ── Subscription API 函数（供 tRPC 直接调用）────────────────────

export async function subscriptionAssert(params: { feature?: string }): Promise<{ success: boolean }> {
  const { feature } = params;
  const allowed = new Set(["visual-query-builder", "table-designer"]);
  if (!feature || !allowed.has(feature)) throw new Error("无效的功能标识");
  return { success: true };
}

export async function subscriptionAccount(): Promise<{
  loggedIn: boolean;
  user?: { id?: number; email?: string | null };
}> {
  const token = getStoredSubscriptionToken();
  if (!token) return { loggedIn: false };
  try {
    const apiBase = getSubscriptionApiBaseFromEnv();
    const res = await fetch(`${apiBase}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { loggedIn: true };
    const data = (await res.json()) as { user?: { id?: number; email?: string | null } };
    return { loggedIn: true, user: data.user };
  } catch {
    return { loggedIn: true };
  }
}

// ── Query History API 函数（供 tRPC 直接调用）────────────────────

export async function queryHistoryAdd(params: { sql: string; connectionId?: string }): Promise<{ success: boolean }> {
  addQueryHistory(params.sql, params.connectionId);
  return { success: true };
}

export async function queryHistorySearch(params: {
  keyword?: string;
  since?: number;
  until?: number;
}): Promise<Array<{
  id: string;
  sql: string;
  timestamp: number;
  connectionId?: string;
}>> {
  return searchHistory({
    keyword: params.keyword,
    since: params.since,
    until: params.until,
  });
}

export async function queryHistoryDelete(params: { id: string }): Promise<{ success: boolean }> {
  const { id } = params;
  if (!id) throw new Error("缺少 id");
  deleteHistoryEntry(id);
  return { success: true };
}

export async function queryHistoryClear(): Promise<{ success: boolean }> {
  clearQueryHistory();
  return { success: true };
}

// ── Connections API 函数（供 tRPC 直接调用）──────────────────────

export async function connectionsList(): Promise<Array<{
  id: string;
  label: string;
  enc?: string;
  name?: string;
  group?: string;
}>> {
  return listConnections();
}

export async function connectionsSave(params: {
  id: string;
  name?: string;
  group?: string;
  dbType?: DbKind;
  host: string;
  port?: string;
  username: string;
  password?: string;
  database?: string;
  connectionTimeoutSec?: number;
  sshEnabled?: boolean;
  sshHost?: string;
  sshPort?: string;
  sshUsername?: string;
  sshPassword?: string;
  sshPrivateKey?: string;
}): Promise<{ success: boolean }> {
  const { id, name, group, dbType, ...restParams } = params;
  if (!id || !String(restParams.host ?? "").trim() || !String(restParams.username ?? "").trim()) {
    throw new Error("缺少必填字段");
  }
  const kind = dbType ?? "postgres";
  const defaultPort = isMysqlFamily(kind) ? "3306" : isSqlServer(kind) ? "1433" : "5432";
  const toSave: StoredConnectionParams = {
    host: restParams.host,
    port: restParams.port || defaultPort,
    database: String(restParams.database ?? "").trim(),
    username: restParams.username,
    password: restParams.password || "",
    dbType: kind,
  };
  if (restParams.sshEnabled) {
    toSave.sshEnabled = true;
    toSave.sshHost = restParams.sshHost;
    toSave.sshPort = restParams.sshPort || "22";
    toSave.sshUsername = restParams.sshUsername;
    toSave.sshPassword = restParams.sshPassword;
    toSave.sshPrivateKey = restParams.sshPrivateKey;
    if (restParams.connectionTimeoutSec != null && restParams.connectionTimeoutSec > 0) {
      toSave.connectionTimeoutSec = restParams.connectionTimeoutSec;
    }
  }
  saveConnection(id, toSave, { name, group });
  return { success: true };
}

export async function connectionsDelete(params: { id: string }): Promise<{ success: boolean }> {
  const { id } = params;
  if (!id) throw new Error("缺少 id");
  removeConnection(id);
  return { success: true };
}

export async function connectionsUpdateMeta(params: { id: string; name?: string }): Promise<{ success: boolean }> {
  const { id, name } = params;
  if (!id) throw new Error("缺少 id");
  updateConnectionMeta(id, { name });
  return { success: true };
}

export async function connectionsReorder(params: { list: unknown[] }): Promise<{ success: boolean }> {
  const { list } = params;
  if (!Array.isArray(list)) throw new Error("list 必须是数组");
  reorderConnections(list);
  return { success: true };
}

export async function connectionsGetParams(params: { id: string }): Promise<StoredConnectionParams | null> {
  const { id } = params;
  if (!id) throw new Error("缺少 id");
  const paramsData = getConnectionParams(id);
  if (!paramsData) return null;
  const { id: _id, ...rest } = paramsData;
  return rest as StoredConnectionParams;
}

export async function connectionsConnect(params: { id: string; sessionId?: string }): Promise<{
  success: boolean;
  connectionId?: string;
  dbType?: DbKind;
}> {
  const { id, sessionId } = params;
  const connParams = getConnectionParams(id);
  if (!connParams) throw new Error("未找到已保存的连接");
  const { id: storedId, dbType, ...loginParams } = connParams;
  const connectionId = sessionId ? `${storedId}-${sessionId}` : storedId;
  return handleApiRequest("db/connect", { connectionId, dbType: dbType ?? "postgres", ...loginParams } as ConnectDbRequest) as Promise<{
    success: boolean;
    connectionId?: string;
    dbType?: DbKind;
  }>;
}

// ── AI API 函数（供 tRPC 直接调用）────────────────────────────────

export async function aiConfigGet(): Promise<{
  apiMode: 'openai-compatible' | 'anthropic';
  baseUrl?: string;
  model: string;
  keyRef: string;
  temperature: number;
  topP?: number;
  stream?: boolean;
  maxTokens: number;
  hasKey: boolean;
}> {
  return {
    apiMode: aiConfig.apiMode,
    baseUrl: aiConfig.baseUrl,
    model: aiConfig.model,
    keyRef: aiConfig.keyRef,
    temperature: aiConfig.temperature,
    topP: aiConfig.topP,
    stream: aiConfig.stream,
    maxTokens: aiConfig.maxTokens,
    hasKey: !!(await resolveAiApiKey(aiConfig.keyRef)),
  };
}

export async function aiConfigSet(params: {
  apiMode: AiApiMode;
  baseUrl?: string;
  model: string;
  keyRef?: string;
  apiKey?: string;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  maxTokens?: number;
}): Promise<{ success: boolean }> {
  const {
    apiMode,
    baseUrl,
    model,
    keyRef = "default",
    apiKey,
    temperature,
    topP,
    stream,
    maxTokens,
  } = params;
  if (apiMode !== "anthropic" && apiMode !== "openai-compatible") {
    throw new Error("apiMode 须为 openai-compatible 或 anthropic");
  }
  const resolvedBase = (baseUrl?.trim() || aiConfig.baseUrl || "").replace(/\/+$/, "");
  if (!resolvedBase) throw new Error("缺少 Base URL");
  aiConfig = {
    apiMode,
    baseUrl: resolvedBase,
    model: model?.trim() || aiConfig.model,
    keyRef: keyRef.trim() || "default",
    temperature: typeof temperature === "number" ? Math.max(0, Math.min(1, temperature)) : aiConfig.temperature,
    topP: typeof topP === "number" ? Math.max(0, Math.min(1, topP)) : aiConfig.topP,
    stream: typeof stream === "boolean" ? stream : aiConfig.stream,
    maxTokens: typeof maxTokens === "number" ? Math.max(64, Math.min(8192, Math.round(maxTokens))) : aiConfig.maxTokens,
  };
  if (apiKey?.trim()) {
    const trimmed = apiKey.trim();
    aiKeyStore.set(aiConfig.keyRef, trimmed);
    setAiKeyToStore(aiConfig.keyRef, trimmed);
  }
  return { success: true };
}

export async function aiKeyDelete(params?: { keyRef?: string }): Promise<{ success: boolean }> {
  const { keyRef = aiConfig.keyRef } = params ?? {};
  const ref = keyRef.trim() || "default";
  aiKeyStore.delete(ref);
  deleteAiKeyFromStore(ref);
  return { success: true };
}

export async function aiTestConnection(params?: {
  apiMode?: AiApiMode;
  baseUrl?: string;
  model?: string;
  keyRef?: string;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  maxTokens?: number;
}): Promise<{ success: boolean }> {
  const {
    apiMode = aiConfig.apiMode,
    baseUrl = aiConfig.baseUrl,
    model = aiConfig.model,
    keyRef = aiConfig.keyRef,
    temperature = aiConfig.temperature,
    topP = aiConfig.topP,
    stream = aiConfig.stream,
    maxTokens = aiConfig.maxTokens,
  } = params ?? {};
  const apiKey = await resolveAiApiKey(keyRef);
  if (!apiKey) throw new Error("未配置 AI API Key");
  const mode = apiMode ?? aiConfig.apiMode;
  const bu = baseUrl ?? aiConfig.baseUrl;
  await runAiSqlTask(
    { apiMode: mode, baseUrl: bu, model, apiKey, temperature, topP, stream, maxTokens },
    {
      systemPrompt: buildAiJsonSystemPrompt("postgres"),
      userPrompt: "请输出 JSON，其中 sql 字段为 select 1;",
    }
  );
  return { success: true };
}

export async function aiSqlEdit(params: {
  connectionId: string;
  sql: string;
  keyRef?: string;
  schema?: string;
  instructions?: string;
}): Promise<{
  sql: string;
  rationale: string;
  warnings: string[];
  alternatives?: string[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  elapsedMs?: number;
  schemaInjected?: string[];
}> {
  const req = normalizeAiSqlRequest(params, aiConfig.keyRef);
  if (!req.connectionId) throw new Error("缺少 connectionId");
  if (!req.sql.trim()) throw new Error("sql 不能为空");
  const session = getSession(req.connectionId);
  const result = await executeAiSqlEdit({
    connector: sessionConnectorFor(req.connectionId),
    sql: req.sql,
    keyRef: req.keyRef,
    schema: req.schema,
    instruction: req.instructions || "补全",
  });
  return { ...result, schemaInjected: result.schemaInjected };
}

export async function aiPromptBuild(params: {
  connectionId: string;
  sql: string;
  schema?: string;
  instructions?: string;
}): Promise<{
  prompt: string;
  schemaInjected?: string[];
}> {
  const req = normalizeAiSqlRequest(params, aiConfig.keyRef);
  if (!req.connectionId) throw new Error("缺少 connectionId");
  if (!req.sql.trim()) throw new Error("sql 不能为空");
  const session = getSession(req.connectionId);
  const promptMeta = await buildPortablePromptWithSchema(sessionConnectorFor(req.connectionId), {
    sql: req.sql,
    schema: req.schema,
    instructions: req.instructions,
  });
  return {
    prompt: promptMeta.prompt,
    schemaInjected: promptMeta.schemaInjected,
  };
}

export async function aiPromptBuildDiff(params: {
  connectionId: string;
  sql: string;
  schema?: string;
}): Promise<{
  prompt: string;
  schemaInjected?: string[];
}> {
  const { connectionId, sql, schema } = params;
  if (!sql?.trim()) throw new Error("sql 不能为空");
  const session = getSession(connectionId);
  const schemaMeta = await buildAiSchemaContext(sessionConnectorFor(connectionId), schema);
  return {
    prompt: buildDiffSqlPrompt({ sql, schemaContext: schemaMeta.context, dialect: sessionConnectorFor(connectionId).dbKind }),
    schemaInjected: schemaMeta.injected,
  };
}

// ── API 分发 ─────────────────────────────────────────────────

/** 处理 API 请求，返回纯数据（可 JSON 序列化） */
export async function handleApiRequest<M extends ApiMethod>(
  method: M,
  payload: ApiRequestPayload[M]
): Promise<unknown> {
  const getConnId = (): string => {
    const p = payload as { connectionId?: string };
    if (!p.connectionId) throw new Error("缺少 connectionId");
    return p.connectionId;
  };
  const getS = (cid: string) => {
    const s = getSession(cid);
    if (!s) throw new Error("未找到数据库连接，请先连接数据库");
    return s;
  };

  /** 校验载荷中的 dbType 与会话一致（除 db/connect 外凡带 connectionId 的 db/* 均应使用） */
  const getSWithDb = (cid: string) => {
    const p = payload as { dbType?: DbKind };
    const s = getS(cid);
    assertSessionDbType(s, p.dbType);
    return s;
  };

  if (typeof method === "string" && method.startsWith("db/")) {
    if (shouldRouteDbRequestToMysql(method, payload)) {
      const mysqlCtx: MysqlDbHandlerContext = {
        getConnId,
        connectorFor: sessionConnectorFor,
        getS,
        getSWithDb,
        sendSSEMessage,
        disconnectConnection,
        assertSessionDbType,
        capabilitiesForKind,
        startMysqlUserClientKeepalive,
        stopUserClientKeepalive,
      };
      return handleMysqlDbRequest(method, payload, mysqlCtx);
    }

    if (shouldRouteDbRequestToSqlServer(method, payload)) {
      const sqlServerCtx: SqlServerDbHandlerContext = {
        getConnId,
        connectorFor: sessionConnectorFor,
        getS,
        getSWithDb,
        sendSSEMessage,
        disconnectConnection,
        assertSessionDbType,
        capabilitiesForKind,
        startSqlServerUserClientKeepalive: startUserClientKeepalive,
        stopUserClientKeepalive,
      };
      return handleSqlServerDbRequest(method, payload, sqlServerCtx);
    }

    let pgCtxRef!: PostgresDbHandlerContext;
    const pgCtx: PostgresDbHandlerContext = {
      getConnId,
      connectorFor: sessionConnectorFor,
      getS,
      getSWithDb,
      getStatements,
      recreateUserUsedClient,
      attachPostgresClientHandlers,
      startUserClientKeepalive,
      stopUserClientKeepalive,
      sendSSEMessage,
      disconnectConnection,
      assertSessionDbType,
      capabilitiesForKind,
      isPgUserClientDeadError,
      forward: (m, p) => handlePostgresDbRequest(m, p, pgCtxRef),
    };
    pgCtxRef = pgCtx;
    return handlePostgresDbRequest(method, payload, pgCtx);
  }

  switch (method) {
    case "connections/list": {
      return connectionsList();
    }

    case "connections/save": {
      return connectionsSave(payload as Parameters<typeof connectionsSave>[0]);
    }

    case "connections/delete": {
      return connectionsDelete(payload as Parameters<typeof connectionsDelete>[0]);
    }

    case "connections/update-meta": {
      return connectionsUpdateMeta(payload as Parameters<typeof connectionsUpdateMeta>[0]);
    }

    case "connections/connect": {
      return connectionsConnect(payload as Parameters<typeof connectionsConnect>[0]);
    }

    case "connections/reorder": {
      return connectionsReorder(payload as Parameters<typeof connectionsReorder>[0]);
    }

    case "connections/get-params": {
      return connectionsGetParams(payload as Parameters<typeof connectionsGetParams>[0]);
    }

    case "query-history/add": {
      return queryHistoryAdd(payload as Parameters<typeof queryHistoryAdd>[0]);
    }

    case "query-history/search": {
      return queryHistorySearch(payload as Parameters<typeof queryHistorySearch>[0]);
    }

    case "query-history/delete": {
      return queryHistoryDelete(payload as Parameters<typeof queryHistoryDelete>[0]);
    }

    case "query-history/clear": {
      return queryHistoryClear();
    }

    case "subscription/assert": {
      return subscriptionAssert(payload as Parameters<typeof subscriptionAssert>[0]);
    }

    case "subscription/account": {
      return subscriptionAccount();
    }

    case "ai/config/get": {
      return aiConfigGet();
    }

    case "ai/config/set": {
      return aiConfigSet(payload as Parameters<typeof aiConfigSet>[0]);
    }

    case "ai/key/delete": {
      return aiKeyDelete(payload as Parameters<typeof aiKeyDelete>[0]);
    }

    case "ai/test-connection": {
      return aiTestConnection(payload as Parameters<typeof aiTestConnection>[0]);
    }

    case "ai/sql-edit": {
      return aiSqlEdit(payload as Parameters<typeof aiSqlEdit>[0]);
    }

    case "ai/prompt-build": {
      return aiPromptBuild(payload as Parameters<typeof aiPromptBuild>[0]);
    }

    case "ai/prompt-build-diff": {
      return aiPromptBuildDiff(payload as Parameters<typeof aiPromptBuildDiff>[0]);
    }

    default:
      throw new Error(`未知 API 方法: ${method}`);
  }
}

/** 建立数据库连接（供 db/* 分发使用；实现见 `db/sessions.ts`） */
export { connectSession };
