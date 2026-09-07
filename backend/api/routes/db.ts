/**
 * db/* 路由：按会话的 dbKind（或建连载荷的 dbType）分派到对应 Adapter 的 handlers。
 *
 * 分派规则与旧 api-core.ts 保持一致：
 * - db/connect：看载荷 dbType（mysql/mariadb → MySQL，sqlserver → SQL Server，其余 → PostgreSQL）
 * - 其他 db/*：看 SessionStore 中已登记会话的 dbKind；无会话时默认 PostgreSQL
 *   （如 db/capabilities 可在未建连时调用）
 *
 * 载荷中的 dbType 仅作提示，路由以会话 dbKind 为准，避免前端刷新后
 * 未再登记 dbType（默认 postgres）导致已建立的 MySQL/SQL Server 会话请求失败。
 */

import { Effect } from "effect"
import type { MethodNotFoundError } from "../../core/errors"
import { makeErrorContext, MethodNotFoundError as MethodNotFoundErr } from "../../core/errors"
import { SessionStore } from "../../services/SessionStore"
import { makePostgresHandlers } from "../../adapters/postgres/PostgresHandlers"
import { makeMysqlHandlers } from "../../adapters/mysql/MysqlHandlers"
import { makeSqlServerHandlers } from "../../adapters/sqlserver/SqlServerHandlers"
import { isMysqlFamily } from "../../../shared/src"

const postgresHandlers = makePostgresHandlers()
const mysqlHandlers = makeMysqlHandlers()
const sqlServerHandlers = makeSqlServerHandlers()

/** 解析 db/* 请求应使用的方言处理器 */
const resolveDbHandlers = (
  method: string,
  payload: unknown,
): Effect.Effect<
  { handleRequest: (m: string, p: unknown) => Effect.Effect<unknown, Error, SessionStore> },
  never,
  SessionStore
> =>
  Effect.gen(function* () {
    const p = payload as { connectionId?: string; dbType?: string }

    if (method === "db/connect") {
      if (isMysqlFamily(p.dbType as never)) return mysqlHandlers
      if (p.dbType === "sqlserver") return sqlServerHandlers
      return postgresHandlers
    }

    const cid = p.connectionId
    if (cid == null || String(cid) === "") return postgresHandlers

    const store = yield* SessionStore
    const session = yield* store.get(String(cid))
    const kind = session?.dbKind
    if (kind != null && isMysqlFamily(kind)) return mysqlHandlers
    if (kind === "sqlserver") return sqlServerHandlers
    return postgresHandlers
  })

/**
 * 处理所有 db/* 方法。R 中的 ConnectionId 已由 handlers 内部
 * `provideConnectionId(payload.connectionId)` 消除，仅需外部提供 SessionStore。
 */
export const handleDbRequest = (
  method: string,
  payload: unknown,
): Effect.Effect<unknown, MethodNotFoundError | Error, SessionStore> =>
  Effect.gen(function* () {
    if (!method.startsWith("db/")) {
      return yield* Effect.fail(
        new MethodNotFoundErr({
          context: makeErrorContext("handleDbRequest"),
          method,
        }),
      )
    }
    const handlers = yield* resolveDbHandlers(method, payload)
    return yield* handlers.handleRequest(method, payload)
  })
