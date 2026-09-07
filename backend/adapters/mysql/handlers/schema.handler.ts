type My = SessionStore | ConnectionId;



import { getMysqlSchemas } from "../../shared/schema-utils"
import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentMysqlSession } from "../../../services/SessionStore"

export const handleMysqlSchemas = (): Effect.Effect<
  { schemas: string[] },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;
    const schemas = yield* getMysqlSchemas(mysqlSession.backGroundPool);

    return { schemas };
  });

export const handleMysqlTables = (
  schema: string,
): Effect.Effect<
  { tables: string[]; views: string[]; functions: Array<{ name: string }> },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
         ORDER BY TABLE_TYPE, TABLE_NAME`,
        [schema]
      ),
      catch: () => new Error("Failed to fetch tables"),
    });

    const [rows] = result as any[];

    return {
      tables: rows?.filter((r: any) => r.table_type === "BASE TABLE").map((r: any) => r.table_name) as string[] ?? [],
      views: rows?.filter((r: any) => r.table_type === "VIEW").map((r: any) => r.table_name) as string[] ?? [],
      functions: [],
    };
  });

export const handleMysqlColumns = (
  schema: string,
  table: string,
): Effect.Effect<{ columns: unknown[] }, SessionNotFoundError | Error, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type, IS_NULLABLE AS is_nullable,
         COLUMN_DEFAULT AS column_default, CHARACTER_MAXIMUM_LENGTH AS character_maximum_length
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch columns"),
    });

    const [rows] = result as any[];

    return { columns: rows ?? [] };
  });
