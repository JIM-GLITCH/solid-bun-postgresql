/**
 * 连接层错误分类。
 *
 * 目标（Phase 3）：把「连接是否已死」的判断从**纯文案正则**改为**类型优先、正则为兜底**。
 *
 * 为什么需要：现状靠 `/not queryable|Connection terminated/` 之类的文案匹配决定是否重建连接，
 * 驱动升级或错误文案本地化后就会静默失效（不再重连或错误重连）。
 *
 * 当前进展（如实说明）：**分类外壳与判定入口已就位**，但驱动原始错误尚未在连接器内被包装成
 * `DbError`——因此实际判定当前仍走正则兜底分支。后续只需在连接器捕获处包一层
 * `toDbError(e, kind)` 即可让类型分支生效，判定逻辑无需再改。
 */

export type DbErrorKind =
  /** 连接已断开/不可用（可重连） */
  | "connection-lost"
  /** 建连失败（含隧道；可重试） */
  | "connect-failed"
  /** SQL 执行失败（不可重试） */
  | "query-failed"
  /** 超时（可重试） */
  | "timeout"
  /** 被取消 */
  | "cancelled"
  /** 会话不存在 */
  | "no-session"
  /** 方言不支持 */
  | "unsupported";

/** 连接层结构化错误：驱动原始错误经此包装后，判定不再依赖文案 */
export class DbError extends Error {
  readonly kind: DbErrorKind;
  readonly dbKind?: string;
  override readonly cause?: unknown;

  constructor(kind: DbErrorKind, message: string, options?: { dbKind?: string; cause?: unknown }) {
    super(message);
    this.name = "DbError";
    this.kind = kind;
    this.dbKind = options?.dbKind;
    this.cause = options?.cause;
  }
}

export function isDbError(e: unknown): e is DbError {
  return e instanceof DbError;
}

/** 把驱动原始错误包装为带 kind 的 DbError（供连接器捕获处调用） */
export function toDbError(kind: DbErrorKind, e: unknown, dbKind?: string): DbError {
  if (isDbError(e)) return e;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return new DbError(kind, message, { dbKind, cause: e });
}

/**
 * 各驱动「连接已死」的**兜底正则**（保留既有实现，逐字未改，避免行为变化）。
 * 仅在错误未经 `DbError` 包装时使用。
 */
const FALLBACK = {
  postgres: /not queryable|connection error|Connection terminated/i,
  mysql: /Connection lost|ECONNRESET|PROTOCOL_CONNECTION_LOST|not connected/i,
  sqlserver: /ECONNRESET|Connection lost|socket|timeout|closed|Failed to connect|broken/i,
} as const;

export type DialectKey = keyof typeof FALLBACK;

/**
 * 判断错误是否表示「连接已死，值得重建」。
 * 类型优先（`DbError.kind`），否则回退到该方言的文案正则。
 */
export function isConnectionLost(e: unknown, dialect: DialectKey): boolean {
  if (isDbError(e)) {
    return e.kind === "connection-lost" || e.kind === "timeout" || e.kind === "connect-failed";
  }
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return FALLBACK[dialect].test(msg);
}
