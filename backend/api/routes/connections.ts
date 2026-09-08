/**
 * connections/* 路由：基于 ConnectionStoreService 的持久化操作 +
 * connections/connect（读取已存参数后委托 db/connect 建连）。
 */

import { Effect } from "effect"
import { ConnectionStoreService } from "../../services/ConnectionStoreService"
import { SessionStore } from "../../services/SessionStore"
import type { StorageError } from "../../core/errors"
import type { ApiRequestPayload, ConnectionSavePayload, ConnectDbRequest, StoredConnectionParams } from "../../../shared/src"
import { routeApiRequest } from "../ApiCoreRefactored"

export const handleConnectionsList = (): Effect.Effect<any, StorageError, ConnectionStoreService> =>
  Effect.gen(function* () {
    const store = yield* ConnectionStoreService
    return yield* store.list()
  })

export const handleConnectionsSave = (payload: ApiRequestPayload["connections/save"]): Effect.Effect<any, StorageError, ConnectionStoreService> =>
  Effect.gen(function* () {
    const store = yield* ConnectionStoreService
    const { id, name, group, dbType, host, port, database, username, password, sshEnabled, sshHost, sshPort, sshUsername, sshPassword, sshPrivateKey, connectionTimeoutSec } = payload as ConnectionSavePayload
    const params: StoredConnectionParams = {
      host,
      port: String(port ?? 5432),
      database,
      username,
      password,
      sshEnabled,
      sshHost,
      sshPort: sshPort ? String(sshPort) : undefined,
      sshUsername,
      sshPassword,
      sshPrivateKey,
      connectionTimeoutSec,
      dbType,
    }
    yield* store.save(id, params, { name, group })
    return { ok: true }
  })

export const handleConnectionsDelete = (payload: ApiRequestPayload["connections/delete"]): Effect.Effect<any, StorageError, ConnectionStoreService> =>
  Effect.gen(function* () {
    const store = yield* ConnectionStoreService
    yield* store.remove(payload.id)
    return { ok: true }
  })

export const handleConnectionsUpdateMeta = (payload: ApiRequestPayload["connections/update-meta"]): Effect.Effect<any, StorageError, ConnectionStoreService> =>
  Effect.gen(function* () {
    const store = yield* ConnectionStoreService
    yield* store.updateMeta(payload.id, { name: payload.name })
    return { ok: true }
  })

export const handleConnectionsReorder = (payload: ApiRequestPayload["connections/reorder"]): Effect.Effect<any, StorageError, ConnectionStoreService> =>
  Effect.gen(function* () {
    const store = yield* ConnectionStoreService
    yield* store.reorder(payload.list ?? [])
    return { ok: true }
  })

export const handleConnectionsGetParams = (payload: ApiRequestPayload["connections/get-params"]): Effect.Effect<any, StorageError | Error, ConnectionStoreService> =>
  Effect.gen(function* () {
    const store = yield* ConnectionStoreService
    const params = yield* store.getParams(payload.id)
    if (!params) {
      // 与旧 api-core 行为一致：未找到时抛普通错误，由入口层统一转 JSON-RPC error
      return yield* Effect.fail(new Error(`未找到已保存的连接: ${payload.id}`))
    }
    return params
  })

/**
 * connections/connect：读取已存连接参数，构造 db/connect 载荷并委托给 db 路由。
 * 使用 sessionId 区分不同浏览器标签页，关闭标签页时可通过 SSE 断开释放资源。
 */
export const handleConnectionsConnect = (
  payload: ApiRequestPayload["connections/connect"],
)=>
  Effect.gen(function* () {
    const store = yield* ConnectionStoreService
    const params = yield* store.getParams(payload.id)
    if (!params) {
      return yield* Effect.fail(new Error("未找到已保存的连接"))
    }
    const { id: storedId, dbType, ...loginParams } = params
    const connectionId = payload.sessionId ? `${storedId}-${payload.sessionId}` : storedId
    return yield* (routeApiRequest("db/connect", {
      connectionId,
      dbType: dbType ?? "postgres",
      ...loginParams,
    } as ConnectDbRequest) )
  })
