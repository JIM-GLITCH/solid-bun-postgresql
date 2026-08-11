/** 与前端「接口格式」一致：openai-compatible → /v1/chat/completions；anthropic → Anthropic messages */
import { getAiKey as getAiKeyFromStore, setAiKey as setAiKeyToStore, deleteAiKey as deleteAiKeyFromStore } from "./ai-key-store";
import { getSession } from "./session-connection";
import type { DbKind } from "../shared/src";
import type { Pool as PgPool } from "pg";
import type { Pool as MysqlPool } from "mysql2/promise";
import { buildSqlServerSchemaContext } from "./drivers/sqlserver-driver";

export type AiApiMode = "openai-compatible" | "anthropic";

export interface AiServiceConfig {
  apiMode: AiApiMode;
  baseUrl?: string;
  model: string;
  apiKey: string;
  temperature?: number;
  topP?: number;
  stream?: boolean;
  maxTokens?: number;
}

export interface AiServiceRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface AiServiceResponse {
  sql: string;
  rationale: string;
  warnings: string[];
  alternatives?: string[];
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  elapsedMs?: number;
}

function clampTemperature(v: number | undefined): number {
  if (v == null || Number.isNaN(v)) return 0.2;
  return Math.max(0, Math.min(1, v));
}

function clampTopP(v: number | undefined): number | undefined {
  if (v == null || Number.isNaN(v)) return undefined;
  return Math.max(0, Math.min(1, v));
}

function clampMaxTokens(v: number | undefined): number {
  if (v == null || Number.isNaN(v)) return 700;
  return Math.max(64, Math.min(8192, Math.round(v)));
}

async function readOpenAICompatStream(response: Response): Promise<ProviderCallResult> {
  if (!response.body) {
    throw new Error("流式响应体为空");
  }
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = "";
  let content = "";
  let streamDone = false;
  let usage: ProviderCallResult["usage"];

  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload) return;
    if (payload === "[DONE]") {
      streamDone = true;
      return;
    }
    try {
      const chunk = JSON.parse(payload) as any;
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") content += delta;
      const u = chunk?.usage;
      if (u && typeof u === "object") {
        const inputTokens = Number(u.prompt_tokens ?? u.input_tokens ?? 0) || undefined;
        const outputTokens = Number(u.completion_tokens ?? u.output_tokens ?? 0) || undefined;
        const totalTokens = Number(u.total_tokens ?? 0) || (inputTokens || 0) + (outputTokens || 0) || undefined;
        usage = { inputTokens, outputTokens, totalTokens };
      }
      const finishReason = chunk?.choices?.[0]?.finish_reason;
      if (finishReason) streamDone = true;
    } catch {
      // ignore keepalive and non-json chunks
    }
  };

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      consumeLine(line);
      idx = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!content.trim()) throw new Error("流式响应未返回有效文本内容");
  return { content, usage };
}

interface ProviderCallResult {
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

function safeArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter(Boolean).slice(0, 8);
}

