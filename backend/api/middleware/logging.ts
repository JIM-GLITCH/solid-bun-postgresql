/**
 * Logging middleware - Effect-based structured logging
 *
 * 通过 Effect 内置日志（由 core/logger.ts 的 JsonLoggerLayer/TextLoggerLayer
 * 决定输出格式）记录 API 调用的开始/完成/失败与耗时。
 */

import { Effect } from "effect"

export const withLogging = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  method: string,
): Effect.Effect<A, E, R> => {
  const startTime = Date.now()
  return Effect.gen(function* () {
    yield* Effect.logInfo(`API call started: ${method}`)
    const result = yield* effect
    yield* Effect.logInfo(`API call completed: ${method} (${Date.now() - startTime}ms)`)
    return result
  }).pipe(
    Effect.catch((error: E) =>
      Effect.gen(function* () {
        yield* Effect.logError(`API call failed: ${method} (${Date.now() - startTime}ms): ${String(error)}`)
        return yield* Effect.fail(error)
      })
    ),
  )
}
