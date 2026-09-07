/**
 * 应用运行时单例（ManagedRuntime）
 *
 * 用 `ManagedRuntime.make(AppLayer)` 一次性构建全部服务 Layer 并复用，
 * 确保带内部状态的服务（AiServiceImpl 的配置 Ref、SessionStore 的会话 Map）
 * 在所有请求间共享——若每次请求各自 `Effect.provide(AppLayer)`，
 * `Layer.effect` 会重建实例导致状态丢失。
 *
 * 入口层（api-handlers-http / api-handlers-vscode）通过：
 * - `AppRuntime.runPromise(effect)` 执行异步 RPC
 * - `AppRuntime.runSync(effect)`   执行同步查询（如会话存在性检查）
 * - `AppRuntime.dispose()`         进程退出时释放资源
 */

import { ManagedRuntime } from "effect"
import { AppLayer } from "./layers"

export const AppRuntime = ManagedRuntime.make(AppLayer)
