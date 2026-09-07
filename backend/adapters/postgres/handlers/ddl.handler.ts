type Pg = SessionStore | ConnectionId;



import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentPostgresSession } from "../../../services/SessionStore"

export const handlePostgresExecuteDdl = (
  sql: string,
): Effect.Effect<{ success: true }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(sql),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.executeDdl"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true };
  });

export const handlePostgresTableDdl = (
  schema: string,
  table: string,
): Effect.Effect<{ ddl: string }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT pg_get_tabledef($1, $2)`,
        [schema, table]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.tableDdl"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { ddl: result.rows[0]?.pg_get_tabledef ?? "" };
  });

export const handlePostgresFunctionDdl = (
  schema: string,
  functionName: string,
): Effect.Effect<{ ddl: string }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT pg_get_functiondef(p.oid) AS ddl
         FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = $1 AND p.proname = $2`,
        [schema, functionName]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.functionDdl"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { ddl: result.rows[0]?.ddl ?? "" };
  });

export const handlePostgresSchemaDump = (
  schema: string,
): Effect.Effect<{ dump: string }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const tablesResult = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [schema]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const viewsResult = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`,
        [schema]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const functionsResult = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT p.proname AS name, pg_get_functiondef(p.oid) AS ddl
         FROM pg_proc p
         JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = $1 AND p.prokind = 'f'
         ORDER BY p.proname`,
        [schema]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.schemaDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    let dump = `-- Schema: ${schema}\n\n`;

    for (const table of tablesResult.rows) {
      const tableDdl = yield* handlePostgresTableDdl(schema, table.table_name);
      dump += tableDdl.ddl + ";\n\n";
    }

    for (const view of viewsResult.rows) {
      const viewDdl = yield* handlePostgresTableDdl(schema, view.table_name);
      dump += viewDdl.ddl + ";\n\n";
    }

    for (const func of functionsResult.rows) {
      dump += func.ddl + ";\n\n";
    }

    return { dump };
  });

export const handlePostgresDatabaseDump = (): Effect.Effect<{ dump: string }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const schemasResult = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.databaseDump"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    let dump = "-- Database Dump\n\n";

    for (const schema of schemasResult.rows) {
      const schemaDdl = yield* handlePostgresSchemaDump(schema.schema_name);
      dump += schemaDdl.dump + "\n";
    }

    return { dump };
  });
