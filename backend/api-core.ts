/**
 * 后端 API 核心：纯业务逻辑，与传输方式无关
 * 供 api-handlers-http 和 api-handlers-vscode 共同调用
 */

import {
  getSqlSegments,
  type PostgresLoginParams,
  type ApiMethod,
  type ApiRequestPayload,
  type ConnectPostgresRequest,
} from "../shared/src";
import { connectPostgres, createPostgresPool, getDbConfig } from "./connect-postgres";
import { calculateColumnEditable } from "./column-editable";
import { listConnections, saveConnection, removeConnection, getConnectionParams, updateConnectionMeta, reorderConnections } from "./connections-store";
import { addQuery as addQueryHistory, searchHistory, deleteEntry as deleteHistoryEntry, clearHistory as clearQueryHistory } from "./query-history-store";
import { getAiKey as getAiKeyFromStore, setAiKey as setAiKeyToStore, deleteAiKey as deleteAiKeyFromStore } from "./ai-key-store";
import { runAiSqlTask, type AiProvider } from "./ai-service";
import { Client, Pool, type PoolClient } from "pg";
import Cursor from "pg-cursor";

export interface SSEMessage {
  type: "NOTICE" | "ERROR" | "INFO" | "WARNING" | "QUERY" | "NOTIFICATION";
  message: string;
  timestamp: number;
  detail?: string;
}

