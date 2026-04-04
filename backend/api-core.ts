/**
 * 后端 API 核心：纯业务逻辑，与传输方式无关
 * 供 api-handlers-http 和 api-handlers-vscode 共同调用
 */

import {
  getSqlSegments,
  type PostgresLoginParams,
  type ApiMethod,
  type ApiRequestPayload,
  type ConnectDbRequest,
  type ConnectionSavePayload,
  type DbKind,
  type StoredConnectionParams,
  type SSEMessage,
  defaultDatabaseCapabilities,
  isMysqlFamily,
  isSqlServer,
} from "../shared/src";
import { connectPostgres, getDbConfig, type GetDbConfigResult } from "./connect-postgres";
import type { MysqlSessionConnection, SessionConnection, SqlServerSessionConnection } from "./session-connection";
import { handlePostgresDbRequest, type PostgresDbHandlerContext } from "./postgres-db-handlers";
import { handleMysqlDbRequest, teardownMysqlStreaming, type MysqlDbHandlerContext } from "./mysql-db-handlers";
import {
  buildSqlServerSchemaContext,
  handleSqlServerDbRequest,
  type SqlServerDbHandlerContext,
} from "./sqlserver-db-handlers";
import { openSqlServerPool } from "./connect-sqlserver";
import { teardownSqlServerRowStream } from "./sqlserver-mssql-stream";
import { listConnections, saveConnection, removeConnection, getConnectionParams, updateConnectionMeta, reorderConnections } from "./connections-store";
import { addQuery as addQueryHistory, searchHistory, deleteEntry as deleteHistoryEntry, clearHistory as clearQueryHistory } from "./query-history-store";
import { getAiKey as getAiKeyFromStore, setAiKey as setAiKeyToStore, deleteAiKey as deleteAiKeyFromStore } from "./ai-key-store";
import { runAiSqlTask, type AiApiMode } from "./ai-service";
import type { Pool as MysqlPool } from "mysql2/promise";
import type { Client, Pool } from "pg";

export type { SessionConnection } from "./session-connection";
export type { SSEMessage };

/**
 * 载荷中的 dbType 仅作提示；路由与权限以 connectionMap 内会话的 dbKind 为准。
 * 避免因前端刷新后未再登记 dbType（默认 postgres）导致已建立的 MySQL 会话请求失败、侧栏空白。
 */
function assertSessionDbType(session: SessionConnection, dbType: DbKind | undefined): void {
  void session;
  void dbType;
}

function capabilitiesForKind(kind: DbKind) {
  return defaultDatabaseCapabilities(kind);
}

function isPgUserClientDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /not queryable|connection error|Connection terminated/i.test(msg);
}

function isMysqlUserClientDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /Connection lost|ECONNRESET|PROTOCOL_CONNECTION_LOST|not connected/i.test(msg);
}

function isSqlServerPoolDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /ECONNRESET|Connection lost|socket|timeout|closed|Failed to connect|broken/i.test(msg);
}

function attachPostgresClientHandlers(cid: string, client: Client): void {
  client.on("error", (err: Error) => {
    sendSSEMessage(cid, { type: "ERROR", message: err.message || String(err), timestamp: Date.now() });
  });
  client.on("notice", (msg: any) => {
    const severity = (msg.severity || "NOTICE").toUpperCase();
    sendSSEMessage(cid, {
      type: severity as SSEMessage["type"],
      message: msg.message || String(msg),
      timestamp: Date.now(),
      detail: msg.detail || msg.hint || undefined,
    });
  });
  client.on("notification", (msg: any) => {
    sendSSEMessage(cid, {
      type: "NOTIFICATION",
      message: `[${msg.channel}] ${msg.payload || "(无内容)"}`,
      timestamp: Date.now(),
    });
  });
  client.on("end", () => {
    sendSSEMessage(cid, { type: "WARNING", message: "数据库连接已断开", timestamp: Date.now() });
  });
}

