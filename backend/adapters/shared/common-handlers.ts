import { DatabaseConnectionError, QueryExecutionError, SessionNotFoundError } from "../../core/errors"
import { Effect } from "effect"
import {
  ConnectionId,
  SessionStore,
  currentSession,
  findCurrentSession,
  registerCurrentSession,
  unregisterCurrentSession,
} from "../../services/SessionStore"
import { SessionConnection } from "../../session-connection"
import { DbKind, defaultDatabaseCapabilities } from "../../../shared/src"
import type { CapabilitiesResult, ConnectParams, ConnectResult, DisconnectResult, QueryResult } from "./types"

export const handleConnect = <T extends ConnectParams>(
  params: T,
  createSession: (params: T) => Effect.Effect<SessionConnection, DatabaseConnectionError>,
): Effect.Effect<ConnectResult, DatabaseConnectionError, SessionStore | ConnectionId> =>
  Effect.gen(function* () {
    const connectionId = yield* ConnectionId;

    // 检查现有连接
    const existing = yield* findCurrentSession;
    if (existing) {
      yield* unregisterCurrentSession;
    }

    // 创建新会话
    const session = yield* createSession(params);
    yield* registerCurrentSession(session);

    return { success: true, connectionId, dbType: params.dbType };
  });

export const handleDisconnect = (): Effect.Effect<
  DisconnectResult,
  SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    yield* currentSession;
    yield* unregisterCurrentSession;

    return { success: true };
  });

export const handleGetCapabilities = (
  dbKind: DbKind
): Effect.Effect<CapabilitiesResult, never, never> =>
  Effect.succeed({ capabilities: defaultDatabaseCapabilities(dbKind) });

export const handleQuery = <A = unknown>(
  sql: string,
  queryFn: (session: SessionConnection, sql: string) => Effect.Effect<QueryResult<A>, QueryExecutionError>,
): Effect.Effect<QueryResult<A>, QueryExecutionError | SessionNotFoundError, SessionStore | ConnectionId> =>
  Effect.gen(function* () {
    const session = yield* currentSession;

    return yield* queryFn(session, sql);
  });

export const handleQueryStream = (
  sql: string,
  batchSize: number,
  queryStreamFn: (
    session: SessionConnection,
    sql: string,
    batchSize: number,
  ) => Effect.Effect<{ rows: unknown[]; columns: string[]; hasMore: boolean }, QueryExecutionError>,
): Effect.Effect<
  { rows: unknown[]; columns: string[]; hasMore: boolean },
  QueryExecutionError | SessionNotFoundError,
  SessionStore | ConnectionId
> =>
  Effect.gen(function* () {
    const session = yield* currentSession;

    return yield* queryStreamFn(session, sql, batchSize);
  });

export const handleCancel = (
  cancelFn: (session: SessionConnection) => Effect.Effect<void, never>,
): Effect.Effect<void, never, SessionStore | ConnectionId> =>
  Effect.gen(function* () {
    const session = yield* findCurrentSession;
    if (!session) {
      return;
    }

    yield* cancelFn(session);
  });
