/**
 * PostgreSQL Effect Adapter
 *
 * 将现有 connect-postgres.ts 的逻辑用 Effect 重新包装，提供 Effect 风格的 API。
 * 原文件保留用于向后兼容。
 *
 * Validates: Requirements 2.1, 12.1
 */

import { Effect, Scope } from "effect"
import { Client, Pool, types } from "pg"
import { DatabaseConnectionError, makeErrorContext } from "../../core/errors"
import { sanitizeHost } from "../../core/sanitize"
import type { ConnectParams } from "../shared/types"
import type { SshTunnelService } from "../../services/SshTunnelService"
import { createSshTunnel } from "../../ssh-tunnel"

// 日期时间类型以字符串返回，避免 JS Date 丢失微秒精度
// OID: 1082=date, 1083=time, 1266=timetz, 1114=timestamp, 1184=timestamptz, 1186=interval
const keepString = (v: string) => v
;[1082, 1083, 1266, 1114, 1184, 1186].forEach((oid) => types.setTypeParser(oid, keepString))

/**
 * Effect 风格的 Postgres 连接结果，包含 client、pool 及可选的隧道关闭函数。
 */
export interface PostgresAdapterConnection {
  /** pg.Client：用于单次查询（游标、keepalive 等） */
  readonly client: Client
  /** pg.Pool：用于后台/并发查询 */
  readonly pool: Pool
  /** 关闭 SSH 隧道（若启用了 SSH） */
  readonly closeTunnel?: () => Promise<void>
  /** 是否通过 SSH 隧道，影响池大小等配置 */
  readonly sshEnabled: boolean
}

/**
 * 使用 Effect.acquireRelease 管理 Postgres 连接生命周期。
 *
 * - 若 `params.sshEnabled` 为 true，先通过原生 `createSshTunnel` 建立本地端口转发；
 * - 然后创建 `pg.Client`（用于用户查询）和 `pg.Pool`（用于后台操作），均注册到 Scope；
 * - Scope 释放时自动关闭 client、pool 和 SSH 隧道（若有）。
 *
 * 依赖：`SshTunnelService`（通过 Effect Context 注入，但当前实现直接调用原 createSshTunnel
 * 以兼容现有代码；后续可切换到 SshTunnelService.createTunnel）。
 *
 * Validates: Requirements 2.1, 2.2, 12.1, 12.4
 */
export const makePostgresConnection = (
  params: ConnectParams,
): Effect.Effect<
  PostgresAdapterConnection,
  DatabaseConnectionError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    // ── 1. SSH 隧道（可选） ──────────────────────────────────────────────────
    let tunnelPort: number | undefined
    let closeTunnel: (() => Promise<void>) | undefined

    if (params.sshEnabled) {
      const tunnel = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            createSshTunnel({
              host: params.host ?? "localhost",
              port: params.port ?? 5432,
              database: params.database,
              username: params.username,
              password: params.password,
              sshEnabled: params.sshEnabled,
              sshHost: params.sshHost,
              sshPort: params.sshPort,
              sshUsername: params.sshUsername,
              sshPassword: params.sshPassword,
              sshPrivateKey: params.sshPrivateKey,
            } as any),
          catch: (e) => {
            const msg = (e as any)?.message ?? String(e)
            const isTimeout = /timeout|expired|timed out/i.test(msg)
            return new DatabaseConnectionError({
              context: makeErrorContext("postgres.ssh"),
              host: sanitizeHost(params.sshHost),
              port: params.sshPort ?? 22,
              database: params.database ?? "postgres",
              errorCode: "SSH_TUNNEL_FAILED",
              retrySuggestion: isTimeout
                ? "SSH 隧道连接超时，请检查跳板机地址、端口及网络"
                : "请检查跳板机地址、端口及网络",
            })
          },
        }),
        (t) => Effect.promise(() => t.close().catch(() => {})),
      )

      tunnelPort = tunnel.localPort
      closeTunnel = tunnel.close
    }

    // ── 2. pg 连接配置 ──────────────────────────────────────────────────────
    const dbName = String(params.database ?? "").trim()
    const pgConfig = {
      // SSH 模式下 host 为 undefined，pg 默认连 127.0.0.1（与 Antares 一致）
      host: tunnelPort !== undefined ? undefined : (params.host ?? "localhost"),
      port: tunnelPort ?? (params.port ?? 5432),
      database: dbName || params.username || "postgres",
      user: params.username,
      password: params.password ?? "",
      connectionTimeoutMillis: params.sshEnabled ? 30000 : 10000,
    }

    // ── 3. pg.Client（acquireRelease） ──────────────────────────────────────
    const client = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          const c = new Client(pgConfig)
          await c.connect()
          return c
        },
        catch: (e) => {
          const msg = (e as any)?.message ?? String(e)
          const isTimeout = /timeout|expired/i.test(msg)
          return new DatabaseConnectionError({
            context: makeErrorContext("postgres.connect"),
            host: sanitizeHost(pgConfig.host),
            port: pgConfig.port,
            database: pgConfig.database,
            errorCode: (e as any)?.code,
            retrySuggestion:
              params.sshEnabled && isTimeout
                ? "数据库连接超时，请确认数据库 host 为跳板机可访问的地址（如内网 IP 或 localhost）"
                : undefined,
          })
        },
      }),
      (c) => Effect.promise(() => c.end().catch(() => {})),
    )

    // ── 4. pg.Pool（acquireRelease） ────────────────────────────────────────
    const pool = yield* Effect.acquireRelease(
      Effect.sync(
        () =>
          new Pool({
            ...pgConfig,
            // SSH 隧道下限制连接池大小，避免耗尽隧道端口
            max: params.sshEnabled ? 2 : 6,
            idleTimeoutMillis: 30000,
          }),
      ),
      (p) => Effect.promise(() => p.end().catch(() => {})),
    )

    return {
      client,
      pool,
      closeTunnel,
      sshEnabled: !!params.sshEnabled,
    } satisfies PostgresAdapterConnection
  })