/** Monaco 等使用的长连接 Client 异常后 pg 会报 not queryable；连接池仍可用故侧栏只读查询正常 */
async function recreateUserUsedClient(cid: string): Promise<void> {
  const session = connectionMap.get(cid);
  if (!session) throw new Error("连接不存在");
  if (session.dbKind !== "postgres") throw new Error("内部错误：非 PostgreSQL 会话");
  if (session.cursor) {
    try {
      await new Promise<void>((r) => session.cursor!.instance.close(() => r()));
    } catch {
      /* ignore */
    }
    session.cursor = undefined;
  }
  session.runningQueryPid = undefined;
  await session.userUsedClient.end().catch(() => {});
  const client = await connectPostgres(session.dbForReconnect);
  attachPostgresClientHandlers(cid, client);
  session.userUsedClient = client;
  sendSSEMessage(cid, { type: "INFO", message: "查询专用连接已自动重建", timestamp: Date.now() });
}

async function recreateMysqlUserUsedClient(cid: string): Promise<void> {
  const session = connectionMap.get(cid);
  if (!session) throw new Error("连接不存在");
  if (!isMysqlFamily(session.dbKind)) throw new Error("内部错误：非 MySQL/MariaDB 会话");
  const m = session as MysqlSessionConnection;
  try {
    m.userUsedClient.release();
  } catch {
    /* ignore */
  }
  const conn = await m.backGroundPool.getConnection();
  m.userUsedClient = conn;
  sendSSEMessage(cid, { type: "INFO", message: "查询专用连接已自动重建", timestamp: Date.now() });
}

async function recreateSqlServerPool(cid: string): Promise<void> {
  const session = connectionMap.get(cid);
  if (!session) throw new Error("连接不存在");
  if (session.dbKind !== "sqlserver") throw new Error("内部错误：非 SQL Server 会话");
  const s = session as SqlServerSessionConnection;
  if (s.sqlServerRowStream) {
    await teardownSqlServerRowStream(s.sqlServerRowStream);
    s.sqlServerRowStream = undefined;
  }
  s.sqlServerActiveRequest = undefined;
  await s.userUsedClient.close().catch(() => {});
  const pool = await openSqlServerPool(s.dbForReconnect);
  s.userUsedClient = pool;
  s.backGroundPool = pool;
  sendSSEMessage(cid, { type: "INFO", message: "SQL Server 连接池已自动重建", timestamp: Date.now() });
}

