/**
 * Refactored API Core - Effect-based routing
 *
 * 顶级路由器：按方法名前缀分派到各 routes 模块。
 * 覆盖 shared/src/transport.ts API_METHODS 中除 vscode/*（未在后端实现，
 * 与旧 api-core 一致落入 MethodNotFound）之外的全部方法。
 */

import { Effect } from "effect"
import { MethodNotFoundError, makeErrorContext } from "../core/errors"
import type { BackendError } from "../core/errors"
import type { ApiMethod, ApiRequestPayload } from "../../shared/src"
import { SessionStore } from "../services/SessionStore"
import { ConnectionStoreService } from "../services/ConnectionStoreService"
import { AiService } from "../services/AiService"
import { QueryHistoryService } from "../services/QueryHistoryService"
import { SubscriptionService } from "../services/SubscriptionService"
import { handleDbRequest } from "./routes/db"
import {
  handleConnectionsList,
  handleConnectionsSave,
  handleConnectionsDelete,
  handleConnectionsUpdateMeta,
  handleConnectionsReorder,
  handleConnectionsGetParams,
  handleConnectionsConnect,
} from "./routes/connections"
import {
  handleAiConfigGet,
  handleAiConfigSet,
  handleAiKeyDelete,
  handleAiTestConnection,
  handleAiSqlEdit,
  handleAiPromptBuild,
  handleAiPromptBuildDiff,
} from "./routes/ai"
import {
  handleQueryHistoryAdd,
  handleQueryHistorySearch,
  handleQueryHistoryDelete,
  handleQueryHistoryClear,
} from "./routes/query-history"
import {
  handleSubscriptionAssert,
  handleSubscriptionAccount,
} from "./routes/subscription"

/** 路由所需的全部服务 Context */
export type ApiRequestContext =
  | SessionStore
  | ConnectionStoreService
  | AiService
  | QueryHistoryService
  | SubscriptionService

const methodNotFound = (method: string) =>
  new MethodNotFoundError({
    context: makeErrorContext("routeApiRequest"),
    method,
  })

export const routeApiRequest = (
  method: ApiMethod | string,
  payload: ApiRequestPayload[ApiMethod] | unknown,
): Effect.Effect<any, BackendError | Error, ApiRequestContext> =>
  Effect.gen(function* () {
    const p = payload as any

    if (typeof method === "string" && method.startsWith("db/")) {
      return yield* handleDbRequest(method, p)
    }

    switch (method) {
      // ===== connections/* =====
      case "connections/list":
        return yield* handleConnectionsList()
      case "connections/save":
        return yield* handleConnectionsSave(p)
      case "connections/delete":
        return yield* handleConnectionsDelete(p)
      case "connections/update-meta":
        return yield* handleConnectionsUpdateMeta(p)
      case "connections/reorder":
        return yield* handleConnectionsReorder(p)
      case "connections/get-params":
        return yield* handleConnectionsGetParams(p)
      case "connections/connect":
        return yield* handleConnectionsConnect(p)

      // ===== query-history/* =====
      case "query-history/add":
        return yield* handleQueryHistoryAdd(p)
      case "query-history/search":
        return yield* handleQueryHistorySearch(p)
      case "query-history/delete":
        return yield* handleQueryHistoryDelete(p)
      case "query-history/clear":
        return yield* handleQueryHistoryClear()

      // ===== subscription/* =====
      case "subscription/assert":
        return yield* handleSubscriptionAssert(p)
      case "subscription/account":
        return yield* handleSubscriptionAccount()

      // ===== ai/* =====
      case "ai/config/get":
        return yield* handleAiConfigGet()
      case "ai/config/set":
        return yield* handleAiConfigSet(p)
      case "ai/key/delete":
        return yield* handleAiKeyDelete(p)
      case "ai/test-connection":
        return yield* handleAiTestConnection(p)
      case "ai/sql-edit":
        return yield* handleAiSqlEdit(p)
      case "ai/prompt-build":
        return yield* handleAiPromptBuild(p)
      case "ai/prompt-build-diff":
        return yield* handleAiPromptBuildDiff(p)

      default:
        return yield* Effect.fail(methodNotFound(String(method)))
    }
  })
