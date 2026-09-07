import { Effect, Layer, Ref } from "effect"
import { AiService, type AiConfigState, type AiSqlEditParams, type AiSqlEditResult } from "./AiService"
import type { AiKeyStoreService as AiKeyStoreServiceShape } from "./AiKeyStoreService"
import { AiKeyStoreService } from "./AiKeyStoreService"
import { AiServiceError, makeErrorContext } from "../core/errors"
import { runAiSqlTask, type AiServiceConfig, type AiServiceRequest } from "../ai-service"

const clampTemperature = (v: number | undefined): number => {
  if (v == null || Number.isNaN(v)) return 0.2
  return Math.max(0, Math.min(1, v))
}
const clampTopP = (v: number | undefined): number | undefined => {
  if (v == null || Number.isNaN(v)) return undefined
  return Math.max(0, Math.min(1, v))
}
const clampMaxTokens = (v: number | undefined): number => {
  if (v == null || Number.isNaN(v)) return 700
  return Math.max(64, Math.min(8192, Math.round(v)))
}

const DEFAULT_CONFIG: Required<Pick<AiConfigState, "apiMode" | "model" | "keyRef" | "temperature" | "stream" | "maxTokens">> = {
  apiMode: "openai-compatible",
  model: "qwen-plus",
  keyRef: "default",
  temperature: 0.2,
  stream: false,
  maxTokens: 700,
}

function detectSqlRisks(sql: string): string[] {
  const s = sql.toLowerCase()
  const risks: string[] = []
  if (/\bdrop\s+table\b/.test(s) || /\btruncate\s+table\b/.test(s)) {
    risks.push("包含高风险 DDL（DROP/TRUNCATE），请先确认再执行。")
  }
  if (/\bdelete\s+from\b/.test(s) && !/\bwhere\b/.test(s)) {
    risks.push("DELETE 未包含 WHERE 条件。")
  }
  if (/\bupdate\b/.test(s) && !/\bwhere\b/.test(s)) {
    risks.push("UPDATE 未包含 WHERE 条件。")
  }
  return risks
}

const makeAiError = (operation: string, cfg?: { apiMode?: string; model?: string }): AiServiceError =>
  new AiServiceError({
    context: makeErrorContext(operation),
    apiMode: cfg?.apiMode ?? "openai-compatible",
    model: cfg?.model ?? "unknown",
    retryable: false,
  })

class AiServiceImpl implements AiService {
  private readonly configRef: Ref.Ref<AiConfigState>
  private readonly keyStore: AiKeyStoreServiceShape

  constructor(keyStore: AiKeyStoreServiceShape, initial?: Partial<AiConfigState>) {
    this.keyStore = keyStore
    const initConfig: AiConfigState = {
      apiMode: initial?.apiMode ?? DEFAULT_CONFIG.apiMode,
      baseUrl: initial?.baseUrl,
      model: initial?.model ?? DEFAULT_CONFIG.model,
      keyRef: initial?.keyRef ?? DEFAULT_CONFIG.keyRef,
      temperature: clampTemperature(initial?.temperature ?? DEFAULT_CONFIG.temperature),
      topP: clampTopP(initial?.topP),
      stream: typeof initial?.stream === "boolean" ? initial.stream : DEFAULT_CONFIG.stream,
      maxTokens: clampMaxTokens(initial?.maxTokens ?? DEFAULT_CONFIG.maxTokens),
    }
    this.configRef = Effect.runSync(Ref.make(initConfig))
  }

  getConfig = (): Effect.Effect<AiConfigState & { hasKey: boolean }, AiServiceError> => {
    const self = this
    return Effect.gen(function* () {
      const config = yield* Ref.get(self.configRef)
      const key = yield* self.keyStore.get(config.keyRef).pipe(
        Effect.catch(() => Effect.succeed(null as string | null))
      )
      return { ...config, hasKey: !!key }
    })
  }

  setConfig = (config: Partial<AiConfigState> & { apiKey?: string }): Effect.Effect<void, AiServiceError> => {
    const self = this
    return Effect.gen(function* () {
      const current = yield* Ref.get(self.configRef)
      const baseUrl = config.baseUrl !== undefined ? (config.baseUrl.trim() || undefined) : current.baseUrl
      const model = typeof config.model === "string" && config.model.trim() ? config.model.trim() : current.model
      const keyRef = typeof config.keyRef === "string" && config.keyRef.trim() ? config.keyRef.trim() : current.keyRef
      const merged: AiConfigState = {
        apiMode: config.apiMode ?? current.apiMode,
        baseUrl,
        model,
        keyRef,
        temperature: clampTemperature(config.temperature ?? current.temperature),
        topP: clampTopP(config.topP !== undefined ? config.topP : current.topP),
        stream: typeof config.stream === "boolean" ? config.stream : current.stream,
        maxTokens: clampMaxTokens(config.maxTokens ?? current.maxTokens),
      }
      yield* Ref.set(self.configRef, merged)
      if (typeof config.apiKey === "string" && config.apiKey.trim()) {
        yield* self.keyStore.set(keyRef, config.apiKey.trim()).pipe(
          Effect.mapError(() => makeAiError("setConfig", { apiMode: merged.apiMode, model: merged.model }))
        )
      }
    })
  }

