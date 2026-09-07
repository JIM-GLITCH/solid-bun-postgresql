import { Effect } from "effect"
import { QueryHistoryService } from "../../services/QueryHistoryService"
import type { StorageError } from "../../core/errors"
import type { ApiRequestPayload } from "../../../shared/src"

export const handleQueryHistoryAdd = (payload: ApiRequestPayload["query-history/add"]): Effect.Effect<any, StorageError, QueryHistoryService> =>
  Effect.gen(function* () {
    const svc = yield* QueryHistoryService
    yield* svc.add({
      sql: payload.sql,
      connectionId: payload.connectionId,
    })
    return { success: true }
  })

export const handleQueryHistorySearch = (payload: ApiRequestPayload["query-history/search"]): Effect.Effect<any, StorageError, QueryHistoryService> =>
  Effect.gen(function* () {
    const svc = yield* QueryHistoryService
    return yield* svc.search({
      keyword: payload.keyword,
      since: payload.since,
      until: payload.until,
    })
  })

export const handleQueryHistoryDelete = (payload: ApiRequestPayload["query-history/delete"]): Effect.Effect<any, StorageError | Error, QueryHistoryService> =>
  Effect.gen(function* () {
    if (!payload.id) return yield* Effect.fail(new Error("缺少 id"))
    const svc = yield* QueryHistoryService
    yield* svc.delete(payload.id)
    return { success: true }
  })

export const handleQueryHistoryClear = (): Effect.Effect<any, StorageError, QueryHistoryService> =>
  Effect.gen(function* () {
    const svc = yield* QueryHistoryService
    yield* svc.clear()
    return { success: true }
  })
