/**
 * 单独创建 MySQL 连接池（不含 PoolConnection），用于后台查询
 */

import { DatabaseConnectionError, makeErrorContext } from "../../core/errors"
import { sanitizeHost } from "../../core/sanitize"
import { Effect, Scope } from "effect"
import type { ConnectParams } from "../shared/types"

export const makeMysqlPool = (
  params: ConnectParams,
  tunnelPort?: number
): Effect.Effect<import("mysql2/promise").Pool, DatabaseConnectionError, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.tryPromise({
      try: () => {
        const mysql2 = require("mysql2/promise")
        const p = mysql2.createPool({
          host: tunnelPort ? undefined : (params.host ?? "localhost"),
          port: tunnelPort ?? (params.port ?? 3306),
          database: params.database ? String(params.database).trim() : undefined,
          user: params.username,
          password: params.password ?? "",
          connectTimeout: params.sshEnabled ? 30000 : 10000,
          waitForConnections: true,
          connectionLimit: params.sshEnabled ? 2 : 6,
          queueLimit: 0,
        })
        // 验证连接
        return (p as any).getConnection().then((conn: any) => { conn.release(); return p })
      },
      catch: (e) => new DatabaseConnectionError({
        context: makeErrorContext("mysql.pool"),
        host: sanitizeHost(params.host),
        port: params.port ?? 3306,
        database: params.database ?? "",
        errorCode: (e as any)?.code,
      })
    }),
    (p) => Effect.promise(() => (p as any).end().catch(() => {}))
  )
