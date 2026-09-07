import { Context, Effect, Schema } from "effect"
import type { AiServiceError } from "../core/errors"

export interface AiSqlEditParams {
  sql: string
  tableSchema?: string
  instruction: string
  dialect?: string
  keyRef?: string
  schema?: string
}

export interface AiSqlEditResult {
  sql: string
  rationale: string
  warnings: string[]
  alternatives?: string[]
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  elapsedMs?: number
  schemaInjected?: string[]
}

export interface AiConfigState {
  apiMode: "openai-compatible" | "anthropic"
  baseUrl?: string
  model: string
  keyRef: string
  temperature: number
  topP?: number
  stream: boolean
  maxTokens: number
}

export const AiResponseSchema = Schema.Struct({
  sql: Schema.String,
  rationale: Schema.String,
  warnings: Schema.Array(Schema.String),
  alternatives: Schema.optional(Schema.Array(Schema.String)),
})

export type AiResponse = Schema.Schema.Type<typeof AiResponseSchema>

export interface AiService {
  executeSqlEdit(params: AiSqlEditParams): Effect.Effect<AiSqlEditResult, AiServiceError>
  validateConfig(config?: Partial<AiConfigState>): Effect.Effect<boolean, AiServiceError>
  testConnection(config?: Partial<AiConfigState>): Effect.Effect<boolean, AiServiceError>
  getConfig(): Effect.Effect<AiConfigState & { hasKey: boolean }, AiServiceError>
  setConfig(config: Partial<AiConfigState> & { apiKey?: string }): Effect.Effect<void, AiServiceError>
  deleteKey(keyRef?: string): Effect.Effect<void, AiServiceError>
  buildPrompt(params: AiSqlEditParams): Effect.Effect<{ prompt: string; schemaInjected: string[] }, AiServiceError>
  buildPromptDiff(params: { sql: string; schema?: string; connectionId: string }): Effect.Effect<{ prompt: string; schemaInjected: string[] }, AiServiceError>
}

export const AiService = Context.Service<AiService>("AiService")
