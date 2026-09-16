type Ss = SessionStore | ConnectionId;

import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"

export const handleSqlServerIndexes = (
  schema: string,
  table: string,
): Effect.Effect<
  { indexes: Array<{ index_name: string; index_type: string; is_unique: boolean; is_primary: boolean; columns: string[] }> },
  SessionNotFoundError | Error,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT
           i.name AS index_name,
           i.type_desc AS index_type,
           i.is_unique,
           i.is_primary_key,
           STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
         FROM sys.indexes i
         JOIN sys.tables t ON i.object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
         JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
         WHERE s.name = @schema AND t.name = @table
         GROUP BY i.name, i.type_desc, i.is_unique, i.is_primary_key
         ORDER BY i.name`,
        {
          input: { schema, table }
        }
      ),
      catch: () => new Error("Failed to fetch indexes"),
    });

    return {
      indexes: result.recordset.map((r: any) => ({
        index_name: r.index_name,
        index_type: r.index_type,
        is_unique: r.is_unique,
        is_primary: r.is_primary_key,
        columns: r.columns ? r.columns.split(',') : [],
      })),
    };
  });

export const handleSqlServerPrimaryKeys = (
  schema: string,
  table: string,
): Effect.Effect<{ columns: string[] }, SessionNotFoundError | Error, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT c.name AS column_name
         FROM sys.key_constraints k
         JOIN sys.tables t ON k.parent_object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         JOIN sys.key_column_usage kc ON k.object_id = kc.constraint_object_id
         JOIN sys.columns c ON kc.parent_object_id = c.object_id AND kc.parent_column_id = c.column_id
         WHERE s.name = @schema AND t.name = @table AND k.type = 'PK'
         ORDER BY kc.constraint_column_id`,
        {
          input: { schema, table }
        }
      ),
      catch: () => new Error("Failed to fetch primary keys"),
    });

    return { columns: result.recordset.map((r: any) => r.column_name) };
  });

export const handleSqlServerUniqueConstraints = (
  schema: string,
  table: string,
): Effect.Effect<
  { constraints: Array<{ name: string; type: string; columns: string[] }> },
  SessionNotFoundError | Error,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT tc.name AS constraint_name, tc.type AS constraint_type,
         STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY kc.constraint_column_id) AS columns
         FROM sys.key_constraints tc
         JOIN sys.tables t ON tc.parent_object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         JOIN sys.key_column_usage kc ON tc.object_id = kc.constraint_object_id
         JOIN sys.columns c ON kc.parent_object_id = c.object_id AND kc.parent_column_id = c.column_id
         WHERE s.name = @schema AND t.name = @table AND tc.type IN ('UQ', 'PK')
         GROUP BY tc.name, tc.type`,
        {
          input: { schema, table }
        }
      ),
      catch: () => new Error("Failed to fetch unique constraints"),
    });

    return {
      constraints: result.recordset.map((r: any) => ({
        name: r.constraint_name,
        type: r.constraint_type,
        columns: r.columns ? r.columns.split(',') : [],
      })),
    };
  });

export const handleSqlServerCheckConstraints = (
  schema: string,
  table: string,
): Effect.Effect<
  { checkConstraints: Array<{ name: string; definition: string }> },
  SessionNotFoundError | Error,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT cc.name AS name, cc.definition AS definition
         FROM sys.check_constraints cc
         JOIN sys.tables t ON cc.parent_object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE s.name = @schema AND t.name = @table`,
        {
          input: { schema, table }
        }
      ),
      catch: () => new Error("Failed to fetch check constraints"),
    });

    return {
      checkConstraints: result.recordset.map((r: any) => ({
        name: r.name,
        definition: r.definition,
      })),
    };
  });

export const handleSqlServerForeignKeys = (
  schema: string,
  table: string,
): Effect.Effect<
  { foreignKeys: Array<{ columnName: string; referencedSchema: string; referencedTable: string; referencedColumn: string }> },
  SessionNotFoundError | Error,
  Ss
> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(
        `SELECT
           c.name AS column_name,
           rs.name AS referenced_schema,
           rt.name AS referenced_table,
           rc.name AS referenced_column
         FROM sys.foreign_keys fk
         JOIN sys.tables t ON fk.parent_object_id = t.object_id
         JOIN sys.schemas s ON t.schema_id = s.schema_id
         JOIN sys.foreign_key_columns fkc ON fk.object_id = fkc.constraint_object_id
         JOIN sys.columns c ON fkc.parent_object_id = c.object_id AND fkc.parent_column_id = c.column_id
         JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
         JOIN sys.schemas rs ON rt.schema_id = rs.schema_id
         JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
         WHERE s.name = @schema AND t.name = @table`,
        {
          input: { schema, table }
        }
      ),
      catch: () => new Error("Failed to fetch foreign keys"),
    });

    return {
      foreignKeys: result.recordset.map((r: any) => ({
        columnName: r.column_name,
        referencedSchema: r.referenced_schema,
        referencedTable: r.referenced_table,
        referencedColumn: r.referenced_column,
      })),
    };
  });