function extractJson(text: string): Record<string, unknown> {
  const cleanModelText = (s: string): string => {
    return s
      .replace(/\\boxed\{([\s\S]*?)\}/g, "$1")
      .replace(/\\text\{([\s\S]*?)\}/g, "$1")
      .replace(/^Here is the final JSON:\s*/i, "")
      .trim();
  };

  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      return JSON.parse(s) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  text = cleanModelText(text);

  const normalizeLooseJson = (raw: string): string => {
    let s = raw.trim();
    // strip markdown fences
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    // quote bare keys: {sql: "..."} => {"sql":"..."}
    s = s.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)(\s*:)/g, '$1"$2"$3');
    // single quote strings => double quote strings
    s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_m, inner) => `"${String(inner).replace(/"/g, '\\"')}"`);
    return s;
  };

  const extractByRegexFallback = (rawText: string): Record<string, unknown> | null => {
    const raw = rawText.trim();
    const sqlMatch = raw.match(/"\s*sql\s*"\s*:\s*"([\s\S]*?)"/i);
    if (!sqlMatch) return null;
    const rationaleMatch = raw.match(/"\s*(rationale|rational|reason|explanation)\s*"\s*:\s*"([\s\S]*?)"/i);
    const unescape = (s: string) =>
      s
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r")
        .replace(/\\t/g, "\t")
        .replace(/\\"/g, "\"")
        .replace(/\\\\/g, "\\");
    return {
      sql: unescape(sqlMatch[1]).trim(),
      rationale: rationaleMatch ? unescape(rationaleMatch[2]).trim() : "根据当前上下文生成。",
      warnings: [],
      alternatives: [],
    };
  };

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) {
      const byRegex = extractByRegexFallback(text);
      if (byRegex) return byRegex;
      throw new Error("AI 返回内容不是 JSON");
    }
    const direct = tryParse(m[0]);
    if (direct) return direct;
    const normalized = normalizeLooseJson(m[0]);
    const recovered = tryParse(normalized);
    if (recovered) return recovered;
    const byRegex = extractByRegexFallback(m[0]);
    if (byRegex) return byRegex;
    throw new Error(`AI 返回 JSON 解析失败，原始返回：${text}`);
  }
}

function validateAndNormalize(raw: Record<string, unknown>): AiServiceResponse {
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (k in raw) return (raw as any)[k];
    }
    return undefined;
  };
  let sql = String(pick("sql", " sql", "SQL", " Sql") ?? "").trim();
  sql = sql.replace(/^["'`]+|["'`]+$/g, "").trim();
  if (/^\d+\s*[\+\-\*\/]\s*\d+$/.test(sql)) {
    throw new Error(`AI 返回内容疑似非 SQL：${sql}`);
  }
  if (!sql) throw new Error("AI 未返回 SQL");
  return {
    sql,
    rationale: String(pick("rationale", " rational", "reason", "explanation") ?? "根据当前上下文生成。"),
    warnings: safeArray(pick("warnings", " warnings", "warning")),
    alternatives: safeArray(pick("alternatives", " alternatives", "alternative")),
  };
}

function detectSqlRisks(sql: string): string[] {
  const s = sql.toLowerCase();
  const risks: string[] = [];
  if (/\bdrop\s+table\b/.test(s) || /\btruncate\s+table\b/.test(s)) {
    risks.push("包含高风险 DDL（DROP/TRUNCATE），请先确认再执行。");
  }
  if (/\bdelete\s+from\b/.test(s) && !/\bwhere\b/.test(s)) {
    risks.push("DELETE 未包含 WHERE 条件。");
  }
  if (/\bupdate\b/.test(s) && !/\bwhere\b/.test(s)) {
    risks.push("UPDATE 未包含 WHERE 条件。");
  }
  return risks;
}

/** OpenAI /v1/chat/completions 或同类兼容接口的完整 POST URL（尊重用户配置的 baseUrl）。 */
function resolveOpenAiCompatibleChatCompletionsUrl(baseUrl: string | undefined, fallbackBase: string): string {
  const fb = fallbackBase.replace(/\/+$/, "");
  const defaultFull = `${fb}/chat/completions`;
  const raw = baseUrl?.trim();
  if (!raw) return defaultFull;
  const b = raw.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(b)) return b;
  return `${b}/chat/completions`;
}

/** Anthropic /v1/messages 的完整 POST URL（尊重 baseUrl：官方、代理、区域端点）。 */
function resolveAnthropicMessagesUrl(baseUrl?: string): string {
  const fallback = "https://api.anthropic.com/v1/messages";
  const raw = baseUrl?.trim();
  if (!raw) return fallback;
  const b = raw.replace(/\/+$/, "");
  if (/\/messages$/i.test(b)) return b;
  if (b.endsWith("/v1")) return `${b}/messages`;
  return `${b}/v1/messages`;
}

