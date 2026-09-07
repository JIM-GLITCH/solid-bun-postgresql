import { getDbConfig } from "../../../connect-postgres"
import { getSqlServerDbConfig, openSqlServerPool } from "../../../connect-sqlserver"
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
import { SqlServerSessionConnection } from "../../../session-connection"
import { ConnectDbRequest, DbKind, defaultDatabaseCapabilities } from "../../../../shared/src"

export const handleSqlServerConnect = (
  params: ConnectDbRequest,
): Effect.Effect<
  { success: true; connectionId: string; dbType: "sqlserver" },
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
        try: () => getSqlServerDbConfig(loginParams),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("sqlserver.getDbConfig"),
          host: sanitizeHost(params.host),
          port: Number(params.port ?? 1433),
          database: params.database ?? "",
          errorCode: (e as any)?.code,
        }),
      });

    const pool = yield* Effect.tryPromise({
        try: () => openSqlServerPool(db),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("sqlserver.openPool"),
          host: sanitizeHost(params.host),
          port: Number(params.port ?? 1433),
          database: params.database ?? "",
          errorCode: (e as any)?.code,
        }),
      });

    const session: SqlServerSessionConnection = {
      dbKind: "sqlserver",
      userUsedClient: pool,
      backGroundPool: pool,
      dbForReconnect: db,
      eventPushers: new Set(),
      closeTunnel: db.closeTunnel,
    };

    yield* registerCurrentSession(session);

    return { success: true as const, connectionId, dbType: "sqlserver" as const };
  });

export const handleSqlServerDisconnect = (): Effect.Effect<
  { success: true },
  SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const session = yield* currentSession;

    if (session.dbKind === "sqlserver") {
      yield* Effect.tryPromise({
          try: () => session.userUsedClient.close().catch(() => {}),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
    }

    yield* unregisterCurrentSession;

    return { success: true as const };
  });

export const handleSqlServerCapabilities = (
  dbKind: DbKind
): Effect.Effect<{ capabilities: any }, never> =>
  Effect.succeed({
    capabilities: defaultDatabaseCapabilities(dbKind),
  });
