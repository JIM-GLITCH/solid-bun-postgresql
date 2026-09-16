type My = SessionStore | ConnectionId;

import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentMysqlSession } from "../../../services/SessionStore"

export const handleMysqlIndexes = (
  schema: string,
  table: string,
): Effect.Effect<
  { indexes: Array<{ index_name: string; index_type: string; is_unique: boolean; is_primary: boolean; columns: string[] }> },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT
           s.index_name,
           s.index_type,
           s.non_unique,
           s.primary,
           GROUP_CONCAT(s.column_name ORDER BY s.seq_in_index) AS columns
         FROM information_schema.statistics s
         WHERE s.table_schema = ? AND s.table_name = ?
         GROUP BY s.index_name, s.index_type, s.non_unique, s.primary
         ORDER BY s.index_name`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch indexes"),
    });

    return {
      indexes: result.map((r: any) => ({
        index_name: r.index_name,
        index_type: r.index_type,
        is_unique: !r.non_unique,
        is_primary: r.primary === 1,
        columns: r.columns ? r.columns.split(',') : [],
      })),
    };
  });

export const handleMysqlPrimaryKeys = (
  schema: string,
  table: string,
): Effect.Effect<{ columns: string[] }, SessionNotFoundError | Error, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = ? AND tc.table_name = ?
         ORDER BY kcu.ordinal_position`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch primary keys"),
    });

    return { columns: result.map((r: any) => r.column_name) };
  });

export const handleMysqlUniqueConstraints = (
  schema: string,
  table: string,
): Effect.Effect<
  { constraints: Array<{ name: string; type: string; columns: string[] }> },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT tc.constraint_name, tc.constraint_type,
         GROUP_CONCAT(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
         GROUP BY tc.constraint_name, tc.constraint_type`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch unique constraints"),
    });

    return {
      constraints: result.map((r: any) => ({
        name: r.constraint_name,
        type: r.constraint_type,
        columns: r.columns ? r.columns.split(',') : [],
      })),
    };
  });

export const handleMysqlCheckConstraints = (
  schema: string,
  table: string,
): Effect.Effect<
  { checkConstraints: Array<{ name: string; definition: string }> },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT con.constraint_name AS name, con.check_clause AS definition
         FROM information_schema.check_constraints con
         JOIN information_schema.table_constraints tc ON con.constraint_name = tc.constraint_name
         WHERE tc.table_schema = ? AND tc.table_name = ?`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch check constraints"),
    });

    return {
      checkConstraints: result.map((r: any) => ({
        name: r.name,
        definition: r.definition,
      })),
    };
  });

export const handleMysqlForeignKeys = (
  schema: string,
  table: string,
): Effect.Effect<
  { foreignKeys: Array<{ columnName: string; referencedSchema: string; referencedTable: string; referencedColumn: string }> },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT
           kcu.column_name,
           kcu.referenced_table_schema AS referenced_schema,
           kcu.referenced_table_name AS referenced_table,
           kcu.referenced_column_name AS referenced_column
         FROM information_schema.key_column_usage kcu
         JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ? AND tc.table_name = ?`,
        [schema, table]
      ),
      catch: () => new Error("Failed to fetch foreign keys"),
    });

    return {
      foreignKeys: result.map((r: any) => ({
        columnName: r.column_name,
        referencedSchema: r.referenced_schema,
        referencedTable: r.referenced_table,
        referencedColumn: r.referenced_column,
      })),
    };
  });
