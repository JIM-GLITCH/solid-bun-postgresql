type Pg = SessionStore | ConnectionId;



import { getPostgresSchemas } from "../../shared/schema-utils"
import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentPostgresSession } from "../../../services/SessionStore"

export const handlePostgresSchemas = (): Effect.Effect<
  { schemas: string[] },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;
    const schemas = yield* getPostgresSchemas(pgSession.backGroundPool);

    return { schemas };
  });

export const handlePostgresTables = (
  schema: string,
): Effect.Effect<
  { tables: string[]; views: string[]; functions: Array<{ oid: number; schema: string; name: string; args: string }> },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`,
        [schema]
      ),
      catch: () => new Error("Failed to fetch tables"),
    });

    let functions: Array<{ oid: number; schema: string; name: string; args: string }> = [];
    try {
      const funcResult = yield* Effect.tryPromise({
        try: () => pgSession.backGroundPool.query(
          `SELECT p.oid, n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid JOIN pg_language l ON p.prolang = l.oid
           WHERE l.lanname = 'plpgsql' AND n.nspname = $1 ORDER BY p.proname`,
          [schema]
        ),
        catch: () => new Error("Failed to fetch functions"),
      });
      functions = funcResult.rows.map((r: any) => ({
        oid: r.oid,
        schema: r.schema,
        name: r.name,
        args: r.args || "",
      }));
    } catch {
      // 忽略函数查询错误
    }

    return {
      tables: result.rows.filter((r: any) => r.table_type === "BASE TABLE").map((r: any) => r.table_name),
      views: result.rows.filter((r: any) => r.table_type === "VIEW").map((r: any) => r.table_name),
      functions,
    };
  });

export const handlePostgresColumns = (
  schema: string,
  table: string,
): Effect.Effect<{ columns: unknown[] }, SessionNotFoundError | Error, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
         c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.identity_generation,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS pg_format_type
         FROM information_schema.columns c
         LEFT JOIN pg_catalog.pg_namespace ns ON ns.nspname = c.table_schema
         LEFT JOIN pg_catalog.pg_class cls
           ON cls.relnamespace = ns.oid AND cls.relname = c.table_name
           AND cls.relkind IN ('r', 'v', 'm', 'f', 'p')
         LEFT JOIN pg_catalog.pg_attribute a
           ON a.attrelid = cls.oid AND a.attname = c.column_name AND a.attnum > 0 AND NOT a.attisdropped
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch columns"),
    });

    return { columns: result.rows };
  });
