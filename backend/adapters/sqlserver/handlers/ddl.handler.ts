type Ss = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"

export const handleSqlServerExecuteDdl = (
  sql: string,
): Effect.Effect<{ success: true }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(sql),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.executeDdl"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true };
  });

export const handleSqlServerTableDdl = (
  schema: string,
  table: string,
): Effect.Effect<{ ddl: string }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT 
           Definition
         FROM sys.objects o
         JOIN sys.schemas s ON o.schema_id = s.schema_id
         WHERE s.name = @schema AND o.name = @table AND o.type = 'U'`,
        {
          input: { schema, table }
        }
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.tableDdl"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { ddl: result.recordset[0]?.Definition ?? "" };
  });

export const handleSqlServerFunctionDdl = (
  schema: string,
  functionName: string,
): Effect.Effect<{ ddl: string }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT 
           OBJECT_DEFINITION(o.object_id) AS ddl
         FROM sys.objects o
         JOIN sys.schemas s ON o.schema_id = s.schema_id
         WHERE s.name = @schema AND o.name = @functionName AND o.type IN ('FN', 'IF', 'TF')`,
        {
          input: { schema, functionName }
        }
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.functionDdl"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { ddl: result.recordset[0]?.ddl ?? "" };
  });

export const handleSqlServerSchemaDump = (
  schema: string,
): Effect.Effect<{ dump: string }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const tablesResult = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT TABLE_NAME AS table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = @schema AND TABLE_TYPE = 'BASE TABLE' ORDER BY table_name`,
        {
          input: { schema }
        }
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const viewsResult = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT TABLE_NAME AS table_name FROM information_schema.VIEWS WHERE TABLE_SCHEMA = @schema ORDER BY table_name`,
        {
          input: { schema }
        }
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const functionsResult = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT o.name AS name FROM sys.objects o JOIN sys.schemas s ON o.schema_id = s.schema_id WHERE s.name = @schema AND o.type IN ('FN', 'IF', 'TF') ORDER BY o.name`,
        {
          input: { schema }
        }
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    let dump = `-- Schema: ${schema}\n\n`;

    for (const table of tablesResult.recordset) {
      const tableDdl = yield* handleSqlServerTableDdl(schema, table.table_name);
      dump += tableDdl.ddl + ";\n\n";
    }

    for (const view of viewsResult.recordset) {
      const viewDdl = yield* handleSqlServerTableDdl(schema, view.table_name);
      dump += viewDdl.ddl + ";\n\n";
    }

    for (const func of functionsResult.recordset) {
      const funcDdl = yield* handleSqlServerFunctionDdl(schema, func.name);
      dump += funcDdl.ddl + ";\n\n";
    }

    return { dump };
  });

export const handleSqlServerDatabaseDump = (): Effect.Effect<{ dump: string }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const schemasResult = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('sys', 'information_schema', 'guest', 'INFORMATION_SCHEMA') ORDER BY schema_name`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.databaseDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    let dump = "-- Database Dump\n\n";

    for (const schema of schemasResult.recordset) {
      const schemaDdl = yield* handleSqlServerSchemaDump(schema.schema_name);
      dump += schemaDdl.dump + "\n";
    }

    return { dump };
  });
