/**
 * 会话访问与「当前连接 ID」的依赖注入入口。
 *
 * 重构前每个 handler 都要显式接收 `connectionId` 与 `sessions` 两个参数，
 * 导致签名臃肿且层层透传。现在改为从 Effect Context 注入：
 *
 * - {@link SessionStore}：进程级会话仓储（get / register / unregister / list）
 * - {@link ConnectionId}：当前请求的连接 ID（请求作用域，由路由层 provide）
 *
 * 用法：
 * ```ts
 * // handler：不再声明 connectionId / sessions
 * export const handleXxx = (arg: string) =>
 *   Effect.gen(function* () {
 *     const session = yield* $(currentPostgresSession)
 *     ...
 *   })
 *
 * // 路由层：按请求注入 ConnectionId
 * handler().pipe(Effect.provide(withConnectionId(payload.connectionId)))
 * ```
 */

import { Context, Effect, Layer } from "effect";
import type {
  MysqlSessionConnection,
  PostgresSessionConnection,
  SessionConnection,
  SqlServerSessionConnection,
} from "../session-connection";
import { sessionDriverFromMap, type SessionDriverState } from "../effect-session-runtime";
import { QueryExecutionError, SessionNotFoundError, makeErrorContext } from "../core/errors";
import { sanitizeSql } from "../core/sanitize";

// ===== Tags =====

export interface SessionStoreShape {
  readonly get: (id: string) => Effect.Effect<SessionConnection | undefined, never>;
  readonly register: (id: string, session: SessionConnection) => Effect.Effect<void, never>;
  readonly unregister: (id: string) => Effect.Effect<void, never>;
  readonly list: () => Effect.Effect<SessionConnection[], never>;
}

/** 会话仓储：替代原先透传的 `sessions` 参数 */
export class SessionStore extends Context.Service<SessionStore, SessionStoreShape>()(
  "@backend/SessionStore",
) {}

/** 当前请求的连接 ID：替代原先透传的 `connectionId` 参数 */
export class ConnectionId extends Context.Service<ConnectionId, string>()(
  "@backend/ConnectionId",
) {}

// ===== Layers =====

export const sessionStoreLayer = (shape: SessionStoreShape): Layer.Layer<SessionStore> =>
  Layer.succeed(SessionStore, shape);

/** 由既有 `SessionDriverState`（如 api-core 的 `connectionRuntime.driver`）构建 */
export const sessionStoreFromDriver = (
  driver: SessionDriverState<SessionConnection>,
): Layer.Layer<SessionStore> =>
  Layer.succeed(SessionStore, {
    get: driver.get,
    register: (id, session) => driver.register(id, session).pipe(Effect.asVoid),
    unregister: (id) => driver.unregister(id).pipe(Effect.asVoid),
    list: driver.list,
  });

/** 基于 Map 的内存实现，便于测试与独立运行 */
export const sessionStoreFromMap = (
  map: Map<string, SessionConnection> = new Map<string, SessionConnection>(),
): Layer.Layer<SessionStore> => sessionStoreFromDriver(sessionDriverFromMap(map));

export const withConnectionId = (connectionId: string): Layer.Layer<ConnectionId> =>
  Layer.succeed(ConnectionId, connectionId);

/**
 * 在路由层统一注入当前请求的 `ConnectionId`，并把它从 Effect 的依赖中消除。
 */
