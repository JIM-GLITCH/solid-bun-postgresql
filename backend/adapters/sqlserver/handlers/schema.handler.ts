type Ss = SessionStore | ConnectionId;
type SsError = SessionNotFoundError | Error;



import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"

export const handleSqlServerSchemas = (): Effect.Effect<{ schemas: string[] }, SsError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT SCHEMA_NAME AS schema_name
         FROM INFORMATION_SCHEMA.SCHEMATA
         WHERE SCHEMA_NAME NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest')
         ORDER BY SCHEMA_NAME`
      ),
      catch: () => new Error("Failed to fetch schemas"),
    });

    return { schemas: result.recordset?.map((r: any) => r.schema_name) ?? [] };
  });

export const handleSqlServerTables = (
  schema: string,
): Effect.Effect<
  { tables: string[]; views: string[]; functions: Array<{ name: string }> },
  SsError,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
         FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = '${schema}' AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
         ORDER BY TABLE_TYPE, TABLE_NAME`
      ),
      catch: () => new Error("Failed to fetch tables"),
    });

    return {
      tables: result.recordset?.filter((r: any) => r.table_type === "BASE TABLE").map((r: any) => r.table_name) ?? [],
      views: result.recordset?.filter((r: any) => r.table_type === "VIEW").map((r: any) => r.table_name) ?? [],
      functions: [],
    };
  });

export const handleSqlServerColumns = (
  schema: string,
  table: string,
): Effect.Effect<{ columns: unknown[] }, SsError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable,
         COLUMN_DEFAULT AS column_default, CHARACTER_MAXIMUM_LENGTH AS character_maximum_length
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'
         ORDER BY ORDINAL_POSITION`
      ),
      catch: () => new Error("Failed to fetch columns"),
    });

    return { columns: result.recordset ?? [] };
  });
