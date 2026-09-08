/**
 * Application Layer Composition
 *
 * 组合应用所需的全部服务 Layer。生产入口（api-handlers-http / vscode）
 * 通过 `ManagedRuntime.make(AppLayer)` 一次性构建并复用。
 *
 * 结构是平的：叶子服务彼此无依赖，全部并列在一个 `Layer.mergeAll` 里；
 * 只有两条真实依赖边需要接线（`provideMerge`）：
 *
 *   AiServiceLive   ← AiKeyStoreService
 *   SseEventBusLive ← SessionStore
 *
 * 接线后每个元素的 R 都是 never，因此不存在中间层级的具名 Layer。
 * `mergeAll` 本身不会把兄弟 Layer 的输出喂给兄弟 Layer 的依赖，
 * 所以这两条边必须显式接线，无法进一步压平。
 *
 * 注意：不再包含 DatabaseServiceLive —— DatabaseService 是废弃的中间 Facade，
 * db/* 请求由 routes/db.ts 直接分派到各 Adapter 的 handlers，
 * handlers 通过 SessionStore + ConnectionId 两个 Context Tag 访问会话。
 * SessionStore 由 SSE 那条边顺带暴露；ConnectionId 属请求作用域，
 * 由路由层 `provideConnectionId` 注入，不在应用 Layer 内。
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

/**
 * 组装完整应用 Layer。
 *
 * `aiKeyStoreLayer` 是唯一可替换点：HTTP/standalone 传文件加密实现
 * （`AiKeyStoreServiceLive`），VSCode 扩展传 SecretStorage 实现，
 * 其余服务（连接存储、查询历史、AI、订阅、会话、SSE、SSH）保持一致。
 */
const buildAppLayer = (
  aiKeyStoreLayer: Layer.Layer<AiKeyStoreServiceShape, never, never>
) =>
  Layer.mergeAll(
    // 叶子服务：无依赖，直接并列
    ConnectionStoreServiceLive,
    QueryHistoryServiceLive,
    SubscriptionServiceLive,
    LicenseServiceLive,
    SshTunnelServiceLive,
    // 依赖边 1：AiService 需要 AiKeyStore，provideMerge 同时保留两者输出
    AiServiceLive.pipe(Layer.provideMerge(aiKeyStoreLayer)),
    // 依赖边 2：SseEventBus 需要 SessionStore，SessionStore 顺带暴露给 db/* handlers
    SseEventBusLive.pipe(Layer.provideMerge(sessionStoreFromMap()))
  )

/** 完整应用 Layer：AiKeyStore 使用文件加密存储，R = never */
export const AppLayer = buildAppLayer(AiKeyStoreServiceLive)

/** 按给定 AiKeyStore Layer 组合一份完整 App Layer（VSCode SecretStorage 用） */
export const makeAppLayer = buildAppLayer
