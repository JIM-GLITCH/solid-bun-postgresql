import { DatabaseConnectionError, makeErrorContext } from "../../core/errors"
import { sanitizeHost } from "../../core/sanitize"
import { Effect, Scope } from "effect"
import type { ConnectParams } from "../shared/types"
import { createSshTunnel } from "../../ssh-tunnel"
import mysql from "mysql2/promise"

export interface MysqlAdapterConnection {
  pool: import("mysql2/promise").Pool
  connection: import("mysql2/promise").PoolConnection
  closeTunnel?: () => Promise<void>
  sshEnabled: boolean
}

/**
 * 使用 Effect.acquireRelease 管理 MySQL 连接生命周期。
 * Scope 释放时自动关闭 connection、pool 和 SSH 隧道（若有）。
 */
export const makeMysqlConnection = (
  params: ConnectParams
): Effect.Effect<MysqlAdapterConnection, DatabaseConnectionError, Scope.Scope> =>
  Effect.gen(function* () {
    // SSH 隧道处理
    let tunnelPort: number | undefined
    let closeTunnel: (() => Promise<void>) | undefined

    if (params.sshEnabled) {
      const tunnel = yield* Effect.tryPromise({
        try: () => createSshTunnel({
          host: params.host ?? "localhost",
          port: String(params.port ?? 3306),
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
        catch: (_e) => new DatabaseConnectionError({
          context: makeErrorContext("mysql.ssh"),
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

    const mysqlConfig = {
      host: tunnelPort ? undefined : (params.host ?? "localhost"),
      port: tunnelPort ?? (params.port ?? 3306),
      database: params.database ? String(params.database).trim() : undefined,
      user: params.username,
      password: params.password ?? "",
      connectTimeout: params.sshEnabled ? 30000 : 10000,
    }

    // acquireRelease pool
    const pool = yield* Effect.acquireRelease(
      Effect.sync(() => {
        return mysql.createPool({
          ...mysqlConfig,
          waitForConnections: true,
          connectionLimit: params.sshEnabled ? 2 : 6,
          queueLimit: 0,
        })
      }),
      (p) => Effect.promise(() => p.end().catch(() => {}))
    )

    // acquireRelease connection（从 pool 获取）
    const connection = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: (): Promise<mysql.PoolConnection> => pool.getConnection(),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("mysql.connect"),
          host: sanitizeHost(mysqlConfig.host),
          port: mysqlConfig.port,
          database: mysqlConfig.database ?? "",
          errorCode: (e as any)?.code,
          retrySuggestion: params.sshEnabled ? "请确认数据库 host 为跳板机可访问的内网地址" : undefined,
        })
      }),
      (conn) => Effect.sync(() => { try { conn.release() } catch {} })
    )

    return { pool, connection, closeTunnel, sshEnabled: !!params.sshEnabled }
  })
