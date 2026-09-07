type Pg = SessionStore | ConnectionId;



import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentPostgresSession } from "../../../services/SessionStore"

export const handlePostgresIndexes = (
  schema: string,
  table: string,
): Effect.Effect<
  { indexes: Array<{ index_name: string; index_type: string; is_unique: boolean; is_primary: boolean; columns: string[] }> },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT
           i.relname AS index_name,
           am.amname AS index_type,
           ix.indisunique AS is_unique,
           ix.indisprimary AS is_primary,
           array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
         FROM pg_index ix
         JOIN pg_class c ON c.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(ix.indkey)
         WHERE n.nspname = $1 AND c.relname = $2
         GROUP BY i.relname, am.amname, ix.indisunique, ix.indisprimary
         ORDER BY i.relname`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch indexes"),
    });

    const toColsIdx = (v: unknown): string[] => {
      if (Array.isArray(v)) return v;
      if (v == null) return [];
      const s = String(v).trim();
      if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1).split(",").map((x) => x.trim());
      return [s];
    };

    return {
      indexes: result.rows.map((r: any) => ({
        ...r,
        columns: toColsIdx(r.columns),
      })),
    };
  });

export const handlePostgresPrimaryKeys = (
  schema: string,
  table: string,
): Effect.Effect<{ columns: string[] }, SessionNotFoundError | Error, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch primary keys"),
    });

    return { columns: result.rows.map((r: any) => r.column_name) };
  });

export const handlePostgresUniqueConstraints = (
  schema: string,
  table: string,
): Effect.Effect<
  { constraints: Array<{ name: string; type: string; columns: string[] }> },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT tc.constraint_name, tc.constraint_type,
         array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
         GROUP BY tc.constraint_name, tc.constraint_type`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch unique constraints"),
    });

    const toCols = (v: unknown): string[] => {
      if (Array.isArray(v)) return v;
      if (v == null) return [];
      const s = String(v).trim();
      if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1).split(",").map((x) => x.trim());
      return [s];
    };

    return {
      constraints: result.rows.map((r: any) => ({
        name: r.constraint_name,
        type: r.constraint_type,
        columns: toCols(r.columns),
      })),
    };
  });

export const handlePostgresCheckConstraints = (
  schema: string,
  table: string,
): Effect.Effect<
  { checkConstraints: Array<{ name: string; definition: string }> },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS definition
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE con.contype = 'c' AND n.nspname = $1 AND c.relname = $2`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch check constraints"),
    });

    return {
      checkConstraints: result.rows.map((r: any) => ({
        name: r.name,
        definition: r.definition,
      })),
    };
  });

export const handlePostgresForeignKeys = (
  schema: string,
  table: string,
): Effect.Effect<
  { foreignKeys: Array<{ columnName: string; referencedSchema: string; referencedTable: string; referencedColumn: string }> },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT
           kcu.column_name,
           ccu.table_schema AS referenced_schema,
           ccu.table_name AS referenced_table,
           ccu.column_name AS referenced_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch foreign keys"),
    });

    return {
      foreignKeys: result.rows.map((r: any) => ({
        columnName: r.column_name,
        referencedSchema: r.referenced_schema,
        referencedTable: r.referenced_table,
        referencedColumn: r.referenced_column,
      })),
    };
  });
