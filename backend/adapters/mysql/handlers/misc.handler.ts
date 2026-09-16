type My = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentMysqlSession } from "../../../services/SessionStore"

export const handleMysqlExplain = (
  query: string,
): Effect.Effect<{ plan: unknown }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(`EXPLAIN FORMAT=JSON ${query}`),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.explain"),
        sql: sanitizeSql(query),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { plan: result[0] };
  });

export const handleMysqlExplainText = (
  query: string,
): Effect.Effect<{ lines: string[] }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(`EXPLAIN ${query}`),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.explainText"),
        sql: sanitizeSql(query),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { lines: result.map((r: any) => JSON.stringify(r)) };
  });

export const handleMysqlPartitionInfo = (
  schema: string,
  table: string,
): Effect.Effect<
  { role: "none" },
  QueryExecutionError | SessionNotFoundError,
  My
> =>
  Effect.gen(function* () {
    // MySQL partition info is complex, return none for now
    return { role: "none" };
  });

export const handleMysqlDataTypes = (): Effect.Effect<
  { types: string[] },
  QueryExecutionError | SessionNotFoundError,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT DISTINCT DATA_TYPE FROM information_schema.COLUMNS ORDER BY DATA_TYPE`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.dataTypes"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { types: result.map((r: any) => r.DATA_TYPE) };
  });

export const handleMysqlTableComment = (
  schema: string,
  table: string,
): Effect.Effect<{ comment: string | null }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [schema, table]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.tableComment"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { comment: result[0]?.TABLE_COMMENT || null };
  });
