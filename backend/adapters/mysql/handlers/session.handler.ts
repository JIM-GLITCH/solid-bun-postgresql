type My = SessionStore | ConnectionId;

import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentMysqlSession } from "../../../services/SessionStore"

export const handleMysqlSessionMonitor = (): Effect.Effect<
  { connectionStats: { total: number; active: number; idle: number; waiting: number }; lockWaits: any[]; slowQueries: any[]; slowQuerySource: string; collectedAt: number },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
         FROM information_schema.PROCESSLIST
         WHERE ID != CONNECTION_ID()
         ORDER BY TIME DESC
         LIMIT 20`
      ),
      catch: () => new Error("Failed to fetch sessions"),
    });

    const sessions = result;
    const active = sessions.filter((s: any) => s.COMMAND !== 'Sleep').length;
    const idle = sessions.filter((s: any) => s.COMMAND === 'Sleep').length;

    return {
      connectionStats: {
        total: sessions.length,
        active,
        idle,
        waiting: 0,
      },
      lockWaits: [],
      slowQueries: sessions.filter((s: any) => s.TIME > 5).map((s: any) => ({
        pid: s.ID,
        user: s.USER,
        query: s.INFO,
        duration: s.TIME,
      })),
      slowQuerySource: "mysql_processlist",
      collectedAt: Date.now(),
    };
  });

export const handleMysqlSessionControl = (
  action: "cancel" | "terminate",
  targetPid: number,
): Effect.Effect<{ success: true }, SessionNotFoundError | Error, My> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const sql = action === "cancel"
      ? `KILL QUERY ${targetPid}`
      : `KILL ${targetPid}`;

    yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(sql),
      catch: () => new Error(`Failed to ${action} session`),
    });

    return { success: true };
  });

export const handleMysqlInstalledExtensions = (): Effect.Effect<
  { extensions: Array<{ name: string; version: string }> },
  SessionNotFoundError | Error,
  My
> =>
  Effect.gen(function* () {
    const mysqlSession = yield* currentMysqlSession;

    const result = yield* Effect.tryPromise({
      try: () => mysqlSession.backGroundPool.query(
        `SHOW PLUGINS`
      ),
      catch: () => new Error("Failed to fetch extensions"),
    });

    return {
      extensions: result.map((r: any) => ({
        name: r.Name,
        version: r.Version || 'unknown',
      })),
    };
  });