/** 按不在引号/注释内的 ; 拆成多条语句（与前端分块规则一致，仅不分空行）。 */
function getStatements(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

/** 以 connectionId 为 key 存储多个连接 */
const connectionMap = new Map<string, SessionConnection>();

/**
 * `db/*` 是否交给 MySQL 处理器（与 PostgreSQL 二选一）。
 * 建连看载荷 `dbType`；已建连看会话 `connectionMap` 中 `dbKind`。
 */
function shouldRouteDbRequestToMysql(method: string, payload: unknown): boolean {
  if (!method.startsWith("db/")) return false;
  if (method === "db/connect") {
    return isMysqlFamily((payload as ConnectDbRequest).dbType);
  }
  const cid = (payload as { connectionId?: string }).connectionId;
  if (cid == null || String(cid) === "") return false;
  const k = connectionMap.get(String(cid))?.dbKind;
  return k != null && isMysqlFamily(k);
}

function shouldRouteDbRequestToSqlServer(method: string, payload: unknown): boolean {
  if (!method.startsWith("db/")) return false;
  if (method === "db/connect") {
    return (payload as ConnectDbRequest).dbType === "sqlserver";
  }
  const cid = (payload as { connectionId?: string }).connectionId;
  if (cid == null || String(cid) === "") return false;
  return connectionMap.get(String(cid))?.dbKind === "sqlserver";
}
const aiKeyStore = new Map<string, string>();

/** 探活间隔：略小于常见 idle 超时，避免首条 Monaco 查询才暴露死连接 */
const USER_CLIENT_KEEPALIVE_MS = 60_000;
const USER_CLIENT_KEEPALIVE_SQL = "SELECT 1 --keepalive";

function stopUserClientKeepalive(session: SessionConnection): void {
  if (session.keepAliveTimer != null) {
    clearInterval(session.keepAliveTimer);
    session.keepAliveTimer = undefined;
  }
}

function startUserClientKeepalive(cid: string): void {
  const session = connectionMap.get(cid);
  if (!session) return;
  stopUserClientKeepalive(session);
  session.keepAliveTimer = setInterval(() => {
    void (async () => {
      const s = connectionMap.get(cid);
      if (!s) return;
      if (s.dbKind === "postgres") {
        if (s.cursor) return;
        try {
          await s.userUsedClient.query(USER_CLIENT_KEEPALIVE_SQL);
        } catch (e) {
          if (isPgUserClientDeadError(e)) {
            await recreateUserUsedClient(cid).catch(() => {});
          }
        }
      } else if (s.dbKind === "sqlserver") {
        if (s.sqlServerRowStream) return;
        try {
          await s.userUsedClient.request().query("SELECT 1");
        } catch (e) {
          if (isSqlServerPoolDeadError(e)) {
            await recreateSqlServerPool(cid).catch(() => {});
          }
        }
      } else {
        try {
          await s.userUsedClient.query("SELECT 1");
        } catch (e) {
          if (isMysqlUserClientDeadError(e)) {
            await recreateMysqlUserUsedClient(cid).catch(() => {});
          }
        }
      }
    })();
  }, USER_CLIENT_KEEPALIVE_MS);
}

function startMysqlUserClientKeepalive(cid: string): void {
  startUserClientKeepalive(cid);
}

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

async function buildPostgresSchemaContext(pool: Pool, schema?: string): Promise<{ context: string; injected: string[] }> {
  const schemas = schema
    ? [schema]
    : (
      await pool.query(
        `SELECT schema_name
         FROM information_schema.schemata
         WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'
         ORDER BY schema_name
         LIMIT 2`
      )
    ).rows.map((r: any) => r.schema_name as string);

  const chunks: string[] = [];
  const injected: string[] = [];
  for (const s of schemas) {
    const tablesRes = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name
       LIMIT 6`,
      [s]
    );
    for (const t of tablesRes.rows as Array<{ table_name: string }>) {
      const colsRes = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position
         LIMIT 12`,
        [s, t.table_name]
      );
      const cols = colsRes.rows.map((c: any) => `${c.column_name}:${c.data_type}`).join(", ");
      const tableRef = `${s}.${t.table_name}`;
      chunks.push(`${tableRef}(${cols})`);
      injected.push(tableRef);
    }
  }
  return { context: chunks.join("\n"), injected };
}

async function buildMysqlSchemaContext(pool: MysqlPool, schema?: string): Promise<{ context: string; injected: string[] }> {
  const schemas = schema
    ? [schema]
    : (
        (
          await pool.query(
            `SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA
             WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')
             ORDER BY SCHEMA_NAME LIMIT 2`
          )
        )[0] as Array<Record<string, unknown>>
      ).map((r) => String(r.schema_name ?? r.SCHEMA_NAME ?? "")).filter(Boolean);

  const chunks: string[] = [];
  const injected: string[] = [];
  for (const s of schemas) {
    const [tableRows] = await pool.query(
      `SELECT TABLE_NAME AS table_name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME LIMIT 6`,
      [s]
    );
    for (const tr of (tableRows as Array<Record<string, unknown>>) ?? []) {
      const tname = String(tr.table_name ?? tr.TABLE_NAME ?? "");
      if (!tname) continue;
      const [colRows] = await pool.query(
        `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION LIMIT 12`,
        [s, tname]
      );
      const cols = ((colRows as Array<Record<string, unknown>>) ?? [])
        .map((c) => {
          const cn = String(c.column_name ?? c.COLUMN_NAME ?? "");
          const dt = String(c.data_type ?? c.DATA_TYPE ?? "");
          return `${cn}:${dt}`;
        })
        .filter((x) => x !== ":");
      const tableRef = `${s}.${tname}`;
      chunks.push(`${tableRef}(${cols.join(", ")})`);
      injected.push(tableRef);
    }
  }
  return { context: chunks.join("\n"), injected };
}

function aiDialectDisplayLabel(dialect: DbKind): string {
  if (dialect === "postgres") return "PostgreSQL";
  if (dialect === "mariadb") return "MariaDB";
  if (dialect === "sqlserver") return "Microsoft SQL Server";
  return "MySQL";
}

