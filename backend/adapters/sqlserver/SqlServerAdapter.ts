import { Effect, Scope } from "effect"
import sql from "mssql"
import { createSshTunnel } from "../../ssh-tunnel"
import { DatabaseConnectionError, makeErrorContext } from "../../core/errors"
import { sanitizeHost } from "../../core/sanitize"
import type { ConnectParams } from "../shared/types"

export interface SqlServerAdapterConnection {
  pool: InstanceType<typeof sql.ConnectionPool>
  closeTunnel?: () => Promise<void>
  sshEnabled: boolean
}

/**
 * 使用 Effect.acquireRelease 管理 SQL Server 连接池生命周期。
 */
export const makeSqlServerConnection = (
  params: ConnectParams
): Effect.Effect<SqlServerAdapterConnection, DatabaseConnectionError, Scope.Scope> =>
  Effect.gen(function* () {
    // SSH 隧道处理
    let tunnelPort: number | undefined
    let closeTunnel: (() => Promise<void>) | undefined

    if (params.sshEnabled) {
      const tunnel = yield* Effect.tryPromise({
        try: () => createSshTunnel({
          host: params.host ?? "localhost",
          port: String(params.port ?? 1433),
          database: params.database ?? "",
          username: params.username ?? "",
          password: params.password ?? "",
          sshEnabled: params.sshEnabled,
          sshHost: params.sshHost,
          sshPort: params.sshPort !== undefined ? String(params.sshPort) : undefined,
          sshUsername: params.sshUsername,
          sshPassword: params.sshPassword,
          sshPrivateKey: params.sshPrivateKey,
        }),
        catch: () => new DatabaseConnectionError({
          context: makeErrorContext("sqlserver.ssh"),
          host: sanitizeHost(params.sshHost),
          port: params.sshPort ?? 22,
          database: params.database ?? "",
          errorCode: "SSH_TUNNEL_FAILED",
          retrySuggestion: "请检查跳板机地址、端口及网络",
        })
      })
      tunnelPort = tunnel.localPort
      closeTunnel = tunnel.close
    }

    const maxPool = params.sshEnabled ? 2 : 6
    const dbRaw = params.database ? String(params.database).trim() : ""

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

    // acquireRelease ConnectionPool
    const pool = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const p = new sql.ConnectionPool(poolConfig)
          await p.connect()
          return p
        },
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("sqlserver.connect"),
          host: sanitizeHost(poolConfig.server),
          port: poolConfig.port ?? 1433,
          database: dbRaw || "(default)",
          errorCode: (e as any)?.code ?? (e as any)?.number?.toString(),
          retrySuggestion: params.sshEnabled ? "请确认数据库 host 为跳板机可访问的内网地址" : undefined,
        })
      }),
      (p) => Effect.promise(() => p.close().catch(() => {}))
    )

    return { pool, closeTunnel, sshEnabled: !!params.sshEnabled }
  })
