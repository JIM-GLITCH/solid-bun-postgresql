type My = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentMysqlSession } from "../../../services/SessionStore"

export const handleMysqlExecuteDdl = (
  sql: string,
): Effect.Effect<{ success: true }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(sql),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.executeDdl"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true };
  });

export const handleMysqlTableDdl = (
  schema: string,
  table: string,
): Effect.Effect<{ ddl: string }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SHOW CREATE TABLE \`${schema}\`.\`${table}\``
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.tableDdl"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { ddl: result[0]?.['Create Table'] ?? "" };
  });

export const handleMysqlFunctionDdl = (
  schema: string,
  functionName: string,
): Effect.Effect<{ ddl: string }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SHOW CREATE FUNCTION \`${schema}\`.\`${functionName}\``
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.functionDdl"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { ddl: result[0]?.['Create Function'] ?? "" };
  });

export const handleMysqlSchemaDump = (
  schema: string,
): Effect.Effect<{ dump: string }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const tablesResult = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [schema]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const viewsResult = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT table_name FROM information_schema.views WHERE table_schema = ? ORDER BY table_name`,
        [schema]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const functionsResult = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT routine_name AS name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'FUNCTION' ORDER BY routine_name`,
        [schema]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    let dump = `-- Schema: ${schema}\n\n`;

    for (const table of tablesResult) {
      const tableDdl = yield* handleMysqlTableDdl(schema, table.table_name);
      dump += tableDdl.ddl + ";\n\n";
    }

    for (const view of viewsResult) {
      const viewDdl = yield* handleMysqlTableDdl(schema, view.table_name);
      dump += viewDdl.ddl + ";\n\n";
    }

    for (const func of functionsResult) {
      const funcDdl = yield* handleMysqlFunctionDdl(schema, func.name);
      dump += funcDdl.ddl + ";\n\n";
    }

    return { dump };
  });

export const handleMysqlDatabaseDump = (): Effect.Effect<{ dump: string }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const schemasResult = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys') ORDER BY schema_name`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.databaseDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    let dump = "-- Database Dump\n\n";

    for (const schema of schemasResult) {
      const schemaDdl = yield* handleMysqlSchemaDump(schema.schema_name);
      dump += schemaDdl.dump + "\n";
    }

    return { dump };
  });
