import { isPgUserClientDeadError, normalizeStatements, statementsToText } from "../../shared/query-utils"
import { calculateColumnEditable } from "../../../column-editable"
import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeSql } from "../../../core/sanitize"
import { Effect } from "effect"
import Cursor from "pg-cursor"
import { ConnectionId, SessionStore, currentPostgresSession, optionalPostgresSession } from "../../../services/SessionStore"
import { ColumnEditableInfo } from "../../../../shared/src"

export const handlePostgresQuery = (
  sql: string | string[],
): Effect.Effect<
  { rows: unknown[]; columns: string[]; rowCount: number },
  QueryExecutionError | SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;
    const statements = normalizeStatements(sql);

    if (statements.length === 0) {
      return { rows: [], columns: [], rowCount: 0 };
    }

    const result = yield* Effect.tryPromise({
      try: () => pgSession.userUsedClient.query(statements.join("; ")),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.query"),
        sql: sanitizeSql(statementsToText(sql)),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    return {
      rows: result.rows,
      columns: result.fields?.map((f) => f.name) ?? [],
      rowCount: result.rowCount ?? 0,
    };
  });

export const handlePostgresQueryStream = (
  sql: string | string[],
  batchSize: number,
): Effect.Effect<
  { rows: unknown[]; columns: ColumnEditableInfo[]; hasMore: boolean },
  QueryExecutionError | SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;
    const statements = normalizeStatements(sql);

    if (statements.length === 0) {
      return { rows: [], columns: [], hasMore: false };
    }

    if (pgSession.cursor) {
      yield* Effect.tryPromise({
          try: () => new Promise<void>((r) => pgSession.cursor!.instance.close(() => r())),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
      pgSession.cursor = undefined;
    }

    try {
      const pidRes = yield* Effect.tryPromise({
        try: () => pgSession.userUsedClient.query("SELECT pg_backend_pid() as pid"),
        catch: (e) => new QueryExecutionError({
          context: makeErrorContext("postgres.queryStream"),
          sql: "",
          databaseErrorCode: (e as any)?.code,
          databaseErrorMessage: (e as Error)?.message,
        }),
      });
      pgSession.runningQueryPid = parseInt(String(pidRes.rows[0]?.pid ?? 0), 10) || undefined;
    } catch {
      pgSession.runningQueryPid = (pgSession.userUsedClient as any).processID;
    }

    for (let i = 0; i < statements.length - 1; i++) {
      yield* Effect.tryPromise({
        try: () => pgSession.userUsedClient.query(statements[i]),
        catch: (e) => new QueryExecutionError({
          context: makeErrorContext("postgres.queryStream"),
          sql: sanitizeSql(statements[i]),
          databaseErrorCode: (e as any)?.code,
          databaseErrorMessage: (e as Error)?.message,
        }),
      });
    }

    const lastStatement = statements[statements.length - 1];
    const cursor = pgSession.userUsedClient.query(new Cursor(lastStatement, [], { rowMode: "array" }));

    const rows = yield* Effect.tryPromise({
      try: () => new Promise<any[]>((resolve, reject) => {
        cursor.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      }),
      catch: (e) => new QueryExecutionError({
        context: makeErrorContext("postgres.queryStream"),
        sql: sanitizeSql(lastStatement),
        databaseErrorCode: (e as any)?.code,
        databaseErrorMessage: (e as Error)?.message,
      }),
    });

    const fields = (cursor as any)._result?.fields;
    const columnsInfo: ColumnEditableInfo[] = fields
      ? yield* Effect.tryPromise({
          try: () => calculateColumnEditable(pgSession.backGroundPool, fields, lastStatement),
          catch: () => [] as ColumnEditableInfo[],
        }).pipe(Effect.catch(() => Effect.succeed([] as ColumnEditableInfo[])))
      : [];

    const isDone = rows.length < batchSize;

    if (isDone) {
      yield* Effect.tryPromise({
          try: () => new Promise<void>((r) => cursor.close(() => r())),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
      pgSession.runningQueryPid = undefined;
    } else {
      pgSession.cursor = { instance: cursor, columns: columnsInfo, isDone: false };
    }

    return { rows, columns: columnsInfo, hasMore: !isDone };
  });

export const handlePostgresQueryStreamMore = (
  batchSize: number,
): Effect.Effect<
  { rows: unknown[]; hasMore: boolean },
  QueryExecutionError | SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    if (!pgSession.cursor || pgSession.cursor.isDone) {
      return { rows: [], hasMore: false };
    }

    const { cursor } = pgSession;

    const rows = yield* Effect.tryPromise({
      try: () => new Promise<any[]>((resolve, reject) => {
        cursor.instance.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      }),
      catch: (e) => {
        if (isPgUserClientDeadError(e)) {
          pgSession.cursor = undefined;
          pgSession.runningQueryPid = undefined;
        }
        return new QueryExecutionError({
          context: makeErrorContext("postgres.queryStreamMore"),
          sql: "",
          databaseErrorCode: (e as any)?.code,
          databaseErrorMessage: (e as Error)?.message,
        });
      },
    });

    const isDone = rows.length < batchSize;

    if (isDone) {
      yield* Effect.tryPromise({
          try: () => new Promise<void>((r) => cursor.instance.close(() => r())),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
      pgSession.cursor = undefined;
      pgSession.runningQueryPid = undefined;
    } else {
      cursor.isDone = false;
    }

    return { rows, hasMore: !isDone };
  });

export const handlePostgresCancel = (): Effect.Effect<
  void,
  never,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const pgSession = yield* optionalPostgresSession;
    if (!pgSession) return;

    if (pgSession.runningQueryPid) {
      yield* Effect.tryPromise({
          try: async () => {
            const { Client } = require("pg");
            const cancelClient = new Client((pgSession.userUsedClient as any).connectionParameters);
            await cancelClient.connect();
            await cancelClient.query(`SELECT pg_cancel_backend(${pgSession.runningQueryPid})`);
            await cancelClient.end();
          },
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
    }

    if (pgSession.cursor) {
      yield* Effect.tryPromise({
          try: () => new Promise<void>((r) => pgSession.cursor!.instance.close(() => r())),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
      pgSession.cursor = undefined;
      pgSession.runningQueryPid = undefined;
    }
  });