async function buildAiSchemaContext(session: SessionConnection, schema?: string): Promise<{ context: string; injected: string[] }> {
  switch (session.dbKind) {
    case "postgres":
      return buildPostgresSchemaContext(session.backGroundPool as Pool, schema);
    case "mysql":
    case "mariadb":
      return buildMysqlSchemaContext(session.backGroundPool as MysqlPool, schema);
    case "sqlserver":
      return buildSqlServerSchemaContext((session as SqlServerSessionConnection).backGroundPool, schema);
    default:
      throw new Error("不支持的会话类型");
  }
}

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
  session: SessionConnection,
  params: { sql: string; schema?: string; instructions?: string }
): Promise<{ prompt: string; schemaInjected: string[] }> {
  const schemaMeta = await buildAiSchemaContext(session, params.schema);
  const prompt = buildPortableSqlPrompt({
    sql: params.sql,
    schemaContext: schemaMeta.context,
    extraInstruction: params.instructions,
    dialect: session.dbKind,
  });
  return { prompt, schemaInjected: schemaMeta.injected };
}

async function executeAiSqlEdit(params: {
  session: SessionConnection;
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
  const promptMeta = await buildPortablePromptWithSchema(params.session, {
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
      systemPrompt: buildAiJsonSystemPrompt(params.session.dbKind),
      userPrompt: promptMeta.prompt,
    }
  );
  return { ...result, schemaInjected: promptMeta.schemaInjected };
}

/** 断开并释放连接资源（供 SSE 关闭时调用，释放标签页关闭后的泄漏） */
export async function disconnectConnection(connectionId: string): Promise<void> {
  const conn = connectionMap.get(connectionId);
  if (conn) {
    connectionMap.delete(connectionId);
    stopUserClientKeepalive(conn);
    if (conn.dbKind === "postgres") {
      await conn.userUsedClient.end().catch(() => {});
      await conn.backGroundPool.end().catch(() => {});
    } else if (conn.dbKind === "sqlserver") {
      if (conn.sqlServerRowStream) {
        await teardownSqlServerRowStream(conn.sqlServerRowStream);
        conn.sqlServerRowStream = undefined;
      }
      await conn.userUsedClient.close().catch(() => {});
    } else {
      if (isMysqlFamily(conn.dbKind)) {
        teardownMysqlStreaming(conn);
      }
      try {
        conn.userUsedClient.release();
      } catch {
        /* ignore */
      }
      await conn.backGroundPool.end().catch(() => {});
    }
    await conn.closeTunnel?.().catch(() => {});
  }
}

export function sendSSEMessage(connectionId: string, message: SSEMessage) {
  const conn = connectionMap.get(connectionId);
  if (!conn) return;

  for (const push of conn.eventPushers) {
    try {
      push(message);
    } catch (e) {
      conn.eventPushers.delete(push);
    }
  }
}

export function getSession(connectionId: string): SessionConnection | undefined {
  return connectionMap.get(connectionId);
}

/** 订阅连接的事件推送，返回取消订阅函数 */
export function subscribeSessionEvents(
  connectionId: string,
  push: (msg: SSEMessage) => void
): () => void {
  const conn = connectionMap.get(connectionId);
  if (!conn) throw new Error("未找到数据库连接，请先连接数据库");

  conn.eventPushers.add(push);
  return () => conn.eventPushers.delete(push);
}

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
        connectionMap,
        getConnId,
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
        connectionMap,
        getConnId,
        getS,
        getSWithDb,
        sendSSEMessage,
        disconnectConnection,
        assertSessionDbType,
        capabilitiesForKind,
        startSqlServerUserClientKeepalive: startMysqlUserClientKeepalive,
        stopUserClientKeepalive,
      };
      return handleSqlServerDbRequest(method, payload, sqlServerCtx);
    }

    let pgCtxRef!: PostgresDbHandlerContext;
    const pgCtx: PostgresDbHandlerContext = {
      connectionMap,
      getConnId,
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
        session,
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
      const promptMeta = await buildPortablePromptWithSchema(session, {
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
      const schemaMeta = await buildAiSchemaContext(session, schema);
      return {
        prompt: buildDiffSqlPrompt({ sql, schemaContext: schemaMeta.context, dialect: session.dbKind }),
        schemaInjected: schemaMeta.injected,
      };
    }

    default:
      throw new Error(`未知 API 方法: ${method}`);
  }
}
