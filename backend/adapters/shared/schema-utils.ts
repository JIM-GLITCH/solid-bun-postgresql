import { Effect } from "effect"

export const getPostgresSchemas = (
  pool: { query: (sql: string) => Promise<{ rows: Array<{ schema_name: string }> }> },
  schema?: string
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    if (schema) {
      return [schema];
    }

    const result = yield* Effect.tryPromise({
      try: () => pool.query(
        `SELECT schema_name
         FROM information_schema.schemata
         WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'
         ORDER BY schema_name
         LIMIT 2`
      ),
      catch: () => new Error("Failed to fetch schemas"),
    });

    return result.rows.map((r) => r.schema_name);
  });

export const getPostgresTables = (
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ table_name: string }> }> },
  schema: string
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'
         ORDER BY table_name
         LIMIT 6`,
        [schema]
      ),
      catch: () => new Error("Failed to fetch tables"),
    });

    return result.rows.map((r) => r.table_name);
  });

export const getPostgresColumns = (
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ column_name: string; data_type: string }> }> },
  schema: string,
  table: string
): Effect.Effect<Array<{ name: string; type: string }>, Error> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position
         LIMIT 12`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch columns"),
    });

    return result.rows.map((r) => ({ name: r.column_name, type: r.data_type }));
  });

export const getMysqlSchemas = (
  pool: { query: (sql: string) => Promise<any> },
  schema?: string
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    if (schema) {
      return [schema];
    }

    const result = yield* Effect.tryPromise({
      try: () => pool.query(
        `SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA
         WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')
         ORDER BY SCHEMA_NAME LIMIT 2`
      ),
      catch: () => new Error("Failed to fetch schemas"),
    });

    const [rows] = result as any[];
    return rows.map((r: any) => String(r.SCHEMA_NAME ?? "")).filter(Boolean);
  });

export const getMysqlTables = (
  pool: { query: (sql: string, params?: unknown[]) => Promise<any> },
  schema: string
): Effect.Effect<string[], Error> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => pool.query(
        `SELECT TABLE_NAME AS table_name FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
         ORDER BY TABLE_NAME LIMIT 6`,
        [schema]
      ),
      catch: () => new Error("Failed to fetch tables"),
    });

    const [rows] = result as any[];
    return (rows ?? []).map((r: any) => String(r.TABLE_NAME ?? "")).filter(Boolean);
  });

export const getMysqlColumns = (
  pool: { query: (sql: string, params?: unknown[]) => Promise<any> },
  schema: string,
  table: string
): Effect.Effect<Array<{ name: string; type: string }>, Error> =>
  Effect.gen(function* () {
    const result = yield* Effect.tryPromise({
      try: () => pool.query(
        `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION LIMIT 12`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch columns"),
    });

    const [rows] = result as any[];
    const list: Array<{ name: string; type: string }> = (rows ?? []).map((r: any) => ({
      name: String(r.COLUMN_NAME ?? ""),
      type: String(r.DATA_TYPE ?? ""),
    }));
    return list.filter((c) => c.name !== "");
  });
