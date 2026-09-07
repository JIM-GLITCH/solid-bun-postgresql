type Pg = SessionStore | ConnectionId;



import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentPostgresSession } from "../../../services/SessionStore"

export const handlePostgresSessionMonitor = (): Effect.Effect<
  { sessions: Array<{ pid: number; state: string; query?: string; duration?: number }> },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT pid, state, query, EXTRACT(EPOCH FROM (NOW() - query_start))::INTEGER AS duration
         FROM pg_stat_activity
         WHERE state IS NOT NULL AND pid != pg_backend_pid()
         ORDER BY query_start DESC`
      ),
      catch: () => new Error("Failed to fetch sessions"),
    });

    return {
      sessions: result.rows.map((r: any) => ({
        pid: r.pid,
        state: r.state,
        query: r.query,
        duration: r.duration,
      })),
    };
  });

export const handlePostgresSessionControl = (
  action: "kill" | "terminate",
  targetPid: number,
): Effect.Effect<{ success: true }, SessionNotFoundError | Error, Pg> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const sql = action === "kill"
      ? `SELECT pg_cancel_backend(${targetPid})`
      : `SELECT pg_terminate_backend(${targetPid})`;

    yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(sql),
      catch: () => new Error(`Failed to ${action} session`),
    });

    return { success: true };
  });

export const handlePostgresInstalledExtensions = (): Effect.Effect<
  { extensions: Array<{ name: string; version: string }> },
  SessionNotFoundError | Error,
  Pg
> =>
  Effect.gen(function* () {
    const pgSession = yield* currentPostgresSession;

    const result = yield* Effect.tryPromise({
      try: () => pgSession.backGroundPool.query(
        `SELECT extname AS name, extversion AS version
         FROM pg_extension
         ORDER BY extname`
      ),
      catch: () => new Error("Failed to fetch extensions"),
    });

    return {
      extensions: result.rows.map((r: any) => ({
        name: r.name,
        version: r.version,
      })),
    };
  });
