type Ss = SessionStore | ConnectionId;



import { normalizeStatements, statementsToText } from "../../shared/query-utils"
import { runSqlServerQueryWithColumnMetadata } from "../../../sqlserver-mssql-query"
import { buildSqlServerGridColumnEditable } from "../../../sqlserver-column-editable"
import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession, optionalSqlServerSession } from "../../../services/SessionStore"
import { ColumnEditableInfo } from "../../../../shared/src"

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
  { rows: unknown[][]; columns: ColumnEditableInfo[]; hasMore: boolean },
  QueryExecutionError | SessionNotFoundError,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;
    const statements = normalizeStatements(sql);

    if (statements.length === 0) {
      return { rows: [], columns: [], hasMore: false };
    }

    const pool = sqlServerSession.backGroundPool;
    const sqlText = statements.join("; ");

    // arrayRowMode：返回行数组（与前端 `rows: any[][]` 及 PG/MySQL 一致），并携带 TDS 列元数据
    const { rows, columnMeta } = yield* Effect.tryPromise({
      try: () => runSqlServerQueryWithColumnMetadata(pool, sqlText, {
        trackRequest: (req) => { sqlServerSession.sqlServerActiveRequest = req; },
      }),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.queryStream.query"),
        sql: sanitizeSql(statementsToText(sql)),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const columns = yield* Effect.tryPromise({
      try: () => buildSqlServerGridColumnEditable(pool, columnMeta, sqlText),
      catch: () => [] as ColumnEditableInfo[],
    }).pipe(Effect.catch(() => Effect.succeed([] as ColumnEditableInfo[])));

    // 新 SQLServer 适配器为缓冲式（无 db/query-stream-more），一次性返回全部行
    void batchSize;
    return { rows, columns, hasMore: false };
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
