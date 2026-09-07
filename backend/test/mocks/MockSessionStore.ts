/**
 * Mock SessionStore for testing
 *
 * 替代已删除的 MockDatabaseService：新架构下 db/* handler 通过 SessionStore
 * Context 直接读写会话，因此测试只需提供内存版 SessionStore。
 * 复用生产的 `sessionStoreFromMap`（基于 Map 的内存实现）。
 */

import { Layer } from "effect"
import { SessionStore, sessionStoreFromMap } from "../../services/SessionStore"
import type { SessionConnection } from "../../session-connection"

/** 独立的内存会话仓储 Layer（每个测试上下文一份新 Map） */
export const MockSessionStoreLayer: Layer.Layer<SessionStore> = sessionStoreFromMap(
  new Map<string, SessionConnection>(),
)