  deleteKey = (keyRefIn?: string): Effect.Effect<void, AiServiceError> => {
    const self = this
    return Effect.gen(function* () {
      const config = yield* Ref.get(self.configRef)
      const ref = keyRefIn && keyRefIn.trim() ? keyRefIn.trim() : config.keyRef
      yield* self.keyStore.delete(ref).pipe(
        Effect.mapError(() => makeAiError("deleteKey", { apiMode: config.apiMode, model: config.model }))
      )
    })
  }

  testConnection = (override?: Partial<AiConfigState>): Effect.Effect<boolean, AiServiceError> => {
    const self = this
    return Effect.gen(function* () {
      const current = yield* Ref.get(self.configRef)
      const mode = override?.apiMode ?? current.apiMode
      const baseUrl = override?.baseUrl !== undefined ? override.baseUrl : current.baseUrl
      const model = override?.model ?? current.model
      const temp = clampTemperature(override?.temperature ?? current.temperature)
      const topP = clampTopP(override?.topP !== undefined ? override.topP : current.topP)
      const stream = typeof override?.stream === "boolean" ? override.stream : current.stream
      const maxTokens = clampMaxTokens(override?.maxTokens ?? current.maxTokens)
      const keyRef = override?.keyRef && override.keyRef.trim() ? override.keyRef.trim() : current.keyRef

      const apiKey = yield* self.keyStore.get(keyRef).pipe(
        Effect.catch(() => Effect.succeed(null as string | null))
      )
      if (!apiKey) {
        return yield* Effect.fail(makeAiError("testConnection", { apiMode: mode, model }))
      }
      const cfg: AiServiceConfig = {
        apiMode: mode,
        baseUrl,
        model,
        apiKey,
        temperature: temp,
        topP,
        stream,
        maxTokens,
      }
      const req: AiServiceRequest = {
        systemPrompt: "你是数据库助手。请返回 JSON：{sql, rationale, warnings, alternatives}",
        userPrompt: "Ping：请用 JSON 返回 {\"sql\":\"SELECT 1 AS ping\",\"rationale\":\"联通性测试\",\"warnings\":[],\"alternatives\":[]}",
      }
      const res = yield* Effect.tryPromise({
        try: () => runAiSqlTask(cfg, req),
        catch: () => makeAiError("testConnection", { apiMode: mode, model }),
      })
      return typeof res.sql === "string" && res.sql.trim().length > 0
    })
  }

  validateConfig = (override?: Partial<AiConfigState>): Effect.Effect<boolean, AiServiceError> => {
    const self = this
    return Effect.gen(function* () {
      const current = yield* Ref.get(self.configRef)
      const keyRef = override?.keyRef && override.keyRef.trim() ? override.keyRef.trim() : current.keyRef
      if (!keyRef) return yield* Effect.succeed(false)
      const k = yield* self.keyStore.get(keyRef).pipe(
        Effect.catch(() => Effect.succeed(null as string | null))
      )
      return !!k
    })
  }

