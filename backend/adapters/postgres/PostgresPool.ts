/**
 * PostgreSQL Effect Pool
 *
 * 基于 Effect.acquireRelease 管理 pg.Pool 的生命周期。
 * 提供健康检查和连接配置工厂函数。
 *
 * Validates: Requirements 12.1
 */

import { Effect, Scope } from "effect"
import { Pool } from "pg"
import { DatabaseConnectionError, makeErrorContext } from "../../core/errors"
import { sanitizeHost } from "../../core/sanitize"

/**
 * pg.Pool 所需的最小连接配置（与 connect-postgres.ts 的 DbConfig 对齐）。
 */
export interface PoolConfig {
  host?: string
  port: number
  database: string
  user?: string
  password?: string
  connectionTimeoutMillis?: number
  /** 最大连接数；SSH 隧道下建议设为 2 */
  max?: number
  /** 空闲连接超时（毫秒） */
  idleTimeoutMillis?: number
}

/**
 * 使用 Effect.acquireRelease 创建并管理 pg.Pool 的生命周期。
 *
 * - Scope 关闭时自动调用 `pool.end()`，等待所有连接安全释放；
 * - 若 `pool.end()` 抛出异常，静默吞掉（避免资源清理阶段二次失败）。
 *
 * Validates: Requirements 2.1, 12.1
 */
export const makePostgresPool = (
  config: PoolConfig,
): Effect.Effect<Pool, DatabaseConnectionError, Scope.Scope> =>
  Effect.acquireRelease(
    // Acquire：同步创建 Pool 实例（pg.Pool 构造函数不连接，仅初始化）
    Effect.sync(() => new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password ?? "",
      connectionTimeoutMillis: config.connectionTimeoutMillis ?? 10000,
      max: config.max ?? 6,
      idleTimeoutMillis: config.idleTimeoutMillis ?? 30000,
    })),
    // Release：关闭所有连接
    (pool) => Effect.promise(() => pool.end().catch(() => {})),
  )

/**
 * 对 pg.Pool 执行轻量健康检查：通过 `SELECT 1` 验证至少一个连接可用。
 *
 * - 成功：返回 `true`
 * - 失败：返回封装好的 `DatabaseConnectionError`
 *
 * Validates: Requirements 12.1
 */
export const checkPoolHealth = (
  pool: Pool,
  host: string | undefined,
  port: number,
  database: string,
): Effect.Effect<boolean, DatabaseConnectionError> =>
  Effect.tryPromise({
    try: async () => {
      await pool.query("SELECT 1 --healthcheck")
      return true
    },
    catch: (e) =>
      new DatabaseConnectionError({
        context: makeErrorContext("postgres.pool.healthcheck"),
        host: sanitizeHost(host),
        port,
        database,
        errorCode: (e as any)?.code,
        retrySuggestion: "连接池健康检查失败，请确认数据库服务正常运行",
      }),
  })

/**
 * 根据连接参数和 SSH 状态，返回推荐的连接池最大连接数。
 *
 * - SSH 隧道下：2（隧道资源有限，避免耗尽端口）
 * - 直连模式：6（默认值，适合大多数场景）
 *
 * Validates: Requirements 12.4
 */
export function getRecommendedPoolSize(sshEnabled: boolean): number {
  return sshEnabled ? 2 : 6
}