export const provideConnectionId =
  (connectionId: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, ConnectionId>> =>
    effect.pipe(Effect.provide(withConnectionId(connectionId))) as Effect.Effect<
      A,
      E,
      Exclude<R, ConnectionId>
    >;

// ===== 缺失会话时的错误构造 =====

export const missingSession =
  (operation: string) =>
  (connectionId: string): SessionNotFoundError =>
    new SessionNotFoundError({
      context: makeErrorContext(operation),
      sessionId: connectionId,
    });

export const missingPostgresSession =
  (operation: string, sql = "") =>
  (connectionId: string): QueryExecutionError =>
    new QueryExecutionError({
      context: makeErrorContext(operation),
      sql: sanitizeSql(sql),
      databaseErrorMessage: "Session not found or not PostgreSQL",
    });

export const missingMysqlSession =
  (operation: string, sql = "") =>
  (connectionId: string): QueryExecutionError =>
    new QueryExecutionError({
      context: makeErrorContext(operation),
      sql: sanitizeSql(sql),
      databaseErrorMessage: "Session not found or not MySQL/MariaDB",
    });

export const missingSqlServerSession =
  (operation: string, sql = "") =>
  (connectionId: string): QueryExecutionError =>
    new QueryExecutionError({
      context: makeErrorContext(operation),
      sql: sanitizeSql(sql),
      databaseErrorMessage: "Session not found or not SQL Server",
    });

// ===== 会话读取 =====

type SessionOf<K extends SessionConnection["dbKind"]> = Extract<SessionConnection, { dbKind: K }>;

const sessionByKind = <K extends SessionConnection["dbKind"], E>(
  kinds: ReadonlyArray<K>,
  onMissing: (connectionId: string) => E,
): Effect.Effect<SessionOf<K>, E, SessionStore | ConnectionId> =>
  Effect.gen(function* () {
    const store = yield* SessionStore;
    const connectionId = yield* ConnectionId;
    const session = yield* store.get(connectionId);
    if (!session || !(kinds as ReadonlyArray<string>).includes(session.dbKind)) {
      return yield* Effect.fail(onMissing(connectionId));
    }
    return session as SessionOf<K>;
  });

const optionalSessionByKind = <K extends SessionConnection["dbKind"]>(
  kinds: ReadonlyArray<K>,
): Effect.Effect<SessionOf<K> | undefined, never, SessionStore | ConnectionId> =>
  Effect.gen(function* () {
    const store = yield* SessionStore;
    const connectionId = yield* ConnectionId;
    const session = yield* store.get(connectionId);
    if (!session || !(kinds as ReadonlyArray<string>).includes(session.dbKind)) {
      return undefined;
    }
    return session as SessionOf<K>;
  });

/** 当前连接上的会话（不限数据库类型），缺失时以 `onMissing` 失败 */
export const requireSession = <E>(
  onMissing: (connectionId: string) => E,
): Effect.Effect<SessionConnection, E, SessionStore | ConnectionId> =>
  Effect.gen(function* () {
    const store = yield* SessionStore;
    const connectionId = yield* ConnectionId;
    const session = yield* store.get(connectionId);
    if (!session) {
      return yield* Effect.fail(onMissing(connectionId));
    }
    return session;
  });

export const requirePostgresSession = <E>(
  onMissing: (connectionId: string) => E,
): Effect.Effect<PostgresSessionConnection, E, SessionStore | ConnectionId> =>
  sessionByKind<"postgres", E>(["postgres"], onMissing);

export const requireMysqlSession = <E>(
  onMissing: (connectionId: string) => E,
): Effect.Effect<MysqlSessionConnection, E, SessionStore | ConnectionId> =>
  sessionByKind<"mysql" | "mariadb", E>(["mysql", "mariadb"], onMissing);

export const requireSqlServerSession = <E>(
  onMissing: (connectionId: string) => E,
): Effect.Effect<SqlServerSessionConnection, E, SessionStore | ConnectionId> =>
  sessionByKind<"sqlserver", E>(["sqlserver"], onMissing);

// ===== 无参派生 Effect：handler 里直接 yield* currentXxxSession =====

/** 当前请求的会话（不限数据库类型），缺失时报 SessionNotFoundError */
export const currentSession: Effect.Effect<
  SessionConnection,
  SessionNotFoundError,
  SessionStore | ConnectionId
> = requireSession(missingSession("session.resolve"));

/** 当前请求的 PostgreSQL 会话，缺失时报 SessionNotFoundError */
export const currentPostgresSession: Effect.Effect<
  PostgresSessionConnection,
  SessionNotFoundError,
  SessionStore | ConnectionId
> = requirePostgresSession(missingSession("postgres.session"));

/** 当前请求的 MySQL/MariaDB 会话，缺失时报 SessionNotFoundError */
export const currentMysqlSession: Effect.Effect<
  MysqlSessionConnection,
  SessionNotFoundError,
  SessionStore | ConnectionId
> = requireMysqlSession(missingSession("mysql.session"));

/** 当前请求的 SQL Server 会话，缺失时报 SessionNotFoundError */
export const currentSqlServerSession: Effect.Effect<
  SqlServerSessionConnection,
  SessionNotFoundError,
  SessionStore | ConnectionId
> = requireSqlServerSession(missingSession("sqlserver.session"));

/** 允许会话缺失（如 cancel：没有会话时静默返回） */
export const optionalPostgresSession: Effect.Effect<
  PostgresSessionConnection | undefined,
  never,
  SessionStore | ConnectionId
> = optionalSessionByKind<"postgres">(["postgres"]);

export const optionalMysqlSession: Effect.Effect<
  MysqlSessionConnection | undefined,
  never,
  SessionStore | ConnectionId
> = optionalSessionByKind<"mysql" | "mariadb">(["mysql", "mariadb"]);

export const optionalSqlServerSession: Effect.Effect<
  SqlServerSessionConnection | undefined,
  never,
  SessionStore | ConnectionId
> = optionalSessionByKind<"sqlserver">(["sqlserver"]);

// ===== 会话写入 =====

export const findCurrentSession: Effect.Effect<
  SessionConnection | undefined,
  never,
  SessionStore | ConnectionId
> = Effect.gen(function* () {
  const store = yield* SessionStore;
  const connectionId = yield* ConnectionId;
  return yield* store.get(connectionId);
});

export const registerCurrentSession = (
  session: SessionConnection,
): Effect.Effect<void, never, SessionStore | ConnectionId> =>
  Effect.gen(function* () {
    const store = yield* SessionStore;
    const connectionId = yield* ConnectionId;
    yield* store.register(connectionId, session);
  });

export const unregisterCurrentSession: Effect.Effect<
  void,
  never,
  SessionStore | ConnectionId
> = Effect.gen(function* () {
  const store = yield* SessionStore;
  const connectionId = yield* ConnectionId;
  yield* store.unregister(connectionId);
});