export interface SessionConnection {
  userUsedClient: Client;
  backGroundPool: Pool;
  runningQueryPid?: number;
  eventPushers: Set<(msg: SSEMessage) => void>;
  closeTunnel?: () => Promise<void>;
  cursor?: {
    instance: Cursor;
    columns?: any[];
    isDone: boolean;
  };
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
const aiKeyStore = new Map<string, string>();

let aiKeyResolver: ((keyRef: string) => Promise<string | undefined>) | null = null;

export function setAiKeyResolver(resolver: ((keyRef: string) => Promise<string | undefined>) | null): void {
  aiKeyResolver = resolver;
}

interface AiRuntimeConfig {
  provider: AiProvider;
  baseUrl?: string;
  model: string;
  keyRef: string;
  temperature: number;
  topP?: number;
  stream: boolean;
  maxTokens: number;
}

let aiConfig: AiRuntimeConfig = {
  provider: "aliyun",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "qwen-plus",
  keyRef: "default",
  temperature: 0.2,
  topP: undefined,
  stream: true,
  maxTokens: 700,
};

function inferProviderFromBaseUrl(baseUrl?: string): AiProvider {
  const u = (baseUrl || "").toLowerCase();
  if (u.includes("anthropic.com")) return "anthropic";
  if (u.includes("dashscope.aliyuncs.com") || u.includes("aliyun")) return "aliyun";
  return "openai";
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

async function buildSchemaContext(pool: Pool, schema?: string): Promise<{ context: string; injected: string[] }> {
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

function buildPortableSqlPrompt(params: {
  sql: string;
  schemaContext: string;
  extraInstruction?: string;
}): string {
  const { sql, schemaContext, extraInstruction } = params;
  return [
    "你是 SQL 助手，请严格按要求输出。",
    "任务: 按用户要求编辑当前 SQL",
    "数据库: PostgreSQL",
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

function buildDiffSqlPrompt(params: { sql: string; schemaContext: string }): string {
  const { sql, schemaContext } = params;
  return [
    "[DIFF MODE] 你是 SQL 助手，请严格按要求输出。",
    "任务: 输出最小改动的 SQL diff JSON",
    "数据库: PostgreSQL",
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
    "2) after 必须是可执行 PostgreSQL SQL。",
    "3) 最小修改，changes 尽量少。",
    "4) 不允许 DROP/TRUNCATE/无 WHERE 的 UPDATE/DELETE。",
    "5) 若无需修改，after=before，changes=[]。",
    "6) 仅输出 JSON，不允许输出任何额外文字。",
  ].join("\n");
}

const AI_JSON_SYSTEM_PROMPT = [
  "You are a SQL assistant for database developers.",
  "Output MUST be valid JSON only, no markdown fences.",
  "Do NOT output LaTeX, math boxes, markdown tables, or prose outside JSON.",
  "JSON keys MUST be exactly: sql, rationale, warnings, alternatives.",
  "Target dialect is PostgreSQL unless explicitly overridden.",
  "Do not include dangerous SQL unless user explicitly asks.",
  "When suggesting UPDATE/DELETE, require clear WHERE conditions.",
  "Prefer deterministic, production-safe SQL.",
].join("\n");

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
  const schemaMeta = await buildSchemaContext(session.backGroundPool, params.schema);
  const prompt = buildPortableSqlPrompt({
    sql: params.sql,
    schemaContext: schemaMeta.context,
    extraInstruction: params.instructions,
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
      provider: aiConfig.provider,
      baseUrl: aiConfig.baseUrl,
      model: aiConfig.model,
      apiKey,
      temperature: aiConfig.temperature,
      topP: aiConfig.topP,
      stream: aiConfig.stream,
      maxTokens: aiConfig.maxTokens,
    },
    {
      systemPrompt: AI_JSON_SYSTEM_PROMPT,
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
    await conn.userUsedClient.end().catch(() => {});
    await conn.backGroundPool.end().catch(() => {});
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

  switch (method) {
    case "connections/list": {
      return listConnections();
    }

    case "connections/save": {
      const { id, name, ...params } = payload as { id: string; name?: string } & PostgresLoginParams;
      if (!id || !params.host || !params.database || !params.username) {
        throw new Error("缺少必填字段");
      }
      const toSave: PostgresLoginParams = {
        host: params.host,
        port: params.port || "5432",
        database: params.database,
        username: params.username,
        password: params.password || "",
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
      saveConnection(id, toSave, { name });
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
      if (!params) return { sucess: false, error: "未找到已保存的连接" };
      const { id: storedId, ...loginParams } = params;
      // 使用 sessionId 区分不同浏览器标签页，关闭标签页时可通过 SSE 断开释放资源
      const connectionId = sessionId ? `${storedId}-${sessionId}` : storedId;
      return handleApiRequest("connect-postgres", { connectionId, ...loginParams } as any);
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
      return rest as PostgresLoginParams;
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
        provider: aiConfig.provider,
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
        provider,
        baseUrl,
        model,
        keyRef = "default",
        apiKey,
        temperature,
        topP,
        stream,
        maxTokens,
      } = payload as {
        provider?: AiProvider;
        baseUrl?: string;
        model: string;
        keyRef?: string;
        apiKey?: string;
        temperature?: number;
        topP?: number;
        stream?: boolean;
        maxTokens?: number;
      };
      const resolvedProvider = provider ?? inferProviderFromBaseUrl(baseUrl);
      aiConfig = {
        provider: resolvedProvider,
        baseUrl: baseUrl?.trim() || aiConfig.baseUrl,
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
        provider = aiConfig.provider,
        baseUrl = aiConfig.baseUrl,
        model = aiConfig.model,
        keyRef = aiConfig.keyRef,
        temperature = aiConfig.temperature,
        topP = aiConfig.topP,
        stream = aiConfig.stream,
        maxTokens = aiConfig.maxTokens,
      } = payload as {
        provider?: AiProvider;
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
      await runAiSqlTask(
        { provider, baseUrl, model, apiKey, temperature, topP, stream, maxTokens },
        {
          systemPrompt: AI_JSON_SYSTEM_PROMPT,
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
      const { connectionId: cid, sql, schema } = payload as {
        connectionId: string;
        sql: string;
        schema?: string;
      };
      if (!sql?.trim()) throw new Error("sql 不能为空");
      const session = getS(cid);
      const schemaMeta = await buildSchemaContext(session.backGroundPool, schema);
      return {
        prompt: buildDiffSqlPrompt({ sql, schemaContext: schemaMeta.context }),
        schemaInjected: schemaMeta.injected,
      };
    }

    case "connect-postgres": {
      const params = payload as ConnectPostgresRequest;
      const { connectionId: cid, ...connectParams } = params;
      const loginParams: PostgresLoginParams = { ...connectParams, password: connectParams.password ?? "" };

      // 若已存在同 ID 连接，先断开（必须先关闭 pg 连接再关隧道，否则 server.close 会死锁）
      const existing = connectionMap.get(cid);
      if (existing) {
        connectionMap.delete(cid);
        await existing.userUsedClient.end().catch(() => {});
        await existing.backGroundPool.end().catch(() => {});
        await existing.closeTunnel?.().catch(() => {});
      }

      const db = await getDbConfig(loginParams);
      const client = await connectPostgres(db);
      const adminPool = createPostgresPool(db);

      client.on("error", (err) => {
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

      connectionMap.set(cid, {
        userUsedClient: client,
        backGroundPool: adminPool,
        eventPushers: new Set(),
        closeTunnel: db.closeTunnel,
      });
      return { sucess: true, connectionId: cid };
    }

    case "disconnect-postgres": {
      const { connectionId: cid } = payload as { connectionId: string };
      await disconnectConnection(cid);
      return { success: true };
    }

    case "postgres/query-stream": {
      const cid = getConnId();
      const { query, statements: payloadStatements, batchSize = 100 } = payload as {
        connectionId: string;
        query?: string;
        statements?: string[];
        batchSize?: number;
      };
      const session = getS(cid);
      const { userUsedClient: client, backGroundPool: adminPool } = session;

      if (session.cursor) {
        await new Promise<void>((r) => session.cursor!.instance.close(() => r()));
        session.cursor = undefined;
      }

      try {
        const pidRes = await client.query("SELECT pg_backend_pid() as pid");
        session.runningQueryPid = parseInt(String(pidRes.rows[0]?.pid ?? 0), 10) || undefined;
      } catch {
        session.runningQueryPid = (client as any).processID;
      }

      const statements = payloadStatements?.length ? payloadStatements : getStatements(query ?? "");
      if (statements.length === 0) {
        return { rows: [], columns: [], hasMore: false };
      }

      // 前面的语句逐条用简单 query 执行（不支持 prepared 多命令）
      for (let i = 0; i < statements.length - 1; i++) {
        await client.query(statements[i]);
      }

      const lastStatement = statements[statements.length - 1];
      const cursor = client.query(new Cursor(lastStatement, [], { rowMode: "array" }));
      const rows = await new Promise<any[]>((resolve, reject) => {
        cursor.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      });

      const fields = (cursor as any)._result?.fields;
      const columnsInfo = fields ? await calculateColumnEditable(adminPool, fields, lastStatement) : [];
      const isDone = rows.length < batchSize;

      if (isDone) {
        await new Promise<void>((r) => cursor.close(() => r()));
        session.runningQueryPid = undefined;
      } else {
        session.cursor = { instance: cursor, columns: columnsInfo, isDone: false };
      }

      return { rows, columns: columnsInfo, hasMore: !isDone };
    }

    case "postgres/query-stream-more": {
      const cid = getConnId();
      const { batchSize = 100 } = payload as { connectionId: string; batchSize?: number };
      const session = getS(cid);

      if (!session.cursor || session.cursor.isDone) return { rows: [], hasMore: false };

      const { cursor } = session;
      const rows = await new Promise<any[]>((resolve, reject) => {
        cursor.instance.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      });
      const isDone = rows.length < batchSize;

      if (isDone) {
        await new Promise<void>((r) => cursor.instance.close(() => r()));
        session.cursor = undefined;
        session.runningQueryPid = undefined;
      } else {
        cursor.isDone = false;
      }

      return { rows, hasMore: !isDone };
    }

    case "postgres/save-changes": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(sql);
      sendSSEMessage(cid, {
        type: "INFO",
        message: `保存成功: ${result.rowCount ?? 0} 行受影响`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: result.rowCount };
    }

    case "postgres/import-rows": {
      const cid = getConnId();
      const {
        schema,
        table,
        columns: colNames,
        rows,
        conflictColumns,
        onConflict,
        onError = "rollback",
      } = payload as {
        connectionId: string;
        schema: string;
        table: string;
        columns: string[];
        rows: any[][];
        conflictColumns?: string[];
        onConflict?: "nothing" | "update";
        onError?: "rollback" | "discard";
      };
      if (!colNames?.length || !Array.isArray(rows)) {
        throw new Error("缺少 columns 或 rows");
      }
      const session = getS(cid);
      const quote = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
      const qualified = `${quote(schema)}.${quote(table)}`;
      const cols = colNames.map(quote).join(", ");
      const BATCH = 100;
      const runOne = async (chunk: any[][], client: PoolClient): Promise<number> => {
        const placeholders: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;
        for (const row of chunk) {
          placeholders.push("(" + colNames.map(() => `$${paramIndex++}`).join(", ") + ")");
          for (let c = 0; c < colNames.length; c++) {
            values.push(row[c] ?? null);
          }
        }
        let sql = `INSERT INTO ${qualified} (${cols}) VALUES ${placeholders.join(", ")}`;
        if (conflictColumns?.length && onConflict) {
          const conflictCols = conflictColumns.map((c) => quote(c)).join(", ");
          if (onConflict === "nothing") {
            sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
          } else {
            const setClause = colNames.map((c) => `${quote(c)} = EXCLUDED.${quote(c)}`).join(", ");
            sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClause}`;
          }
        }
        const result = await client.query(sql, values);
        return result.rowCount ?? chunk.length;
      };

      let total = 0;
      if (onError === "rollback") {
        const client = await session.backGroundPool.connect();
        try {
          await client.query("BEGIN");
          for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            total += await runOne(chunk, client);
          }
          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      } else {
        const client = await session.backGroundPool.connect();
        try {
          for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            try {
              total += await runOne(chunk, client);
            } catch {
              for (const row of chunk) {
                try {
                  await runOne([row], client);
                  total += 1;
                } catch {
                  // 丢弃该行，继续
                }
              }
            }
          }
        } finally {
          client.release();
        }
      }
      sendSSEMessage(cid, {
        type: "INFO",
        message: `导入成功: ${total} 行`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: total };
    }

    case "postgres/cancel-query": {
      const cid = getConnId();
      const session = getS(cid);
      const pid = session.runningQueryPid;
      if (!pid) return { success: false, error: "没有正在执行的查询" };
      const result = await session.backGroundPool.query(`SELECT pg_cancel_backend($1)`, [pid]);
      const cancelled = result.rows[0]?.pg_cancel_backend;
      return { success: true, cancelled, message: cancelled ? "查询取消请求已发送" : "查询可能已完成或无法取消" };
    }

    case "postgres/explain": {
      const cid = getConnId();
      const { query } = payload as { connectionId: string; query: string };
      const session = getS(cid);
      const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.trim()}`;
      try {
        sendSSEMessage(cid, { type: "QUERY", message: "执行 EXPLAIN ANALYZE...", timestamp: Date.now() });
        const result = await session.backGroundPool.query(explainSql);
        const row = result.rows[0];
        const jsonVal = row ? (row as any)["QUERY PLAN"] ?? (row as any).query_plan ?? (Array.isArray(row) ? row[0] : Object.values(row)[0]) : null;
        const plan = typeof jsonVal === "string" ? JSON.parse(jsonVal) : jsonVal;
        sendSSEMessage(cid, { type: "INFO", message: "执行计划获取完成", timestamp: Date.now() });
        return { plan };
      } catch (e: any) {
        sendSSEMessage(cid, { type: "ERROR", message: `EXPLAIN 错误: ${e.message}`, timestamp: Date.now() });
        throw e;
      }
    }

    case "postgres/query-readonly": {
      const cid = getConnId();
      const { query, limit = 1000 } = payload as { connectionId: string; query: string; limit?: number };
      const session = getS(cid);
      const limitedQuery = query.trim().toLowerCase().includes("limit") ? query : `${query} LIMIT ${limit}`;
      const poolClient = await session.backGroundPool.connect();
      try {
        const pidRes = await poolClient.query("SELECT pg_backend_pid() as pid");
        session.runningQueryPid = parseInt(String(pidRes.rows[0]?.pid ?? 0), 10) || undefined;
        const result = await poolClient.query({ text: limitedQuery, rowMode: "array" });
        const columnsInfo = await calculateColumnEditable(session.backGroundPool, result.fields, limitedQuery);
        return { rows: result.rows, columns: columnsInfo, hasMore: false };
      } finally {
        session.runningQueryPid = undefined;
        poolClient.release();
      }
    }

    case "postgres/schemas": {
      const cid = getConnId();
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name`
      );
      return { schemas: result.rows.map((r) => r.schema_name) };
    }

    case "postgres/tables": {
      const cid = getConnId();
      const { schema } = payload as { connectionId: string; schema: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`,
        [schema]
      );
      let functions: Array<{ oid: number; schema: string; name: string; args: string }> = [];
      try {
        const funcResult = await session.backGroundPool.query(
          `SELECT p.oid, n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid JOIN pg_language l ON p.prolang = l.oid
           WHERE l.lanname = 'plpgsql' AND n.nspname = $1 ORDER BY p.proname`,
          [schema]
        );
        functions = funcResult.rows.map((r: any) => ({ oid: r.oid, schema: r.schema, name: r.name, args: r.args || "" }));
      } catch {
        // 忽略函数查询错误
      }
      return {
        tables: result.rows.filter((r) => r.table_type === "BASE TABLE").map((r) => r.table_name),
        views: result.rows.filter((r) => r.table_type === "VIEW").map((r) => r.table_name),
        functions,
      };
    }

    case "postgres/columns": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length,
         numeric_precision, numeric_scale, identity_generation
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table]
      );
      return { columns: result.rows };
    }

    case "postgres/indexes": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT
           i.relname AS index_name,
           am.amname AS index_type,
           ix.indisunique AS is_unique,
           ix.indisprimary AS is_primary,
           array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
         FROM pg_index ix
         JOIN pg_class c ON c.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(ix.indkey)
         WHERE n.nspname = $1 AND c.relname = $2
         GROUP BY i.relname, am.amname, ix.indisunique, ix.indisprimary
         ORDER BY i.relname`,
        [schema, table]
      );
      const toColsIdx = (v: any): string[] => {
        if (Array.isArray(v)) return v;
        if (v == null) return [];
        const s = String(v).trim();
        if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1).split(",").map((x) => x.trim());
        return [s];
      };
      return {
        indexes: result.rows.map((r: any) => ({
          ...r,
          columns: toColsIdx(r.columns),
        })),
      };
    }

    case "postgres/primary-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position`,
        [schema, table]
      );
      return { columns: result.rows.map((r: any) => r.column_name) };
    }

    case "postgres/unique-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT tc.constraint_name, tc.constraint_type,
         array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
         GROUP BY tc.constraint_name, tc.constraint_type`,
        [schema, table]
      );
      const toCols = (v: any): string[] => {
        if (Array.isArray(v)) return v;
        if (v == null) return [];
        const s = String(v).trim();
        if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1).split(",").map((x) => x.trim());
        return [s];
      };
      return {
        constraints: result.rows.map((r: any) => ({
          name: r.constraint_name,
          type: r.constraint_type,
          columns: toCols(r.columns),
        })),
      };
    }

    case "postgres/data-types": {
      const cid = getConnId();
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT t.typname AS name
         FROM pg_type t
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE n.nspname = 'pg_catalog'
           AND t.typtype IN ('b', 'e', 'p')
           AND t.typname !~ '^_'
         ORDER BY t.typname`
      );
      return { types: result.rows.map((r: { name: string }) => r.name) };
    }

    case "postgres/execute-ddl": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const session = getS(cid);
      try {
        sendSSEMessage(cid, { type: "QUERY", message: `执行 DDL: ${sql.slice(0, 80)}...`, timestamp: Date.now() });
        await session.backGroundPool.query(sql);
        sendSSEMessage(cid, { type: "INFO", message: "DDL 执行成功", timestamp: Date.now() });
        return { success: true };
      } catch (e: any) {
        sendSSEMessage(cid, { type: "ERROR", message: `DDL 错误: ${e.message}`, timestamp: Date.now(), detail: e.detail || e.hint });
        throw e;
      }
    }

    case "postgres/foreign-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const outgoingResult = await session.backGroundPool.query(
        `SELECT tc.constraint_name,
         kcu.column_name AS source_column,
         ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column,
         rc.delete_rule, rc.update_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      );
      const incomingResult = await session.backGroundPool.query(
        `SELECT tc.constraint_name, tc.table_schema AS source_schema, tc.table_name AS source_table,
         kcu.column_name AS source_column, ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_schema = $1 AND ccu.table_name = $2`,
        [schema, table]
      );
      return { outgoing: outgoingResult.rows, incoming: incomingResult.rows };
    }

    case "postgres/table-ddl": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const pool = session.backGroundPool;

      // 判断是表还是视图
      const tblRes = await pool.query(
        `SELECT table_type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
        [schema, table]
      );
      if (tblRes.rows.length === 0) throw new Error(`表或视图 ${schema}.${table} 不存在`);
      const isView = tblRes.rows[0].table_type === "VIEW";

      if (isView) {
        const defRes = await pool.query(
          `SELECT pg_get_viewdef($1::regclass, true) AS def`,
          [`"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`]
        );
        const def = defRes.rows[0]?.def ?? "";
        return { ddl: `CREATE OR REPLACE VIEW "${schema}"."${table}" AS\n${def}` };
      }

      // 表：获取列、约束、索引
      const colsRes = await pool.query(
        `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale,
         is_nullable, column_default, udt_name, identity_generation
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table]
      );
      const pkRes = await pool.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position`,
        [schema, table]
      );
      const pkCols = pkRes.rows.map((r: any) => r.column_name);
      const idxRes = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
        [schema, table]
      );
      const fkRes = await pool.query(
        `SELECT tc.constraint_name, kcu.column_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      );
      const checkRes = await pool.query(
        `SELECT cc.constraint_name, cc.check_clause FROM information_schema.check_constraints cc
         JOIN information_schema.constraint_table_usage ctu ON cc.constraint_name = ctu.constraint_name
         WHERE ctu.table_schema = $1 AND ctu.table_name = $2`,
        [schema, table]
      );

      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const colDefs = colsRes.rows.map((c: any) => {
        let type = c.udt_name || c.data_type;
        if (c.character_maximum_length) type += `(${c.character_maximum_length})`;
        else if (c.numeric_precision != null) type += `(${c.numeric_precision}${c.numeric_scale != null ? "," + c.numeric_scale : ""})`;
        let def = quote(c.column_name) + " " + type;
        if (c.is_nullable === "NO") def += " NOT NULL";
        if (c.column_default) def += " DEFAULT " + c.column_default;
        return def;
      });
      if (pkCols.length) {
        colDefs.push("  PRIMARY KEY (" + pkCols.map(quote).join(", ") + ")");
      }
      let ddl = `CREATE TABLE ${quote(schema)}.${quote(table)} (\n  ` + colDefs.join(",\n  ");
      const fkStmts = fkRes.rows.map((f: any) =>
        `ALTER TABLE ${quote(schema)}.${quote(table)} ADD CONSTRAINT ${quote(f.constraint_name)} FOREIGN KEY (${quote(f.column_name)}) REFERENCES ${quote(f.ref_schema)}.${quote(f.ref_table)}(${quote(f.ref_column)})`
      );
      const checkStmts = checkRes.rows.map((c: any) =>
        `ALTER TABLE ${quote(schema)}.${quote(table)} ADD CONSTRAINT ${quote(c.constraint_name)} CHECK (${c.check_clause})`
      );
      const idxStmts = idxRes.rows
        .filter((r: any) => !r.indexname.endsWith("_pkey"))
        .map((r: any) => r.indexdef);
      ddl += "\n);\n\n" + [...fkStmts, ...checkStmts, ...idxStmts].filter(Boolean).join(";\n\n") + (fkStmts.length || checkStmts.length || idxStmts.length ? ";" : "");
      return { ddl: ddl.trim() };
    }

    case "postgres/function-ddl": {
      const cid = getConnId();
      const { schema, function: funcName, oid } = payload as { connectionId: string; schema: string; function: string; oid?: number };
      const session = getS(cid);
      const pool = session.backGroundPool;

      let targetOid: number;
      if (oid != null) {
        targetOid = oid;
      } else {
        const lookupRes = await pool.query(
          `SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = $1 AND p.proname = $2 LIMIT 1`,
          [schema, funcName]
        );
        if (lookupRes.rows.length === 0) throw new Error(`函数 ${schema}.${funcName} 不存在`);
        targetOid = lookupRes.rows[0].oid;
      }

      const defRes = await pool.query(`SELECT pg_get_functiondef($1::oid) AS ddl`, [targetOid]);
      const ddl = defRes.rows[0]?.ddl ?? "";
      if (!ddl) throw new Error(`无法获取函数源码`);
      return { ddl };
    }

    case "postgres/schema-dump": {
      const cid = getConnId();
      const { schema, includeData = false } = payload as { connectionId: string; schema: string; includeData?: boolean };
      const session = getS(cid);
      const pool = session.backGroundPool;
      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

      sendSSEMessage(cid, { type: "QUERY", message: `导出 schema ${schema}${includeData ? "（含数据）" : ""}...`, timestamp: Date.now() });

      const tablesRes = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
        [schema]
      );
      const viewsRes = await pool.query(
        `SELECT viewname FROM pg_views WHERE schemaname = $1 ORDER BY viewname`,
        [schema]
      );
      const funcsRes = await pool.query(
        `SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = $1 ORDER BY p.proname`,
        [schema]
      );

      const fkRes = await pool.query(
        `SELECT tc.table_schema, tc.table_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
        [schema]
      );
      const fkMap = new Map<string, string[]>();
      for (const r of fkRes.rows as any[]) {
        if (r.ref_schema !== schema) continue;
        const key = `${r.table_schema}.${r.table_name}`;
        if (!fkMap.has(key)) fkMap.set(key, []);
        fkMap.get(key)!.push(`${r.ref_schema}.${r.ref_table}`);
      }
      const sortedTables: string[] = [];
      const visited = new Set<string>();
      const visit = (t: string) => {
        if (visited.has(t)) return;
        visited.add(t);
        for (const ref of fkMap.get(t) ?? []) {
          if (ref.startsWith(schema + ".")) visit(ref);
        }
        sortedTables.push(t.split(".")[1]);
      };
      for (const r of tablesRes.rows as any[]) {
        visit(`${schema}.${r.tablename}`);
      }

      const parts: string[] = [`-- Schema: ${schema}\n`, `CREATE SCHEMA IF NOT EXISTS ${quote(schema)};\n`];

      for (const t of sortedTables) {
        const { ddl } = await handleApiRequest("postgres/table-ddl", { connectionId: cid, schema, table: t } as any) as { ddl: string };
        parts.push("\n" + ddl + (ddl.trim().endsWith(";") ? "\n" : ";\n"));
        if (includeData) {
          const colsRes = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
            [schema, t]
          );
          const cols = (colsRes.rows as any[]).map((r) => r.column_name);
          if (cols.length) {
            const colList = cols.map(quote).join(", ");
            const dataRes = await pool.query({ text: `SELECT * FROM ${quote(schema)}.${quote(t)}`, rowMode: "array" });
            if (dataRes.rows.length > 0) {
              const escapeVal = (v: unknown): string => {
                if (v === null) return "NULL";
                if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
                if (typeof v === "number" && !Number.isNaN(v)) return String(v);
                const s = String(v);
                return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
              };
              const batchSize = 100;
              for (let i = 0; i < dataRes.rows.length; i += batchSize) {
                const batch = dataRes.rows.slice(i, i + batchSize);
                const values = batch.map((row) => "(" + row.map(escapeVal).join(", ") + ")").join(",\n  ");
                parts.push(`\nINSERT INTO ${quote(schema)}.${quote(t)} (${colList}) VALUES\n  ${values};\n`);
              }
            }
          }
        }
      }
      for (const r of viewsRes.rows as any[]) {
        const v = (r as any).viewname;
        const { ddl } = await handleApiRequest("postgres/table-ddl", { connectionId: cid, schema, table: v } as any) as { ddl: string };
        parts.push("\n" + ddl + (ddl.trim().endsWith(";") ? "\n" : ";\n"));
      }
      for (const r of funcsRes.rows as any[]) {
        const { ddl } = await handleApiRequest("postgres/function-ddl", { connectionId: cid, schema, function: (r as any).proname, oid: (r as any).oid } as any) as { ddl: string };
        parts.push("\n" + ddl + (ddl.trim().endsWith(";") ? "\n" : ";\n"));
      }

      sendSSEMessage(cid, { type: "INFO", message: `Schema ${schema} 导出完成`, timestamp: Date.now() });
      return { dump: parts.join("") };
    }

    case "postgres/database-dump": {
      const cid = getConnId();
      const { includeData = false } = payload as { connectionId: string; includeData?: boolean };
      const session = getS(cid);
      const pool = session.backGroundPool;

      sendSSEMessage(cid, { type: "QUERY", message: `导出全库${includeData ? "（含数据）" : ""}...`, timestamp: Date.now() });

      const schemasRes = await pool.query(
        `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema' ORDER BY nspname`
      );
      const parts: string[] = ["-- Database Dump\n"];
      for (const r of schemasRes.rows as any[]) {
        const s = r.nspname;
        const { dump } = await handleApiRequest("postgres/schema-dump", { connectionId: cid, schema: s, includeData } as any) as { dump: string };
        parts.push(dump);
      }
      sendSSEMessage(cid, { type: "INFO", message: "全库导出完成", timestamp: Date.now() });
      return { dump: parts.join("\n") };
    }

    case "postgres/query": {
      const cid = getConnId();
      const { query } = payload as { connectionId: string; query: string };
      const session = getS(cid);
      const client = session.userUsedClient;

      if ((client as any).processID) session.runningQueryPid = (client as any).processID;

      try {
        sendSSEMessage(cid, { type: "QUERY", message: `执行查询: ${query.slice(0, 100)}...`, timestamp: Date.now() });
        const result = await client.query({ text: query, rowMode: "array" });
        session.runningQueryPid = undefined;
        sendSSEMessage(cid, {
          type: "INFO",
          message: `${result.command || ""} 完成: ${result.rowCount ?? 0} 行`,
          timestamp: Date.now(),
        });
        const columnsInfo = await calculateColumnEditable(client, result.fields);
        return { result: result.rows, columns: columnsInfo };
      } catch (e: any) {
        session.runningQueryPid = undefined;
        sendSSEMessage(cid, { type: "ERROR", message: `查询错误: ${e.message}`, timestamp: Date.now(), detail: e.detail || e.hint });
        throw e;
      }
    }

    case "postgres/table-comment": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schema, table]
      );
      return { comment: result.rows[0]?.comment ?? null };
    }

    case "postgres/check-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS expression
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE con.contype = 'c'
           AND n.nspname = $1
           AND c.relname = $2
           AND con.conname NOT LIKE '%_not_null'`,
        [schema, table]
      );
      return { constraints: result.rows };
    }

    case "postgres/partition-info": {
      try {
        const cid = getConnId();
        const { schema, table } = payload as { connectionId: string; schema: string; table: string };
        const session = getS(cid);
        const pool = session.backGroundPool;

        const rel = await pool.query(
          `SELECT c.oid, c.relkind::text AS relkind FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relname = $2`,
          [schema, table]
        );
        if (rel.rows.length === 0) throw new Error(`关系不存在: ${schema}.${table}`);
        const oid = rel.rows[0].oid as number;
        const relkind = String(rel.rows[0].relkind);

        if (relkind === "p") {
          const pt = await pool.query(
            `SELECT CASE pt.partstrat
                WHEN 'r' THEN 'range'
                WHEN 'l' THEN 'list'
                WHEN 'h' THEN 'hash'
                ELSE pt.partstrat::text
              END AS strategy,
              pg_get_partkeydef(pt.partrelid) AS partition_key
             FROM pg_partitioned_table pt WHERE pt.partrelid = $1`,
            [oid]
          );
          const parts = await pool.query(
            `SELECT n.nspname AS schema, c.relname AS name,
                    pg_get_expr(c.relpartbound, c.oid) AS partition_bound
             FROM pg_inherits i
             JOIN pg_class c ON c.oid = i.inhrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE i.inhparent = $1
             ORDER BY n.nspname, c.relname`,
            [oid]
          );
          return {
            role: "parent",
            strategy: pt.rows[0]?.strategy ?? null,
            partitionKey: pt.rows[0]?.partition_key ?? null,
            partitions: parts.rows.map((r: { schema: string; name: string; partition_bound: string | null }) => ({
              schema: r.schema,
              name: r.name,
              qualified: `${r.schema}.${r.name}`,
              bound: r.partition_bound || "",
            })),
          };
        }

        const inh = await pool.query(
          `SELECT i.inhparent, n.nspname AS parent_schema, p.relname AS parent_name
           FROM pg_inherits i
           JOIN pg_class p ON p.oid = i.inhparent
           JOIN pg_namespace n ON n.oid = p.relnamespace
           WHERE i.inhrelid = $1
           LIMIT 1`,
          [oid]
        );
        if (inh.rows.length > 0) {
          const r = inh.rows[0] as { inhparent: number; parent_schema: string; parent_name: string };
          const boundRes = await pool.query(
            `SELECT pg_get_expr(c.relpartbound, c.oid) AS partition_bound FROM pg_class c WHERE c.oid = $1`,
            [oid]
          );
          const pp = await pool.query(
            `SELECT CASE pt.partstrat
                WHEN 'r' THEN 'range'
                WHEN 'l' THEN 'list'
                WHEN 'h' THEN 'hash'
                ELSE pt.partstrat::text
              END AS strategy,
              pg_get_partkeydef(pt.partrelid) AS partition_key
             FROM pg_partitioned_table pt WHERE pt.partrelid = $1`,
            [r.inhparent]
          );
          return {
            role: "partition",
            parentQualified: `${r.parent_schema}.${r.parent_name}`,
            parentSchema: r.parent_schema,
            parentName: r.parent_name,
            thisBound: boundRes.rows[0]?.partition_bound ?? "",
            strategy: pp.rows[0]?.strategy ?? null,
            partitionKey: pp.rows[0]?.partition_key ?? null,
          };
        }

        return { role: "none" };
      } catch (e: any) {
        throw new Error(`partition-info: ${e?.message ?? String(e)}`);
      }
    }

    case "postgres/explain-text": {
      try {
        const cid = getConnId();
        const { query } = payload as { connectionId: string; query: string };
        const session = getS(cid);
        const q = query.trim();
        if (!q) throw new Error("SQL 为空");
        const explainSql = `EXPLAIN (VERBOSE, COSTS ON, FORMAT TEXT) ${q}`;
        const result = await session.backGroundPool.query(explainSql);
        const lines: string[] = result.rows.map((row) => {
          const v =
            (row as Record<string, unknown>)["QUERY PLAN"] ??
            (row as Record<string, unknown>)["query_plan"] ??
            Object.values(row)[0];
          return typeof v === "string" ? v : String(v ?? "");
        });
        return { lines };
      } catch (e: any) {
        throw new Error(`explain-text: ${e?.message ?? String(e)}`);
      }
    }

    case "postgres/pg-stat-overview": {
      try {
        const cid = getConnId();
        const { limit = 20 } = payload as { connectionId: string; limit?: number };
        const lim = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 5), 200) : 20;
        const session = getS(cid);
        const client = await session.backGroundPool.connect();
        try {
          // 监控查询必须“快失败”，避免 UI 卡住；不用事务，避免某一步失败后进入 aborted 状态
          await client.query("SET statement_timeout = '2500ms'");
          await client.query("SET lock_timeout = '800ms'");

          const connRes = await client.query(
            `SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE state = 'active')::int AS active,
               COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
               COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting
             FROM pg_stat_activity
             WHERE datname = current_database()`
          );

          const lockRes = await client.query(
            `SELECT
               a.pid AS waiting_pid,
               a.usename AS waiting_user,
               LEFT(COALESCE(a.query, ''), 240) AS waiting_query,
               b.pid AS blocking_pid,
               b.usename AS blocking_user,
               LEFT(COALESCE(b.query, ''), 240) AS blocking_query,
               a.wait_event_type,
               a.wait_event
             FROM pg_stat_activity a
             JOIN pg_locks la ON la.pid = a.pid AND NOT la.granted
             JOIN pg_locks lb ON lb.locktype = la.locktype
                            AND (lb.database = la.database OR (lb.database IS NULL AND la.database IS NULL))
                            AND (lb.relation = la.relation OR (lb.relation IS NULL AND la.relation IS NULL))
                            AND (lb.page = la.page OR (lb.page IS NULL AND la.page IS NULL))
                            AND (lb.tuple = la.tuple OR (lb.tuple IS NULL AND la.tuple IS NULL))
                            AND (lb.virtualxid = la.virtualxid OR (lb.virtualxid IS NULL AND la.virtualxid IS NULL))
                            AND (lb.transactionid = la.transactionid OR (lb.transactionid IS NULL AND la.transactionid IS NULL))
                            AND (lb.classid = la.classid OR (lb.classid IS NULL AND la.classid IS NULL))
                            AND (lb.objid = la.objid OR (lb.objid IS NULL AND la.objid IS NULL))
                            AND (lb.objsubid = la.objsubid OR (lb.objsubid IS NULL AND la.objsubid IS NULL))
                             AND lb.pid <> la.pid
             JOIN pg_stat_activity b ON b.pid = lb.pid
             WHERE a.datname = current_database()
             ORDER BY a.query_start NULLS LAST
             LIMIT $1`,
            [lim]
          );

          let slowQueries: Array<Record<string, unknown>> = [];
          let slowQuerySource: "pg_stat_statements" | "pg_stat_activity" = "pg_stat_statements";
          try {
            const slowRes = await client.query(
              `SELECT
                 LEFT(query, 240) AS query,
                 calls,
                 ROUND(total_exec_time::numeric, 3)::float8 AS total_exec_time,
                 ROUND(mean_exec_time::numeric, 3)::float8 AS mean_exec_time,
                 rows::bigint AS rows
               FROM pg_stat_statements
               WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
               ORDER BY total_exec_time DESC
               LIMIT $1`,
              [lim]
            );
            slowQueries = slowRes.rows as Array<Record<string, unknown>>;
          } catch {
            slowQuerySource = "pg_stat_activity";
            const fallbackRes = await client.query(
              `SELECT
                 LEFT(COALESCE(query, ''), 240) AS query,
                 EXTRACT(EPOCH FROM (now() - query_start)) * 1000 AS total_exec_time,
                 state,
                 wait_event_type,
                 wait_event
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND state = 'active'
                 AND query IS NOT NULL
               ORDER BY query_start ASC NULLS LAST
               LIMIT $1`,
              [lim]
            );
            slowQueries = fallbackRes.rows as Array<Record<string, unknown>>;
          }

          return {
            connectionStats: connRes.rows[0] ?? { total: 0, active: 0, idle: 0, waiting: 0 },
            lockWaits: lockRes.rows,
            slowQueries,
            slowQuerySource,
            collectedAt: Date.now(),
          };
        } catch (e) {
          throw e;
        } finally {
          try { await client.query("RESET statement_timeout"); } catch {}
          try { await client.query("RESET lock_timeout"); } catch {}
          client.release();
        }
      } catch (e: any) {
        throw new Error(`pg-stat-overview: ${e?.message ?? String(e)}`);
      }
    }

    case "postgres/installed-extensions": {
      try {
        const cid = getConnId();
        const session = getS(cid);
        const result = await session.backGroundPool.query(
          `SELECT
             e.extname AS name,
             e.extversion AS installed_version,
             n.nspname AS schema,
             e.extrelocatable AS relocatable,
             ae.default_version AS default_version,
             COALESCE(pg_catalog.obj_description(e.oid, 'pg_extension'), ae.comment) AS description
           FROM pg_extension e
           JOIN pg_namespace n ON n.oid = e.extnamespace
           LEFT JOIN pg_catalog.pg_available_extensions ae ON ae.name = e.extname
           ORDER BY e.extname`
        );
        const extensions = (result.rows as Array<Record<string, unknown>>).map((row) => ({
          name: String(row.name ?? ""),
          installedVersion: String(row.installed_version ?? ""),
          schema: String(row.schema ?? ""),
          relocatable: Boolean(row.relocatable),
          defaultVersion: row.default_version != null ? String(row.default_version) : null,
          description: row.description != null ? String(row.description) : null,
        }));
        return { extensions };
      } catch (e: any) {
        throw new Error(`installed-extensions: ${e?.message ?? String(e)}`);
      }
    }

    case "postgres/manage-backend": {
      try {
        const cid = getConnId();
        const { pid, action } = payload as { connectionId: string; pid: number; action: "cancel" | "terminate" };
        if (!Number.isInteger(pid) || pid <= 0) throw new Error("pid 非法");
        const session = getS(cid);
        const self = await session.backGroundPool.query("SELECT pg_backend_pid() AS self_pid");
        const selfPid = Number(self.rows[0]?.self_pid ?? 0);
        if (pid === selfPid) {
          throw new Error("不允许操作当前监控会话自身 pid");
        }
        const fn = action === "terminate" ? "pg_terminate_backend" : "pg_cancel_backend";
        const rs = await session.backGroundPool.query(
          `SELECT ${fn}($1) AS ok`,
          [pid]
        );
        const ok = !!rs.rows[0]?.ok;
        return { success: ok, pid, action };
      } catch (e: any) {
        throw new Error(`manage-backend: ${e?.message ?? String(e)}`);
      }
    }

    default:
      throw new Error(`未知 API 方法: ${method}`);
  }
}
