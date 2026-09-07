type Ss = SessionStore | ConnectionId;



import { normalizeStatements, statementsToText } from "../../shared/query-utils"
import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession, optionalSqlServerSession } from "../../../services/SessionStore"

export const handleSqlServerQuery = (
  sql: string | string[],
): Effect.Effect<
  { rows: unknown[]; columns: string[]; rowCount: number },
  QueryExecutionError | SessionNotFoundError,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;
    const statements = normalizeStatements(sql);

    if (statements.length === 0) {
      return { rows: [], columns: [], rowCount: 0 };
    }

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.userUsedClient.request().query(statements.join("; ")),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.query"),
        sql: sanitizeSql(statementsToText(sql)),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return {
      rows: result.recordset ?? [],
      columns: result.recordset?.columns ? Object.keys(result.recordset.columns) : [],
      rowCount: result.recordset?.length ?? 0,
    };
  });

export const handleSqlServerQueryStream = (
  sql: string | string[],
  batchSize: number,
): Effect.Effect<
  { rows: unknown[]; columns: string[]; hasMore: boolean },
  QueryExecutionError | SessionNotFoundError,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;
    const statements = normalizeStatements(sql);

    if (statements.length === 0) {
      return { rows: [], columns: [], hasMore: false };
    }

    const request = sqlServerSession.userUsedClient.request();
    const result = yield* Effect.tryPromise({
      try: () => request.query(statements.join("; ")),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.queryStream.query"),
        sql: sanitizeSql(statementsToText(sql)),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return {
      rows: result.recordset?.slice(0, batchSize) ?? [],
      columns: result.recordset?.columns ? Object.keys(result.recordset.columns) : [],
      hasMore: (result.recordset?.length ?? 0) > batchSize,
    };
  });

export const handleSqlServerCancel = (): Effect.Effect<void, never, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* optionalSqlServerSession;
    if (!sqlServerSession) return;

    if (sqlServerSession.sqlServerActiveRequest) {
      yield* Effect.sync(() => {
        try {
          sqlServerSession.sqlServerActiveRequest?.cancel();
        } catch {
          /* 取消失败不影响主流程 */
        }
      });
    }
  });
