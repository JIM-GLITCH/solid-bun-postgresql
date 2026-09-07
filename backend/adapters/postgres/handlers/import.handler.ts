type Pg = SessionStore | ConnectionId;



import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentPostgresSession } from "../../../services/SessionStore"

export const handlePostgresImportRows = (
  schema: string,
  table: string,
  columns: string[],
  rows: unknown[][],
  conflictColumns?: string[],
  onConflict?: "nothing" | "update",
  onError?: "rollback" | "discard",
): Effect.Effect<{ success: true; rowCount: number }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    if (!columns?.length || !Array.isArray(rows)) {
      return yield* Effect.fail(new QueryExecutionError({
        context: makeErrorContext("postgres.importRows"),
        sql: "",
        databaseErrorMessage: "Missing columns or rows",
      }));
    }

    const quotedColumns = columns.map((c) => `"${c}"`).join(", ");
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");

    let sql = `INSERT INTO "${schema}"."${table}" (${quotedColumns}) VALUES (${placeholders})`;

    if (conflictColumns?.length && onConflict) {
      const conflictCols = conflictColumns.map((c) => `"${c}"`).join(", ");
      if (onConflict === "nothing") {
        sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
      } else if (onConflict === "update") {
        const updateSet = columns
          .map((c) => `"${c}" = EXCLUDED."${c}"`)
          .join(", ");
        sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}`;
      }
    }

    let successCount = 0;
    let errorCount = 0;

    yield* Effect.tryPromise({
      try: async () => {
        const client = await pgSession.backGroundPool.connect();
        try {
          await client.query("BEGIN");

          for (const row of rows) {
            try {
              await client.query(sql, row);
              successCount++;
            } catch (e) {
              errorCount++;
              if (onError === "rollback") {
                throw e;
              }
            }
          }

          await client.query("COMMIT");
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.importRows"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true, rowCount: successCount };
  });

export const handlePostgresSaveChanges = (
  sql: string,
): Effect.Effect<{ success: true; rowCount: number }, QueryExecutionError | SessionNotFoundError, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(sql),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.saveChanges"),
        sql: sanitizeSql(sql),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return { success: true, rowCount: result.rowCount ?? 0 };
  });
