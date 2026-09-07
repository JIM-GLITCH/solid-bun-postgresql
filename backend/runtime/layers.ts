/**
 * Application Layer Composition
 *
 * 组合应用所需的全部服务 Layer。生产入口（api-handlers-http / vscode）
 * 通过 `Effect.provide(AppLayer)` 一次性注入。
 *
 * 注意：不再包含 DatabaseServiceLive —— DatabaseService 是废弃的中间 Facade，
 * db/* 请求由 routes/db.ts 直接分派到各 Adapter 的 handlers，
 * handlers 通过 SessionStore + ConnectionId 两个 Context Tag 访问会话。
 */

import { Layer } from "effect"
import { ConnectionStoreServiceLive } from "../storage/stores/ConnectionStoreServiceImpl"
import { QueryHistoryServiceLive } from "../storage/stores/QueryHistoryServiceImpl"
import { AiKeyStoreServiceLive } from "../storage/stores/AiKeyStoreServiceImpl"
import { AiServiceLive } from "../services/AiServiceImpl"
import { SubscriptionServiceLive } from "../services/SubscriptionServiceImpl"
import { LicenseServiceLive } from "../services/LicenseServiceImpl"
import { sessionStoreFromMap } from "../services/SessionStore"
import { SshTunnelServiceLive } from "../ssh/SshTunnelImpl"
import { SseEventBusLive } from "../api/sse"
import { type AiKeyStoreService as AiKeyStoreServiceShape } from "../services/AiKeyStoreService"

// Storage services layer
export const StorageLayer = Layer.merge(
  ConnectionStoreServiceLive,
  Layer.merge(QueryHistoryServiceLive, AiKeyStoreServiceLive)
)

// AI service layer（依赖 AiKeyStoreService，由 StorageLayer 提供）
export const AiLayer = AiServiceLive

// Subscription services layer
export const SubscriptionLayer = Layer.merge(
  SubscriptionServiceLive,
  LicenseServiceLive
)

/**
 * 会话仓储 Layer：基于内存 Map 的进程级实现。
 * 所有 db/* handler 通过 SessionStore Context 读写会话。
 */
export const SessionStoreLayer = sessionStoreFromMap()

/** SSH 隧道 Layer */
export const SshTunnelLayer = SshTunnelServiceLive

/**
 * SSE 事件总线 Layer：依赖 SessionStore。
 * 用 provideMerge 把 SessionStoreLayer 的输出喂给 SseEventBusLive，
 * 结果同时提供 SseEventBus + SessionStore 且无剩余依赖。
 */
export const SseLayer = SseEventBusLive.pipe(
  Layer.provideMerge(SessionStoreLayer)
)

// Core services layer (includes storage, AI, and subscription)
//
// AiServiceLive 依赖 AiKeyStoreService（由 StorageLayer 提供），
// 用 provideMerge 把 StorageLayer 喂给 AiServiceLive 并保留两者输出，
// 消除残留依赖；再并入 SubscriptionLayer。
export const CoreServicesLayer = AiServiceLive.pipe(
  Layer.provideMerge(StorageLayer),
  Layer.merge(SubscriptionLayer),
)

/**
 * 完整应用 Layer：Core 服务 + 会话仓储/SSE + SSH 隧道。
 * SseLayer 已通过 provideMerge 内含 SessionStore，故此处无需再单列。
 * 组合后 R = never，可直接交给 ManagedRuntime.make。
 */
export const AppLayer = Layer.mergeAll(
  CoreServicesLayer,
  SseLayer,
  SshTunnelLayer,
)

// Production-ready layer with all services
export const ProductionLayers = AppLayer

/**
 * 按给定的 AiKeyStore 实现组合一份完整 App Layer。
 *
 * 默认 `AppLayer` 使用文件加密存储（AiKeyStoreServiceLive）；
 * VSCode 扩展需改用 SecretStorage，通过本函数注入 secrets 版实现，
 * 其余服务（连接存储、AI、订阅、会话、SSE、SSH）保持一致。
 */
export const makeAppLayer = (
  aiKeyStoreLayer: Layer.Layer<AiKeyStoreServiceShape, never, never>
) => {
  const storage = Layer.merge(
    ConnectionStoreServiceLive,
    Layer.merge(QueryHistoryServiceLive, aiKeyStoreLayer)
  )
  const core = AiServiceLive.pipe(
    Layer.provideMerge(storage),
    Layer.merge(SubscriptionLayer),
  )
  return Layer.mergeAll(core, SseLayer, SshTunnelLayer)
}
