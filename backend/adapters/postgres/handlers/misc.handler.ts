type Pg = SessionStore | ConnectionId;



import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentPostgresSession } from "../../../services/SessionStore"

export const handlePostgresExplain = (
  sql: string,
): Effect.Effect<{ plan: unknown }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(`EXPLAIN (FORMAT JSON) ${sql}`),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.explain"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { plan: result.rows[0]?.["QUERY PLAN"] };
  });

export const handlePostgresExplainText = (
  sql: string,
): Effect.Effect<{ plan: string }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(`EXPLAIN (FORMAT TEXT) ${sql}`),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.explainText"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { plan: result.rows.map((r: any) => r["QUERY PLAN"]).join("\n") };
  });

export const handlePostgresPartitionInfo = (
  schema: string,
  table: string,
): Effect.Effect<
  { partitions: Array<{ name: string; definition: string; rowCount?: number }> },
  QueryExecutionError | SessionNotFoundError,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT
           child.relname AS name,
           pg_get_expr(child.relpartbound, child.oid) AS definition,
           (SELECT COUNT(*) FROM pg_class WHERE oid = child.oid) AS row_count
         FROM pg_inherits
         JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
         JOIN pg_class child ON pg_inherits.inhrelid = child.oid
         JOIN pg_namespace n ON parent.relnamespace = n.oid
         WHERE n.nspname = $1 AND parent.relname = $2
         ORDER BY child.relname`,
        [schema, table]
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.partitionInfo"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return {
      partitions: result.rows.map((r: any) => ({
        name: r.name,
        definition: r.definition,
        rowCount: r.row_count,
      })),
    };
  });

export const handlePostgresDataTypes = (): Effect.Effect<
  { dataTypes: Array<{ name: string; description: string }> },
  QueryExecutionError | SessionNotFoundError,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT DISTINCT pg_catalog.format_type(t.oid, NULL) AS name,
                COALESCE(pg_catalog.obj_description(t.oid, 'pg_type'), '') AS description
         FROM pg_catalog.pg_type t
         LEFT JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
         WHERE (t.typrelid = 0 OR (SELECT c.relkind = 'c' FROM pg_catalog.pg_class c WHERE c.oid = t.typrelid))
           AND n.nspname NOT IN ('pg_catalog', 'information_schema')
           AND pg_catalog.format_type(t.oid, NULL) IS NOT NULL
         ORDER BY name
         LIMIT 100`
      ),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.dataTypes"),
        sql: "",
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return {
      dataTypes: result.rows.map((r: any) => ({
        name: r.name,
        description: r.description,
      })),
    };
  });

export const handlePostgresTableComment = (
  schema: string,
  table: string,
  comment?: string,
): Effect.Effect<{ success: true }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const sql = comment
      ? `COMMENT ON TABLE "${schema}"."${table}" IS '${comment.replace(/'/g, "''")}'`
      : `COMMENT ON TABLE "${schema}"."${table}" IS NULL`;

    yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(sql),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.tableComment"),
        sql,
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true };
  });
