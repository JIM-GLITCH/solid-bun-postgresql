import { createMysqlPool, getMysqlDbConfig } from "../../../connect-mysql"
import { getDbConfig } from "../../../connect-postgres"
import { DatabaseConnectionError, SessionNotFoundError, makeErrorContext } from "../../../core/errors"
import { sanitizeHost } from "../../../core/sanitize"
import { Effect } from "effect"
import {
  ConnectionId,
  SessionStore,
  currentSession,
  findCurrentSession,
  registerCurrentSession,
  unregisterCurrentSession,
} from "../../../services/SessionStore"
import { MysqlSessionConnection } from "../../../session-connection"
import { ConnectDbRequest, DbKind, defaultDatabaseCapabilities } from "../../../../shared/src"

export const handleMysqlConnect = (
  params: ConnectDbRequest,
): Effect.Effect<
  { success: true; connectionId: string; dbType: "mysql" | "mariadb" },
  DatabaseConnectionError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const connectionId = yield* ConnectionId;
    const { connectionId: _cid, dbType: _dbT, ...connectParams } = params;
    const loginParams = { ...connectParams, password: connectParams.password ?? "" };

    const existing = yield* findCurrentSession;
    if (existing) {
      yield* unregisterCurrentSession;
    }

    const db = yield* Effect.tryPromise({
        try: () => getMysqlDbConfig(loginParams),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("mysql.getDbConfig"),
          host: sanitizeHost(params.host),
          port: Number(params.port ?? 3306),
          database: params.database ?? "",
          errorCode: (e as any)?.code,
        }),
      });

    const pool = yield* Effect.try({
        try: () => createMysqlPool(db),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("mysql.createPool"),
          host: sanitizeHost(params.host),
          port: Number(params.port ?? 3306),
          database: params.database ?? "",
          errorCode: (e as any)?.code,
        }),
      });

    const connection = yield* Effect.tryPromise({
        try: () => pool.getConnection(),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("mysql.getConnection"),
          host: sanitizeHost(params.host),
          port: Number(params.port ?? 3306),
          database: params.database ?? "",
          errorCode: (e as any)?.code,
        }),
      });

    const dbType = (params.dbType === "mariadb" ? "mariadb" : "mysql") as "mysql" | "mariadb";
    const session: MysqlSessionConnection = {
      dbKind: dbType,
      userUsedClient: connection,
      backGroundPool: pool,
      dbForReconnect: db,
      eventPushers: new Set(),
      closeTunnel: db.closeTunnel,
    };

    yield* registerCurrentSession(session);

    return { success: true as const, connectionId, dbType };
  });

export const handleMysqlDisconnect = (): Effect.Effect<
  { success: true },
  SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const session = yield* currentSession;

    if (session.dbKind === "mysql" || session.dbKind === "mariadb") {
      yield* Effect.sync(() => {
          try { (session as MysqlSessionConnection).userUsedClient.release(); } catch { /* ignore */ }
        });
      yield* Effect.tryPromise({
          try: () => session.backGroundPool.end().catch(() => {}),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
    }

    yield* unregisterCurrentSession;

    return { success: true as const };
  });

export const handleMysqlCapabilities = (
  dbKind: DbKind
): Effect.Effect<{ capabilities: any }, never> =>
  Effect.succeed({
    capabilities: defaultDatabaseCapabilities(dbKind),
  });
