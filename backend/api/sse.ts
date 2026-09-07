/**
 * SSE (Server-Sent Events) - Effect-based 实时事件推送
 *
 * 迁移自旧 session-connection.ts / api-core.ts 的
 * `sendSSEMessage` / `subscribeSessionEvents` / `eventPushers` 逻辑：
 *
 * - 每个会话（SessionConnection）自带 `eventPushers` 集合，数据库底层事件
 *   （pg notice/error 等）由会话侧直接推给所有已登记的 pusher；
 * - 路由/入口层通过 {@link subscribeSessionEvents} 为某个 connectionId 注册
 *   pusher（HTTP SSE 流、VSCode postMessage 均走此入口）；
 * - {@link sendSSEMessage} 供业务代码向指定连接推送消息；
 * - 流级心跳（10s `: heartbeat` 注释帧）由 HTTP 入口自行维护
 *   （见 api-handlers-http.ts 的 /api/events），此处不重复实现。
 */

import { Context, Effect, Layer } from "effect"
import type { SSEMessage } from "../../shared/src"
import { SessionStore } from "../services/SessionStore"
import type { SessionStoreShape } from "../services/SessionStore"
import { SessionNotFoundError, makeErrorContext } from "../core/errors"

export type { SSEMessage }

export interface SseEventBusShape {
  /** 向指定连接推送消息；连接不存在时静默丢弃（与旧实现一致） */
  readonly publish: (connectionId: string, message: SSEMessage) => Effect.Effect<void, never>
  /**
   * 订阅指定连接的事件推送，返回取消订阅函数。
   * 连接不存在时报 SessionNotFoundError（与旧 subscribeSessionEvents 抛错一致）。
   */
  readonly subscribe: (
    connectionId: string,
    push: (message: SSEMessage) => void,
  ) => Effect.Effect<() => void, SessionNotFoundError>
}

export class SseEventBus extends Context.Service<SseEventBus, SseEventBusShape>()(
  "@backend/SseEventBus",
) {}

/** 基于 SessionStore 的实现：pusher 直接登记在会话的 eventPushers 上 */
const makeSessionEventBus = (store: SessionStoreShape): SseEventBusShape => ({
  publish: (connectionId, message) =>
    Effect.gen(function* () {
      const session = yield* store.get(connectionId)
      if (!session) return
      for (const push of session.eventPushers) {
        try {
          push(message)
        } catch {
          /* 推送失败忽略：客户端可能已断开 */
        }
      }
    }),
  subscribe: (connectionId, push) =>
    Effect.gen(function* () {
      const session = yield* store.get(connectionId)
      if (!session) {
        return yield* Effect.fail(
          new SessionNotFoundError({
            context: makeErrorContext("sse.subscribe"),
            sessionId: connectionId,
          }),
        )
      }
      session.eventPushers.add(push)
      return () => {
        session.eventPushers.delete(push)
      }
    }),
})

export const SseEventBusLive: Layer.Layer<SseEventBus, never, SessionStore> = Layer.effect(
  SseEventBus,
  Effect.gen(function* () {
    const store = yield* SessionStore
    return makeSessionEventBus(store)
  }),
)

// ===== 便捷函数（需要外部提供 SessionStore） =====

/** 向指定连接推送 SSE 消息（连接不存在时静默丢弃） */
export const sendSSEMessage = (
  connectionId: string,
  message: SSEMessage,
): Effect.Effect<void, never, SessionStore> =>
  Effect.gen(function* () {
    const store = yield* SessionStore
    yield* makeSessionEventBus(store).publish(connectionId, message)
  })

/** 订阅指定连接的事件推送，返回取消订阅函数 */
export const subscribeSessionEvents = (
  connectionId: string,
  push: (message: SSEMessage) => void,
): Effect.Effect<() => void, SessionNotFoundError, SessionStore> =>
  Effect.gen(function* () {
    const store = yield* SessionStore
    return yield* makeSessionEventBus(store).subscribe(connectionId, push)
  })

/** 同步检查会话是否存在（供 HTTP 入口在建立 SSE 流前校验） */
export const hasSession = (
  connectionId: string,
): Effect.Effect<boolean, never, SessionStore> =>
  Effect.gen(function* () {
    const store = yield* SessionStore
    const session = yield* store.get(connectionId)
    return session !== undefined
  })
