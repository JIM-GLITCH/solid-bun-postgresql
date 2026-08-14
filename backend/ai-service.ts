/** 与前端「接口格式」一致：openai-compatible → /v1/chat/completions；anthropic → Anthropic messages */
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

