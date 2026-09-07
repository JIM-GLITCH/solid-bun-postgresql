/**
 * Mock AiService for testing
 * 完整实现 AiService 接口，返回确定性结果。
 */

import { Effect, Layer } from "effect"
import { AiService } from "../../services/AiService"
import type { AiSqlEditParams, AiSqlEditResult, AiConfigState } from "../../services/AiService"
import type { AiServiceError } from "../../core/errors"

const defaultConfig: AiConfigState = {
  apiMode: "openai-compatible",
  model: "mock-model",
  keyRef: "default",
  temperature: 0.2,
  stream: false,
  maxTokens: 1024,
}

class MockAiService implements AiService {
  private mockResponse: AiSqlEditResult = {
    sql: "SELECT * FROM users WHERE id = 1",
    rationale: "Mock AI response for testing",
    warnings: [],
    alternatives: ["SELECT * FROM users LIMIT 1"],
  }

  private config: AiConfigState = { ...defaultConfig }

  executeSqlEdit = (_params: AiSqlEditParams): Effect.Effect<AiSqlEditResult, AiServiceError> =>
    Effect.succeed(this.mockResponse)

  validateConfig = (_config?: Partial<AiConfigState>): Effect.Effect<boolean, AiServiceError> =>
    Effect.succeed(true)

  testConnection = (_config?: Partial<AiConfigState>): Effect.Effect<boolean, AiServiceError> =>
    Effect.succeed(true)

  getConfig = (): Effect.Effect<AiConfigState & { hasKey: boolean }, AiServiceError> => {
    const self = this
    return Effect.succeed({ ...self.config, hasKey: true })
  }

  setConfig = (
    config: Partial<AiConfigState> & { apiKey?: string },
  ): Effect.Effect<void, AiServiceError> => {
    const self = this
    return Effect.sync(() => {
      const { apiKey: _apiKey, ...rest } = config
      self.config = { ...self.config, ...rest }
    })
  }

  deleteKey = (_keyRef?: string): Effect.Effect<void, AiServiceError> => Effect.void

  buildPrompt = (
    params: AiSqlEditParams,
  ): Effect.Effect<{ prompt: string; schemaInjected: string[] }, AiServiceError> =>
    Effect.succeed({ prompt: `MOCK PROMPT: ${params.sql}`, schemaInjected: [] })

  buildPromptDiff = (
    params: { sql: string; schema?: string; connectionId: string },
  ): Effect.Effect<{ prompt: string; schemaInjected: string[] }, AiServiceError> =>
    Effect.succeed({ prompt: `MOCK DIFF PROMPT: ${params.sql}`, schemaInjected: [] })

  setMockResponse = (response: AiSqlEditResult): void => {
    this.mockResponse = response
  }
}

export const MockAiServiceLayer = Layer.succeed(AiService, new MockAiService())