  executeSqlEdit = (params: AiSqlEditParams): Effect.Effect<AiSqlEditResult, AiServiceError> => {
    const self = this
    return Effect.gen(function* () {
      const config = yield* Ref.get(self.configRef)
      const keyRef = params.keyRef && params.keyRef.trim() ? params.keyRef.trim() : config.keyRef
      const apiKey = yield* self.keyStore.get(keyRef).pipe(
        Effect.catch(() => Effect.succeed(null as string | null))
      )
      if (!apiKey) {
        return yield* Effect.fail(makeAiError("executeSqlEdit", { apiMode: config.apiMode, model: config.model }))
      }

      const schemaInjected: string[] = []

      const systemPrompt =
        "你是数据库 SQL 助手。要求：\n" +
        "1) 必须以严格 JSON 格式返回，结构为：{\"sql\": string, \"rationale\": string, \"warnings\": string[], \"alternatives\": string[]}\n" +
        "2) 只输出 SQL 修改结果本身，不要解释或额外文本；除 JSON 外不要任何其它内容\n" +
        "3) 高风险语句（DROP/TRUNCATE、无 WHERE 的 DELETE/UPDATE）请在 warnings 中提示\n" +
        `4) 方言：${params.dialect ?? "standard SQL"}` +
        (params.tableSchema ? `\n5) 参考表结构：\n${params.tableSchema}` : "")

      const userPrompt =
        (params.instruction ? `编辑意图：${params.instruction}\n` : "") +
        (params.schema ? `当前 schema：${params.schema}\n` : "") +
        `当前 SQL：\n\`\`\`sql\n${params.sql}\n\`\`\`\n` +
        "请直接返回最终 SQL 对应的 JSON。"

      const cfg: AiServiceConfig = {
        apiMode: config.apiMode,
        baseUrl: config.baseUrl,
        model: config.model,
        apiKey,
        temperature: config.temperature,
        topP: config.topP,
        stream: config.stream,
        maxTokens: config.maxTokens,
      }
      const startedAt = Date.now()
      const raw = yield* Effect.tryPromise({
        try: () => runAiSqlTask(cfg, { systemPrompt, userPrompt }),
        catch: () => makeAiError("executeSqlEdit", { apiMode: config.apiMode, model: config.model }),
      })
      const warnings = Array.from(new Set([...(raw.warnings || []), ...detectSqlRisks(raw.sql)]))
      return {
        sql: raw.sql,
        rationale: raw.rationale,
        warnings,
        alternatives: raw.alternatives || [],
        usage: raw.usage,
        elapsedMs: raw.elapsedMs ?? Date.now() - startedAt,
        schemaInjected,
      } satisfies AiSqlEditResult
    })
  }

  buildPrompt = (params: AiSqlEditParams): Effect.Effect<{ prompt: string; schemaInjected: string[] }, AiServiceError> =>
    Effect.gen(function* () {
      const schemaInjected: string[] = []
      const systemPrompt =
        "你是数据库 SQL 助手。要求：\n" +
        "1) 必须以严格 JSON 格式返回，结构为：{\"sql\": string, \"rationale\": string, \"warnings\": string[], \"alternatives\": string[]}\n" +
        "2) 只输出 SQL 修改结果本身，不要解释或额外文本；除 JSON 外不要任何其它内容\n" +
        "3) 高风险语句（DROP/TRUNCATE、无 WHERE 的 DELETE/UPDATE）请在 warnings 中提示\n" +
        `4) 方言：${params.dialect ?? "standard SQL"}` +
        (params.tableSchema ? `\n5) 参考表结构：\n${params.tableSchema}` : "")

      const userPrompt =
        (params.instruction ? `编辑意图：${params.instruction}\n` : "") +
        (params.schema ? `当前 schema：${params.schema}\n` : "") +
        `当前 SQL：\n\`\`\`sql\n${params.sql}\n\`\`\`\n` +
        "请直接返回最终 SQL 对应的 JSON。"
      return { prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`, schemaInjected }
    })

  buildPromptDiff = (params: { sql: string; schema?: string; connectionId: string }): Effect.Effect<{ prompt: string; schemaInjected: string[] }, AiServiceError> =>
    Effect.gen(function* () {
      const schemaInjected: string[] = []
      const systemPrompt =
        "你是数据库 SQL 助手。要求：\n" +
        "1) 必须以严格 JSON 格式返回，结构为：{\"sql\": string, \"rationale\": string, \"warnings\": string[], \"alternatives\": string[]}\n" +
        "2) 只输出 SQL 修改结果本身，不要解释或额外文本；除 JSON 外不要任何其它内容\n" +
        "3) 高风险语句（DROP/TRUNCATE、无 WHERE 的 DELETE/UPDATE）请在 warnings 中提示\n" +
        "4) 任务意图：对 SQL 进行 Diff 提示（分析与可执行差异优化）\n"
      const userPrompt =
        (params.schema ? `当前 schema：${params.schema}\n` : "") +
        `SQL 原文：\n\`\`\`sql\n${params.sql}\n\`\`\`\n` +
        "请以 JSON 返回。"
      return { prompt: `SYSTEM:\n${systemPrompt}\n\nUSER:\n${userPrompt}`, schemaInjected }
    })
}

export const AiServiceLive = Layer.effect(
  AiService,
  Effect.gen(function* () {
    const keyStore = yield* AiKeyStoreService
    return new AiServiceImpl(keyStore)
  })
)

export { clampTemperature, clampTopP, clampMaxTokens }
export type { AiServiceConfig, AiServiceRequest }
