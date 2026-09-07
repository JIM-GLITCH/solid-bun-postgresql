import { Effect, Scope } from "effect"
import sql from "mssql"
import { DatabaseConnectionError, makeErrorContext } from "../../core/errors"
import { sanitizeHost } from "../../core/sanitize"
import type { ConnectParams } from "../shared/types"

/**
 * 单独创建 SQL Server 连接池（复用配置逻辑）
 */
export const makeSqlServerPool = (
  params: ConnectParams,
  tunnelPort?: number
): Effect.Effect<InstanceType<typeof sql.ConnectionPool>, DatabaseConnectionError, Scope.Scope> => {
  const dbRaw = params.database ? String(params.database).trim() : ""
  const maxPool = params.sshEnabled ? 2 : 6

  const poolConfig: sql.config = {
    server: tunnelPort ? "127.0.0.1" : (String(params.host ?? "localhost").trim() || "localhost"),
    port: tunnelPort ?? (params.port ?? 1433),
    user: params.username,
    password: params.password ?? "",
    ...(dbRaw ? { database: dbRaw } : {}),
    connectionTimeout: params.sshEnabled ? 30000 : 10000,
    pool: { max: maxPool, min: 0, idleTimeoutMillis: 30000 },
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
  }

  return Effect.acquireRelease(
    Effect.tryPromise({
      try: async () => {
        const p = new sql.ConnectionPool(poolConfig)
        await p.connect()
        return p
      },
      catch: (e) => new DatabaseConnectionError({
        context: makeErrorContext("sqlserver.pool"),
        host: sanitizeHost(poolConfig.server),
        port: poolConfig.port ?? 1433,
        database: dbRaw || "(default)",
        errorCode: (e as any)?.code ?? (e as any)?.number?.toString(),
      })
    }),
    (p) => Effect.promise(() => p.close().catch(() => {}))
  )
}