/** OpenAI /v1/chat/completions 兼容网关（凡填写 baseUrl 即直连该地址，无则回退 OpenAI 官方根路径） */
async function callOpenAiCompatible(config: AiServiceConfig, req: AiServiceRequest): Promise<ProviderCallResult> {
  const fallbackBase = "https://api.openai.com/v1";
  const url = resolveOpenAiCompatibleChatCompletionsUrl(config.baseUrl, fallbackBase);
  const useStream = !!config.stream;
  const topP = clampTopP(config.topP);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: clampTemperature(config.temperature),
      top_p: topP,
      stream: useStream,
      stream_options: useStream ? { include_usage: true } : undefined,
      max_tokens: clampMaxTokens(config.maxTokens),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: req.systemPrompt },
        {
          role: "user",
          content: req.userPrompt,
        },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI 兼容接口请求失败: ${response.status} ${text}`);
  }
  if (useStream) {
    return await readOpenAICompatStream(response);
  }
  const json = (await response.json()) as any;
  const usage = json?.usage
    ? {
        inputTokens: Number(json.usage.prompt_tokens ?? 0) || undefined,
        outputTokens: Number(json.usage.completion_tokens ?? 0) || undefined,
        totalTokens: Number(json.usage.total_tokens ?? 0) || undefined,
      }
    : undefined;
  return { content: String(json?.choices?.[0]?.message?.content ?? ""), usage };
}

async function callAnthropic(config: AiServiceConfig, req: AiServiceRequest): Promise<ProviderCallResult> {
  const url = resolveAnthropicMessagesUrl(config.baseUrl);
  const topP = clampTopP(config.topP);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: clampMaxTokens(config.maxTokens),
      temperature: clampTemperature(config.temperature),
      top_p: topP,
      system: req.systemPrompt,
      messages: [
        {
          role: "user",
          content: req.userPrompt,
        },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Anthropic 请求失败: ${response.status} ${text}`);
  }
  const json = (await response.json()) as any;
  const first = json?.content?.[0];
  const usage = json?.usage
    ? {
        inputTokens: Number(json.usage.input_tokens ?? 0) || undefined,
        outputTokens: Number(json.usage.output_tokens ?? 0) || undefined,
        totalTokens:
          (Number(json.usage.input_tokens ?? 0) || 0) + (Number(json.usage.output_tokens ?? 0) || 0) || undefined,
      }
    : undefined;
  return { content: String(first?.text ?? ""), usage };
}

export async function runAiSqlTask(config: AiServiceConfig, req: AiServiceRequest): Promise<AiServiceResponse> {
  if (!config.apiKey?.trim()) throw new Error("缺少 AI API Key");
  // Avoid low-level ByteString errors from fetch headers (e.g. key contains Chinese/full-width chars)
  if (!/^[\x00-\xFF]+$/.test(config.apiKey)) {
    throw new Error("AI API Key 包含非英文字符，请重新粘贴原始 Key（不要包含中文、全角符号或换行）");
  }
  if (/[\r\n]/.test(config.apiKey)) {
    throw new Error("AI API Key 包含换行符，请去掉首尾空白后重试");
  }
  const call = () =>
    config.apiMode === "anthropic" ? callAnthropic(config, req) : callOpenAiCompatible(config, req);
  let callResult: ProviderCallResult = { content: "" };
  const startedAt = Date.now();
  try {
    callResult = await call();
  } catch (e) {
    // one retry with deterministic decoding for flaky providers
    callResult = await (
      config.apiMode === "anthropic"
        ? callAnthropic({ ...config, temperature: 0 }, req)
        : callOpenAiCompatible({ ...config, temperature: 0 }, req)
    );
  }
  const elapsedMs = Date.now() - startedAt;
  const normalized = validateAndNormalize(extractJson(callResult.content));
  const risks = detectSqlRisks(normalized.sql);
  return {
    ...normalized,
    warnings: Array.from(new Set([...(normalized.warnings || []), ...risks])),
    usage: callResult.usage,
    elapsedMs,
  };
}

