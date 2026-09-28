type Ss = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"

export const handleSqlServerExplain = (
  query: string,
): Effect.Effect<any, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SET SHOWPLAN_TEXT ON; ${query}`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.explain"),
        sql: query,
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return result;
  });

export const handleSqlServerExplainText = (
  query: string,
): Effect.Effect<any, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SET SHOWPLAN_TEXT ON; ${query}`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.explainText"),
        sql: query,
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return result;
  });

export const handleSqlServerPartitionInfo = (
  schema: string,
  table: string,
): Effect.Effect<any, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT 
           p.partition_number,
           p.rows,
           a.type_desc,
           a.data_space_id
         FROM sys.partitions p
         JOIN sys.allocation_units a ON p.partition_id = a.container_id
         JOIN sys.tables t ON p.object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE s.name = '${schema}' AND t.name = '${table}'`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.partitionInfo"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return result;
  });

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
         WHERE s.name = '${schema}' AND t.name = '${table}'`
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
