/**
 * VSCode 扩展专用运行时
 *
 * 与 HTTP/standalone 入口不同，VSCode 下的 AI Key 应存放在扩展的
 * SecretStorage（`context.secrets`）中，而非文件加密存储。旧 `api-core`
 * 用全局 `setAiKeyResolver` 钩子实现这一点；本模块以 Effect Layer 方式重建：
 *
 * - `SecretsAiKeyStore`：AiKeyStoreService 的实现，get/set/delete 委托给
 *   可在 `activate()` 时注入的解析器（`setVscodeAiKeyResolver`）。
 * - `VscodeAppRuntime`：用 secrets 版 AiKeyStore 组合出的 ManagedRuntime 单例，
 *   供 api-handlers-vscode 使用。
 *
 * 解析器在实际调用时才读取（懒加载），因此即便 Runtime 在 activate 之前构建，
 * 只要在真正发起 AI 请求前完成注入即可。
 */

import { Effect, Layer, ManagedRuntime } from "effect"
import { AiKeyStoreService } from "../services/AiKeyStoreService"
import type { AiKeyStoreService as AiKeyStoreServiceShape } from "../services/AiKeyStoreService"
import { StorageError, makeErrorContext } from "../core/errors"
import { makeAppLayer } from "./layers"

/** VSCode SecretStorage 解析器：由扩展在 activate 时注入 */
export interface VscodeAiKeyResolver {
  get(keyRef: string): Promise<string | null | undefined>
  set(keyRef: string, apiKey: string): Promise<void>
  delete(keyRef: string): Promise<void>
}

let currentResolver: VscodeAiKeyResolver | null = null

/** 注入 VSCode SecretStorage 解析器（等价于旧 api-core 的 setAiKeyResolver） */
export function setVscodeAiKeyResolver(resolver: VscodeAiKeyResolver): void {
  currentResolver = resolver
}

const secretsError = (operation: "read" | "write" | "delete"): StorageError =>
  new StorageError({
    context: makeErrorContext("vscodeSecretsAiKeyStore"),
    filePath: "vscode-secrets",
    operation,
  })

class SecretsAiKeyStore implements AiKeyStoreServiceShape {
  get = (keyRef: string): Effect.Effect<string | null, StorageError> =>
    Effect.tryPromise({
      try: () =>
        currentResolver
          ? currentResolver.get(keyRef)
          : Promise.resolve(null as string | null | undefined),
      catch: () => secretsError("read"),
    }).pipe(Effect.map((v) => v ?? null))

  set = (keyRef: string, apiKey: string): Effect.Effect<void, StorageError> =>
    Effect.tryPromise({
      try: () =>
        currentResolver
          ? currentResolver.set(keyRef, apiKey)
          : Promise.resolve(),
      catch: () => secretsError("write"),
    }).pipe(Effect.asVoid)

  delete = (keyRef: string): Effect.Effect<void, StorageError> =>
    Effect.tryPromise({
      try: () =>
        currentResolver
          ? currentResolver.delete(keyRef)
          : Promise.resolve(),
      catch: () => secretsError("delete"),
    }).pipe(Effect.asVoid)
}

/** secrets 版 AiKeyStore Layer */
export const SecretsAiKeyStoreLive = Layer.succeed(
  AiKeyStoreService,
  new SecretsAiKeyStore()
)

/** VSCode 应用 Layer：用 SecretStorage 替换文件式 AiKeyStore */
export const VscodeAppLayer = makeAppLayer(SecretsAiKeyStoreLive)

/** VSCode 运行时单例 */
export const VscodeAppRuntime = ManagedRuntime.make(VscodeAppLayer)