// ─── AI 配置 / Key 管理 / Prompt 构建 / Handler ─────────────────────────────

const aiKeyStore = new Map<string, string>();

let aiKeyResolver: ((keyRef: string) => Promise<string | undefined>) | null = null;

export function setAiKeyResolver(resolver: ((keyRef: string) => Promise<string | undefined>) | null): void {
  aiKeyResolver = resolver;
}

interface AiRuntimeConfig {
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

async function buildPostgresSchemaContext(pool: PgPool, schema?: string): Promise<{ context: string; injected: string[] }> {
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

async function buildAiSchemaContext(session: { dbKind: DbKind; backGroundPool: any }, schema?: string): Promise<{ context: string; injected: string[] }> {
  switch (session.dbKind) {
    case "postgres":
      return buildPostgresSchemaContext(session.backGroundPool as PgPool, schema);
    case "mysql":
    case "mariadb":
      return buildMysqlSchemaContext(session.backGroundPool as MysqlPool, schema);
    case "sqlserver":
      return buildSqlServerSchemaContext(session.backGroundPool, schema);
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
    "1) 仅输出 SQL，不要代码块，所有解释要以sql注释形式给出。",
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
    "只输出一个 JSON，不要代码，不要解释：",
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
  session: { dbKind: DbKind; backGroundPool: any },
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
  session: { dbKind: DbKind; backGroundPool: any };
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

export async function handleAiConfigGet(): Promise<unknown> {
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

export async function handleAiConfigSet(payload: unknown): Promise<{ success: boolean }> {
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
    setAiKeyToStore(aiConfig.keyRef, trimmed);
  }
  return { success: true };
}

export async function handleAiKeyDelete(payload: unknown): Promise<{ success: boolean }> {
  const { keyRef = aiConfig.keyRef } = payload as { keyRef?: string };
  const ref = keyRef.trim() || "default";
  aiKeyStore.delete(ref);
  deleteAiKeyFromStore(ref);
  return { success: true };
}

export async function handleAiTestConnection(payload: unknown): Promise<{ success: boolean }> {
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

export async function handleAiSqlEdit(payload: unknown): Promise<unknown> {
  const req = normalizeAiSqlRequest(payload, aiConfig.keyRef);
  if (!req.connectionId) throw new Error("缺少 connectionId");
  if (!req.sql.trim()) throw new Error("sql 不能为空");
  const session = getSession(req.connectionId);
  if (!session) throw new Error("未找到数据库连接，请先连接数据库");
  return executeAiSqlEdit({
    session,
    sql: req.sql,
    keyRef: req.keyRef,
    schema: req.schema,
    instruction: req.instructions || "补全",
  });
}

export async function handleAiPromptBuild(payload: unknown): Promise<unknown> {
  const req = normalizeAiSqlRequest(payload, aiConfig.keyRef);
  if (!req.connectionId) throw new Error("缺少 connectionId");
  if (!req.sql.trim()) throw new Error("sql 不能为空");
  const session = getSession(req.connectionId);
  if (!session) throw new Error("未找到数据库连接，请先连接数据库");
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

export async function handleAiPromptBuildDiff(payload: unknown): Promise<unknown> {
  const { connectionId: promptDiffConnId, sql, schema } = payload as {
    connectionId: string;
    sql: string;
    schema?: string;
  };
  if (!sql?.trim()) throw new Error("sql 不能为空");
  const session = getSession(promptDiffConnId);
  if (!session) throw new Error("未找到数据库连接，请先连接数据库");
  const schemaMeta = await buildAiSchemaContext(session, schema);
  return {
    prompt: buildDiffSqlPrompt({ sql, schemaContext: schemaMeta.context, dialect: session.dbKind }),
    schemaInjected: schemaMeta.injected,
  };
}
