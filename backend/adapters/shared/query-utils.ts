import { Effect } from "effect"
import { getSqlSegments } from "../../../shared/src/sql-split"

export const parseSqlStatements = (sql: string): string[] => {
  const trimmed = (sql ?? "").trim();
  if (!trimmed) return [];
  return getSqlSegments(trimmed, { blankLineSeparator: false })
    .map((seg) => trimmed.slice(seg.start, seg.end).trim())
    .filter(Boolean);
};

/**
 * 归一化查询输入：前端 `db/query-stream` 可传 `query`（未分句字符串）
 * 或 `statements`（已分句数组）。传数组时直接使用、不再分句（与前端约定一致，
 * 避免重复计算与二次分句误差）；传字符串时走 parseSqlStatements。
 * 对 undefined/null 安全，返回空数组而非抛错。
 */
export const normalizeStatements = (
  input: string | string[] | undefined | null
): string[] => {
  if (Array.isArray(input)) {
    return input.map((s) => String(s ?? "").trim()).filter(Boolean);
  }
  return parseSqlStatements(typeof input === "string" ? input : "");
};

/** 把查询输入归一为用于日志/错误展示的 SQL 文本 */
export const statementsToText = (
  input: string | string[] | undefined | null
): string =>
  Array.isArray(input) ? input.join("; ") : typeof input === "string" ? input : "";

export const executeWithRetry = <A, E>(
  fn: () => Effect.Effect<A, E>,
  isRecoverable: (error: unknown) => boolean,
  recover: () => Effect.Effect<void, never>
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return yield* fn();
      } catch (e) {
        lastError = e;
        if (attempt === 0 && isRecoverable(e)) {
          yield* recover();
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  });

export const isPgUserClientDeadError = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /not queryable|connection error|Connection terminated/i.test(msg);
};

export const isMysqlUserClientDeadError = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /Connection lost|ECONNRESET|PROTOCOL_CONNECTION_LOST|not connected/i.test(msg);
};

export const isSqlServerPoolDeadError = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /ECONNRESET|Connection lost|socket|timeout|closed|Failed to connect|broken/i.test(msg);
};

export const mysqlBacktickIdent = (id: string): string => {
  return "`" + id.replace(/`/g, "``") + "`";
};

export const toRowArray = (raw: unknown): unknown[][] => {
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray((raw as unknown[])[0])) {
    return raw as unknown[][];
  }
  return [];
};

export const splitGroupConcat = (cols: unknown): string[] => {
  if (cols == null) return [];
  if (Array.isArray(cols)) return cols.map(String);
  const s = String(cols).trim();
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
};

export const mysqlRowLowerKeys = (row: Record<string, unknown>): Record<string, unknown> => {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    o[k.toLowerCase()] = v;
  }
  return o;
};
