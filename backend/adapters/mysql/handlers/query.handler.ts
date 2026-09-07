type My = SessionStore | ConnectionId;



import { normalizeStatements, statementsToText } from "../../shared/query-utils"
import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentMysqlSession, optionalMysqlSession } from "../../../services/SessionStore"

export const handleMysqlQuery = (
  sql: string | string[],
): Effect.Effect<
  { rows: unknown[]; columns: string[]; rowCount: number },
  QueryExecutionError | SessionNotFoundError,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;
    const statements = normalizeStatements(sql);

    if (statements.length === 0) {
      return { rows: [], columns: [], rowCount: 0 };
    }

    // 执行查询
    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.userUsedClient.query(statements.join("; ")),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.query"),
        sql: sanitizeSql(statementsToText(sql)),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const [rows, fields] = result as any[];

    return {
      rows: Array.isArray(rows) ? rows : [],
      columns: fields?.map((f: any) => f.name) ?? [],
      rowCount: Array.isArray(rows) ? rows.length : 0,
    };
  });

export const handleMysqlQueryStream = (
  sql: string | string[],
  batchSize: number,
): Effect.Effect<
  { rows: unknown[]; columns: string[]; hasMore: boolean },
  QueryExecutionError | SessionNotFoundError,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;
    const statements = normalizeStatements(sql);

    if (statements.length === 0) {
      return { rows: [], columns: [], hasMore: false };
    }

    // 使用流式查询
    const connection = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.getConnection(),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.queryStream.getConnection"),
        sql: sanitizeSql(statementsToText(sql)),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    try {
      const [rows, fields] = yield* Effect.tryPromise({
        try: () => connection.query(statements.join("; ")),
        catch: (e) => new QueryExecutionError({
          context: makeErrorContext("mysql.queryStream.query"),
          sql: sanitizeSql(statementsToText(sql)),
          databaseErrorCode: (e as any)?.code,
          databaseErrorMessage: (e as Error)?.message,
        }),
      });

      return {
        rows: Array.isArray(rows) ? rows.slice(0, batchSize) : [],
        columns: (fields as any[])?.map((f: any) => f.name) ?? [],
        hasMore: Array.isArray(rows) && rows.length > batchSize,
      };
    } finally {
      connection.release();
    }
  });

export const handleMysqlCancel = (): Effect.Effect<void, never, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* optionalMysqlSession;
    if (!mysqlSession) return;

    if (mysqlSession.mysqlRunningThreadId) {
      yield* Effect.tryPromise({
        try: () => mysqlSession.backGroundPool.query(`KILL QUERY ${mysqlSession.mysqlRunningThreadId}`),
        catch: () => void 0,
      }).pipe(Effect.catch(() => Effect.void));
    }
  });
