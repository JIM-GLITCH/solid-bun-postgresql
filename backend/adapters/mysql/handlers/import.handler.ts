type My = SessionStore | ConnectionId;

import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentMysqlSession } from "../../../services/SessionStore"

export const handleMysqlImportRows = (
  schema: string,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictColumns?: string[],
  onConflict?: "nothing" | "update",
  onError?: "rollback" | "discard",
): Effect.Effect<{ success: true; rowCount: number }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    if (!columns?.length || !Array.isArray(rows)) {
      return yield* Effect.fail(new QueryExecutionError({
        context: makeErrorContext("mysql.importRows"),
        sql: "",
        databaseErrorMessage: "Missing columns or rows",
      }));
    }

    const quotedColumns = columns.map((c) => `\`${c}\``).join(", ");
    const placeholders = columns.map(() => "?").join(", ");

    let sql = `INSERT INTO \`${schema}\`.\`${table}\` (${quotedColumns}) VALUES (${placeholders})`;

    if (conflictColumns?.length && onConflict === "update") {
      const conflictCols = conflictColumns.map((c) => `\`${c}\``).join(", ");
      const updateSet = columns
        .map((c) => `\`${c}\` = VALUES(\`${c}\`)`)
        .join(", ");
      sql += ` ON DUPLICATE KEY UPDATE ${updateSet}`;
    } else if (conflictColumns?.length && onConflict === "nothing") {
      sql += ` ON DUPLICATE KEY UPDATE id = id`; // No-op to ignore duplicates
    }

    let successCount = 0;
    let errorCount = 0;

    yield* Effect.tryPromise({
      try: async () => {
        const connection = await mysqlSession.backGroundPool.getConnection();
        try {
          await connection.beginTransaction();

          for (const row of rows) {
            try {
              await connection.query(sql, row);
              successCount++;
            } catch (e) {
              errorCount++;
              if (onError === "rollback") {
                throw e;
              }
            }
          }

          await connection.commit();
        } catch (e) {
          await connection.rollback();
          throw e;
        } finally {
          connection.release();
        }
      },
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.importRows"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true, rowCount: successCount };
  });

export const handleMysqlSaveChanges = (
  sql: string,
): Effect.Effect<{ success: true; rowCount: number }, QueryExecutionError | SessionNotFoundError, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(sql),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("mysql.saveChanges"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true, rowCount: result.affectedRows ?? 0 };
  });
