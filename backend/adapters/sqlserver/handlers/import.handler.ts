type Ss = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"

export const handleSqlServerImportRows = (
  schema: string,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictColumns?: string[],
  onConflict?: "nothing" | "update",
  onError?: "rollback" | "discard",
): Effect.Effect<{ success: true; rowCount: number }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    if (!columns?.length || !Array.isArray(rows)) {
      return yield* Effect.fail(new QueryExecutionError({
        context: makeErrorContext("sqlserver.importRows"),
        sql: "",
        databaseErrorMessage: "Missing columns or rows",
      }));
    }

    const quotedColumns = columns.map((c) => `[${c}]`).join(", ");
    const placeholders = columns.map((_, i) => `@${i + 1}`).join(", ");

    let sql = `INSERT INTO [${schema}].[${table}] (${quotedColumns}) VALUES (${placeholders})`;

    if (conflictColumns?.length && onConflict === "update") {
      const conflictCols = conflictColumns.map((c) => `[${c}]`).join(", ");
      const updateSet = columns
        .map((c) => `[${c}] = source.[${c}]`)
        .join(", ");
      sql = `MERGE INTO [${schema}].[${table}] AS target USING (VALUES (${placeholders})) AS source (${quotedColumns}) ON ${conflictCols.map((c, i) => `target.[${c}] = source.[${c}]`).join(" AND ")} WHEN MATCHED THEN UPDATE SET ${updateSet} WHEN NOT MATCHED THEN INSERT (${quotedColumns}) VALUES (${placeholders});`;
    } else if (conflictColumns?.length && onConflict === "nothing") {
      sql = `INSERT INTO [${schema}].[${table}] (${quotedColumns}) SELECT ${placeholders} WHERE NOT EXISTS (SELECT 1 FROM [${schema}].[${table}] WHERE ${conflictCols.map((c, i) => `[${c}] = @${i + 1}`).join(" AND ")})`;
    }

    let successCount = 0;
    let errorCount = 0;

    yield* Effect.tryPromise({
      try: async () => {
        const transaction = new sqlServerSession.backGroundPool.request().beginTransaction();
        try {
          for (const row of rows) {
            try {
              const request = transaction.request();
              for (let i = 0; i < columns.length; i++) {
                request.input(`@${i + 1}`, row[i]);
              }
              await request.query(sql);
              successCount++;
            } catch (e) {
              errorCount++;
              if (onError === "rollback") {
                throw e;
              }
            }
          }

          await transaction.commit();
        } catch (e) {
          await transaction.rollback();
          throw e;
        }
      },
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.importRows"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true, rowCount: successCount };
  });

export const handleSqlServerSaveChanges = (
  sql: string,
): Effect.Effect<{ success: true; rowCount: number }, QueryExecutionError | SessionNotFoundError, Ss> =>
  Effect.gen(function* () {
    const sqlServerSession = yield* currentSqlServerSession;

    const result = yield* Effect.tryPromise({
      try: () => sqlServerSession.backGroundPool.request().query(sql),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("sqlserver.saveChanges"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true, rowCount: result.rowsAffected ?? 0 };
  });
