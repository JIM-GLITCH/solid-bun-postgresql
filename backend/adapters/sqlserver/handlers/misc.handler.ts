type Ss = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"

export const handleSqlServerDataTypes = (): Effect.Effect<
  { types: string[] },
  QueryExecutionError | SessionNotFoundError,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT DISTINCT name AS type
         FROM sys.types
         WHERE is_user_defined = 0
         ORDER BY name`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.dataTypes"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { types: result.recordset.map((r: any) => r.type) };
  });

export const handleSqlServerTableComment = (
  schema: string,
  table: string,
): Effect.Effect<{ comment: string | null }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT ep.value AS comment
         FROM sys.tables t
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         LEFT JOIN sys.extended_properties ep ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.name = 'MS_Description'
         WHERE s.name = @schema AND t.name = @table`,
        {
          input: { schema, table }
        }
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.tableComment"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { comment: result.recordset[0]?.comment || null };
  });
