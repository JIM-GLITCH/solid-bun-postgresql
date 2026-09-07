type Ss = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"
import {
  sqlServerFetchEstimatedPlanXml,
  sqlServerFetchExplainTextLines,
  sqlServerFetchPartitionInfo,
  type SqlServerPartitionInfoResult,
} from "../../../sqlserver-support"

/** 与 sqlServerFetchExplainTextLines 空结果占位符保持一致，用于过滤 */
const SHOWPLAN_EMPTY_PLACEHOLDER = "（无 SHOWPLAN 行；可能仅含 SET 语句或批处理为空）";

/**
 * db/explain：优先 SHOWPLAN_XML（估算计划），无结果时回退 SHOWPLAN_ALL 文本。
 * 返回结构与前端 `explainQuery` 契约一致：`{ plan: [{ Plan, Format }] }`。
 */
export const handleSqlServerExplain = (
  query: string,
): Effect.Effect<
  { plan: Array<{ Plan: string; Format: string }> },
  QueryExecutionError | SessionNotFoundError | Error,
  Ss
> =>
  Effect.gen(function* () {
    const session = yield* currentSqlServerSession;
    const pool = session.backGroundPool;

    const xml = yield* Effect.tryPromise({
      try: () => sqlServerFetchEstimatedPlanXml(pool, query),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.explain"),
        sql: sanitizeSql(query),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });
    if (xml.trim()) {
      return { plan: [{ Plan: xml, Format: "mssql-showplan-xml" }] };
    }

    const lines = yield* Effect.tryPromise({
      try: () => sqlServerFetchExplainTextLines(pool, query),
      catch: () => void 0,
    }).pipe(Effect.catch(() => Effect.succeed([] as string[])));
    const text = lines
      .filter((l) => l.trim() && l.trim() !== SHOWPLAN_EMPTY_PLACEHOLDER)
      .join("\n")
      .trim();
    if (text.length > 0) {
      return { plan: [{ Plan: text, Format: "mssql-showplan-all" }] };
    }

    const stmts = query
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const useOnly = stmts.length === 1 && /^\s*USE\s/i.test(stmts[0]!);
    return yield* Effect.fail(
      new Error(
        useOnly
          ? "USE 语句无法生成 SHOWPLAN_XML；请对 SELECT/INSERT/UPDATE/DELETE 等使用解释分析（多语句时用分号分隔，将自动跳过开头的 USE）。"
          : "未能取得执行计划：SHOWPLAN_XML 与 SHOWPLAN_ALL 均无可用输出。该批处理可能不支持估算计划（如部分 DDL），请改为单条 SELECT 验证。"
      )
    );
  });

/** db/explain-text：SHOWPLAN_ALL 文本行，返回 `{ lines }`。 */
export const handleSqlServerExplainText = (
  query: string,
): Effect.Effect<
  { lines: string[] },
  QueryExecutionError | SessionNotFoundError,
  Ss
> =>
  Effect.gen(function* () {
    const session = yield* currentSqlServerSession;

    const lines = yield* Effect.tryPromise({
      try: () => sqlServerFetchExplainTextLines(session.backGroundPool, query),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.explainText"),
        sql: sanitizeSql(query),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { lines };
  });

/** db/partition-info：分区元数据，返回 role=none/parent 结构（与前端 getPartitionInfo 契约一致）。 */
export const handleSqlServerPartitionInfo = (
  schema: string,
  table: string,
): Effect.Effect<
  SqlServerPartitionInfoResult,
  QueryExecutionError | SessionNotFoundError,
  Ss
> =>
  Effect.gen(function* () {
    const session = yield* currentSqlServerSession;

    return yield* Effect.tryPromise({
      try: () => sqlServerFetchPartitionInfo(session.backGroundPool, schema, table),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.partitionInfo"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });
  });
