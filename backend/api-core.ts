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

  /** 业务 handler 访问连接能力的唯一入口 */
  const sessionConnectorFor = (cid: string): DbConnector => {
    const c = sessionConnectorOf(cid);
    if (!c) throw new Error("未找到数据库连接，请先连接数据库");
    return c;
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
      return listConnections();
    }

    case "connections/save": {
      const { id, name, group, dbType, ...params } = payload as ConnectionSavePayload;
      if (!id || !String(params.host ?? "").trim() || !String(params.username ?? "").trim()) {
        throw new Error("缺少必填字段");
      }
      const kind = dbType ?? "postgres";
      const defaultPort = isMysqlFamily(kind) ? "3306" : isSqlServer(kind) ? "1433" : "5432";
      const toSave: StoredConnectionParams = {
        host: params.host,
        port: params.port || defaultPort,
        database: String(params.database ?? "").trim(),
        username: params.username,
        password: params.password || "",
        dbType: kind,
      };
      if (params.sshEnabled) {
        toSave.sshEnabled = true;
        toSave.sshHost = params.sshHost;
        toSave.sshPort = params.sshPort || "22";
        toSave.sshUsername = params.sshUsername;
        toSave.sshPassword = params.sshPassword;
        toSave.sshPrivateKey = params.sshPrivateKey;
        if (params.connectionTimeoutSec != null && params.connectionTimeoutSec > 0) {
          toSave.connectionTimeoutSec = params.connectionTimeoutSec;
        }
      }
      saveConnection(id, toSave, { name, group });
      return { success: true };
    }

    case "connections/delete": {
      const { id } = payload as { id: string };
      if (!id) throw new Error("缺少 id");
      removeConnection(id);
      return { success: true };
    }

    case "connections/update-meta": {
      const { id, name } = payload as { id: string; name?: string };
      if (!id) throw new Error("缺少 id");
      updateConnectionMeta(id, { name });
      return { success: true };
    }

    case "connections/connect": {
      const { id, sessionId } = payload as { id: string; sessionId?: string };
      const params = getConnectionParams(id);
      if (!params) throw new Error("未找到已保存的连接");
      const { id: storedId, dbType, ...loginParams } = params;
      // 使用 sessionId 区分不同浏览器标签页，关闭标签页时可通过 SSE 断开释放资源
      const connectionId = sessionId ? `${storedId}-${sessionId}` : storedId;
      return handleApiRequest("db/connect", { connectionId, dbType: dbType ?? "postgres", ...loginParams } as ConnectDbRequest);
    }

    case "connections/reorder": {
      const { list } = payload as { list: unknown[] };
      if (!Array.isArray(list)) throw new Error("list 必须是数组");
      reorderConnections(list);
      return { success: true };
    }

    case "connections/get-params": {
      const { id } = payload as { id: string };
      if (!id) throw new Error("缺少 id");
      const params = getConnectionParams(id);
      if (!params) return null;
      const { id: _id, ...rest } = params;
      return rest as StoredConnectionParams;
    }

    case "query-history/add": {
      const addPayload = payload as { sql: string; connectionId?: string };
      addQueryHistory(addPayload.sql, addPayload.connectionId);
      return { success: true };
    }

    case "query-history/search": {
      const searchPayload = payload as { keyword?: string; since?: number; until?: number };
      return searchHistory({
        keyword: searchPayload.keyword,
        since: searchPayload.since,
        until: searchPayload.until,
      });
    }

    case "query-history/delete": {
      const { id } = payload as { id: string };
      if (!id) throw new Error("缺少 id");
      deleteHistoryEntry(id);
      return { success: true };
    }

    case "query-history/clear": {
      clearQueryHistory();
      return { success: true };
    }

    case "subscription/assert": {
      const { feature } = payload as { feature?: string };
      const allowed = new Set(["visual-query-builder", "table-designer"]);
      if (!feature || !allowed.has(feature)) throw new Error("无效的功能标识");
      return { success: true };
    }

    case "subscription/account": {
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

    case "ai/config/get": {
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

    case "ai/config/set": {
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
      } = payload as {
        apiMode: AiApiMode;
        baseUrl?: string;
        model: string;
        keyRef?: string;
        apiKey?: string;
        temperature?: number;
        topP?: number;
        stream?: boolean;
        maxTokens?: number;
      };
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
        // Web 端落盘加密，VSCode 端仍以 SecretStorage 为主（此处不影响其逻辑）
        setAiKeyToStore(aiConfig.keyRef, trimmed);
      }
      return { success: true };
    }

    case "ai/key/delete": {
      const { keyRef = aiConfig.keyRef } = payload as { keyRef?: string };
      const ref = keyRef.trim() || "default";
      aiKeyStore.delete(ref);
      deleteAiKeyFromStore(ref);
      return { success: true };
    }

    case "ai/test-connection": {
      const {
        apiMode = aiConfig.apiMode,
        baseUrl = aiConfig.baseUrl,
        model = aiConfig.model,
        keyRef = aiConfig.keyRef,
        temperature = aiConfig.temperature,
        topP = aiConfig.topP,
        stream = aiConfig.stream,
        maxTokens = aiConfig.maxTokens,
      } = payload as {
        apiMode?: AiApiMode;
        baseUrl?: string;
        model?: string;
        keyRef?: string;
        temperature?: number;
        topP?: number;
        stream?: boolean;
        maxTokens?: number;
      };
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

    case "ai/sql-edit": {
      const req = normalizeAiSqlRequest(payload, aiConfig.keyRef);
      if (!req.connectionId) throw new Error("缺少 connectionId");
      if (!req.sql.trim()) throw new Error("sql 不能为空");
      const session = getS(req.connectionId);
      return executeAiSqlEdit({
        connector: sessionConnectorFor(req.connectionId),
        sql: req.sql,
        keyRef: req.keyRef,
        schema: req.schema,
        instruction: req.instructions || "补全",
      });
    }

    case "ai/prompt-build": {
      const req = normalizeAiSqlRequest(payload, aiConfig.keyRef);
      if (!req.connectionId) throw new Error("缺少 connectionId");
      if (!req.sql.trim()) throw new Error("sql 不能为空");
      const session = getS(req.connectionId);
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

    case "ai/prompt-build-diff": {
      const { connectionId: promptDiffConnId, sql, schema } = payload as {
        connectionId: string;
        sql: string;
        schema?: string;
      };
      if (!sql?.trim()) throw new Error("sql 不能为空");
      const session = getS(promptDiffConnId);
      const schemaMeta = await buildAiSchemaContext(sessionConnectorFor(promptDiffConnId), schema);
      return {
        prompt: buildDiffSqlPrompt({ sql, schemaContext: schemaMeta.context, dialect: sessionConnectorFor(promptDiffConnId).dbKind }),
        schemaInjected: schemaMeta.injected,
      };
    }

    default:
      throw new Error(`未知 API 方法: ${method}`);
  }
}

/** 建立数据库连接（供 db/* 分发使用；实现见 `db/sessions.ts`） */
export { connectSession };
