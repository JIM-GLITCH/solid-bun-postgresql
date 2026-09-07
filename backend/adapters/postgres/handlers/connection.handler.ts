import { connectPostgres, createPostgresPool, getDbConfig } from "../../../connect-postgres"
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
import { PostgresSessionConnection } from "../../../session-connection"
import { ConnectDbRequest, DbKind, defaultDatabaseCapabilities } from "../../../../shared/src"

export const handlePostgresConnect = (
  params: ConnectDbRequest,
): Effect.Effect<
  { success: true; connectionId: string; dbType: "postgres" },
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
        try: () => getDbConfig(loginParams),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("postgres.getDbConfig"),
          host: sanitizeHost(params.host),
          port: Number(params.port ?? 5432),
          database: params.database ?? "",
          errorCode: (e as any)?.code,
        }),
      });

    const client = yield* Effect.tryPromise({
        try: () => connectPostgres(db),
        catch: (e) => new DatabaseConnectionError({
          context: makeErrorContext("postgres.connect"),
          host: sanitizeHost(params.host),
          port: Number(params.port ?? 5432),
          database: params.database ?? "",
          errorCode: (e as any)?.code,
        }),
      });

    const pool = yield* Effect.sync(() => createPostgresPool(db));

    const session: PostgresSessionConnection = {
      dbKind: "postgres",
      userUsedClient: client,
      backGroundPool: pool,
      dbForReconnect: db,
      eventPushers: new Set(),
      closeTunnel: db.closeTunnel,
    };

    yield* registerCurrentSession(session);

    return { success: true as const, connectionId, dbType: "postgres" as const };
  });

export const handlePostgresDisconnect = (): Effect.Effect<
  { success: true },
  SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const session = yield* currentSession;

    if (session.dbKind === "postgres") {
      yield* Effect.tryPromise({
          try: () => session.userUsedClient.end().catch(() => {}),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
      yield* Effect.tryPromise({
          try: () => session.backGroundPool.end().catch(() => {}),
          catch: () => void 0,
        }).pipe(Effect.catch(() => Effect.void));
    }

    yield* unregisterCurrentSession;

    return { success: true as const };
  });

export const handlePostgresCapabilities = (
  dbKind: DbKind
): Effect.Effect<{ capabilities: any }, never> =>
  Effect.succeed({
    capabilities: defaultDatabaseCapabilities(dbKind),
  });
