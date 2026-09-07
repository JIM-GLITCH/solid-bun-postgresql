/**
 * ai/* 路由：全部委托给 AiService（配置管理、连通性测试、SQL 编辑、Prompt 构建）。
 * 方法名与 shared/src/transport.ts 的 API_METHODS 对齐。
 */

import { Effect } from "effect"
import { AiService } from "../../services/AiService"
import type { AiSqlEditParams } from "../../services/AiService"
import type { AiServiceError } from "../../core/errors"

/** 与旧 api-core 的 normalizeAiSqlRequest 对齐：从载荷提取 SQL 编辑参数 */
const normalizeAiSqlParams = (payload: unknown): AiSqlEditParams & { connectionId?: string } => {
  const p = payload as {
    sql?: string
    connectionId?: string
    schema?: string
    instructions?: string
    instruction?: string
    keyRef?: string
    dialect?: string
  }
  return {
    sql: p.sql ?? "",
    connectionId: p.connectionId,
    schema: p.schema,
    instruction: p.instructions || p.instruction || "补全",
    keyRef: p.keyRef,
    dialect: p.dialect,
  }
}

export const handleAiConfigGet = (): Effect.Effect<any, AiServiceError, AiService> =>
  Effect.gen(function* () {
    const ai = yield* AiService
    return yield* ai.getConfig()
  })

export const handleAiConfigSet = (payload: unknown): Effect.Effect<any, AiServiceError | Error, AiService> =>
  Effect.gen(function* () {
    const ai = yield* AiService
    const p = payload as { apiMode?: string }
    if (p.apiMode !== undefined && p.apiMode !== "anthropic" && p.apiMode !== "openai-compatible") {
      return yield* Effect.fail(new Error("apiMode 须为 openai-compatible 或 anthropic"))
    }
    yield* ai.setConfig(p as any)
    return { success: true }
  })

export const handleAiKeyDelete = (payload: unknown): Effect.Effect<any, AiServiceError, AiService> =>
  Effect.gen(function* () {
    const ai = yield* AiService
    const { keyRef } = payload as { keyRef?: string }
    yield* ai.deleteKey(keyRef)
    return { success: true }
  })

export const handleAiTestConnection = (payload: unknown): Effect.Effect<any, AiServiceError, AiService> =>
  Effect.gen(function* () {
    const ai = yield* AiService
    const ok = yield* ai.testConnection(payload as any)
    return { success: ok }
  })

export const handleAiSqlEdit = (payload: unknown): Effect.Effect<any, AiServiceError | Error, AiService> =>
  Effect.gen(function* () {
    const ai = yield* AiService
    const params = normalizeAiSqlParams(payload)
    if (!params.connectionId) return yield* Effect.fail(new Error("缺少 connectionId"))
    if (!params.sql.trim()) return yield* Effect.fail(new Error("sql 不能为空"))
    return yield* ai.executeSqlEdit(params)
  })

export const handleAiPromptBuild = (payload: unknown): Effect.Effect<any, AiServiceError | Error, AiService> =>
  Effect.gen(function* () {
    const ai = yield* AiService
    const params = normalizeAiSqlParams(payload)
    if (!params.connectionId) return yield* Effect.fail(new Error("缺少 connectionId"))
    if (!params.sql.trim()) return yield* Effect.fail(new Error("sql 不能为空"))
    return yield* ai.buildPrompt(params)
  })

export const handleAiPromptBuildDiff = (payload: unknown): Effect.Effect<any, AiServiceError | Error, AiService> =>
  Effect.gen(function* () {
    const ai = yield* AiService
    const p = payload as { connectionId?: string; sql?: string; schema?: string }
    if (!p.sql?.trim()) return yield* Effect.fail(new Error("sql 不能为空"))
    return yield* ai.buildPromptDiff({
      sql: p.sql,
      schema: p.schema,
      connectionId: p.connectionId ?? "",
    })
  })
