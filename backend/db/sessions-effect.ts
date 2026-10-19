/**
 * Effect 版会话存储（Phase 2 核心）。
 *
 * 设计要点（均已在 effect@4.0.2 上实测验证，见设计文档 §0）：
 * - `Context.Service` + `Layer.effect`：服务层自带 scope，**不可再套 `Effect.scoped`**
 * - 每条连接一个 `Scope.make()`，`acquireRelease` 必须经 `Scope.provide` 注册进该 scope，
 *   否则 release 不会执行
 * - keepalive 用 `Effect.forkIn(fiber, serviceScope)` 存活跨 `runPromise`，
 *   再 `FiberMap.set(map, key, fiber)`（**传已 fork 的 fiber**，不是 Effect）
 * - `ManagedRuntime.dispose()` 会触发 layer 内 release
 *
 * 同步读取（`getSession` / `getConnector`）沿用投影 Map：handler 侧是同步 API，
 * 不能改成 async。投影与 Effect 内的真理源由本模块统一维护。
 */

import { Context, Effect, Exit, FiberMap, Layer, ManagedRuntime, Ref, Scope } from "effect";
import {
  type ConnectDbRequest,
  type DbKind,
  type SSEMessage,
  defaultDatabaseCapabilities,
  isMysqlFamily,
} from "../../shared/src";
import {
  connectPostgres,
  createPostgresPool,
  getDbConfig,
  type GetDbConfigResult,
} from "../connect-postgres";
import { createMysqlPool, getMysqlDbConfig, type GetMysqlDbConfigResult } from "../connect-mysql";
import { getSqlServerDbConfig, openSqlServerPool, type GetSqlServerDbConfigResult } from "../connect-sqlserver";
import type { SessionConnection } from "../session-connection";
import { createPgConnector } from "../db-handlers/strategies/postgres-strategy-effect";
import { isConnectionLost } from "./errors";
import { createMysqlConnector } from "../db-handlers/strategies/mysql-strategy-effect";
import { createMssqlConnector } from "../db-handlers/strategies/sqlserver-strategy-effect";
import type { ConnectionId, DbConnector, SessionInfo } from "./contract";

/** 探活间隔：略小于常见 idle 超时，避免首条 Monaco 查询才暴露死连接 */
export const USER_CLIENT_KEEPALIVE_MS = 60_000;

/** 本地事件发送函数（避免循环依赖） */
let localSendSSEMessage: (cid: ConnectionId, msg: SSEMessage) => void = () => {};

/** 注入 SSE 发送函数供 Effect 模块使用 */
export function setSendSSEMessage(fn: (cid: ConnectionId, msg: SSEMessage) => void): void {
  localSendSSEMessage = fn;
}

interface Entry {
  readonly connectionId: ConnectionId;
  readonly dbKind: DbKind;
  /** 会话对象（连接句柄的持有者；连接器内部使用） */
  readonly session: SessionConnection;
  readonly connector: DbConnector;
  /** 该连接独占的 scope：关闭即触发 release 链 */
  readonly scope: Scope.Closeable;
  readonly listeners: Set<(msg: SSEMessage) => void>;
  /** 事件互斥：keepalive 的探活期间跳过（与既有实现同义） */
  readonly hasActiveStream: () => boolean;
}

/** 同步投影：供 handler 的同步读取路径使用（与 Effect 内的真理源保持一致） */
const projection = new Map<ConnectionId, SessionConnection>();

/**
 * 连接器投影：连接器不再挂在 `SessionConnection` 上（Phase 3 收窄），
 * 由本模块统一持有，业务侧经 `connectorOf` 同步获取。
 */
const connectors = new Map<ConnectionId, DbConnector>();

// ── Effect 服务 ───────────────────────────────────────────────

class DbSessions extends Context.Service<DbSessions, DbSessionsShape>()("DbSessions") {}

interface DbSessionsShape {
  readonly connect: (spec: ConnectDbRequest) => Effect.Effect<{ success: true; connectionId: string; dbType: DbKind }, Error>;
  readonly disconnect: (cid: ConnectionId) => Effect.Effect<void>;
  readonly reconnect: (cid: ConnectionId) => Effect.Effect<void>;
  readonly emit: (cid: ConnectionId, msg: SSEMessage) => Effect.Effect<void>;
  readonly getConnector: (cid: ConnectionId) => Effect.Effect<DbConnector | undefined>;
  readonly count: Effect.Effect<number>;
  /** 释放全部连接与 keepalive fiber（进程退出收口） */
  readonly disposeAll: Effect.Effect<void>;
}

/** 资源释放（方言语义取并集；顺序不可颠倒：先流式句柄与 DB 连接，最后隧道） */
const releaseSession = (session: SessionConnection): Effect.Effect<void> =>
  Effect.promise(async () => {
    // 方言语义取并集；顺序不可颠倒（先流式句柄/DB 连接，最后隧道）
    if (session.dbKind === "postgres") {
      await session.userUsedClient.end().catch(() => {});
      await session.backGroundPool.end().catch(() => {});
    } else if (session.dbKind === "sqlserver") {
      await session.userUsedClient.close().catch(() => {});
    } else {
      try {
        session.userUsedClient.release();
      } catch {
        /* ignore */
      }
      await session.backGroundPool.end().catch(() => {});
    }
    await session.closeTunnel?.().catch(() => {});
  });

/** 打开一条连接（含连接器装配），返回会话对象与连接器 */
async function openSession(
  spec: ConnectDbRequest
): Promise<{ session: SessionConnection; connector: DbConnector; dbType: DbKind }> {
  const { connectionId: cid, dbType, ...connectParams } = spec;
  const loginParams = { ...connectParams, password: connectParams.password ?? "" };

  if (dbType === "sqlserver") {
    const db: GetSqlServerDbConfigResult = await getSqlServerDbConfig(loginParams);
    const pool = await openSqlServerPool(db);
    const session: SessionConnection = {
      dbKind: "sqlserver",
      userUsedClient: pool,
      backGroundPool: pool,
      dbForReconnect: db,
      eventPushers: new Set(),
      closeTunnel: db.closeTunnel,
    };
    const connector = createMssqlConnector(session, {
      connectionId: cid,
      capabilities: defaultDatabaseCapabilities("sqlserver"),
    });
    return { session, connector, dbType: "sqlserver" };
  }

  if (isMysqlFamily(dbType)) {
    const db: GetMysqlDbConfigResult = await getMysqlDbConfig(loginParams);
    const pool = createMysqlPool(db);
    const userConn = await pool.getConnection();
    const initialDb = String(loginParams.database ?? "").trim();
    const session: SessionConnection = {
      dbKind: dbType,
      userUsedClient: userConn,
      backGroundPool: pool,
      dbForReconnect: db,
      eventPushers: new Set(),
      closeTunnel: db.closeTunnel,
      ...(initialDb ? { mysqlCurrentDatabase: initialDb } : {}),
    };
    const connector = createMysqlConnector(session, {
      connectionId: cid,
      capabilities: defaultDatabaseCapabilities(dbType),
      isDeadError: (e) => isConnectionLost(e, "mysql"),
      recreateUserClient: () => recreateUserClient(cid),
    });
    return { session, connector, dbType };
  }

  if (dbType !== "postgres") {
    throw new Error(`不支持的数据库类型：${String(dbType)}`);
  }

  const db: GetDbConfigResult = await getDbConfig(loginParams);
  const client = await connectPostgres(db);
  const adminPool = createPostgresPool(db);
  const session: SessionConnection = {
    dbKind: "postgres",
    userUsedClient: client,
    backGroundPool: adminPool,
    dbForReconnect: db,
    eventPushers: new Set(),
    closeTunnel: db.closeTunnel,
  };
  const connector = createPgConnector(session, {
    connectionId: cid,
    capabilities: defaultDatabaseCapabilities("postgres"),
    isDeadError: (e) => isConnectionLost(e, "postgres"),
    recreateUserClient: () => recreateUserClient(cid),
  });
  return { session, connector, dbType: "postgres" };
}

/**
 * 重建钩子注入：由 `sessions.ts` 提供实现（避免本模块反向依赖方言 handler）。
 * 用 Ref 承载，保证 makeSessions 执行时拿到的是最终实现。
 */
const recreateRef = Ref.makeUnsafe<(cid: ConnectionId) => Promise<void>>(async () => {});

export function setRecreateUserClient(fn: (cid: ConnectionId) => Promise<void>): void {
  Effect.runSync(Ref.set(recreateRef, fn));
}

function recreateUserClient(cid: ConnectionId): Promise<void> {
  return Effect.runSync(Ref.get(recreateRef))(cid);
}

/** 构造 DbSessions 服务（需要 Layer 提供的 scope 承载 keepalive fiber） */
function makeSessions(): Effect.Effect<DbSessionsShape, Error, Scope.Scope> {
  return Effect.gen(function* () {
  const entries = yield* Ref.make(new Map<ConnectionId, Entry>());
  const keepalives = yield* FiberMap.make<ConnectionId, void, never>();
  // 服务级 scope：keepalive fiber 挂在这里，跨多次 runPromise 存活
  const serviceScope = yield* Effect.scope;

  const getEntry = (cid: ConnectionId) =>
    Ref.get(entries).pipe(Effect.map((m) => m.get(cid)));

  const stopKeepalive = (cid: ConnectionId) =>
    FiberMap.remove(keepalives, cid).pipe(Effect.catch(() => Effect.void));

  const startKeepalive = (entry: Entry) => {
    const probe = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (entry.hasActiveStream()) return;
        const s = entry.session;
        if (s.dbKind === "postgres") {
          yield* Effect.tryPromise({
            try: () => s.userUsedClient.query("SELECT 1 --keepalive"),
            catch: (e) => new Error(e instanceof Error ? e.message : String(e))
          }).pipe(
            Effect.catch((e) => Effect.gen(function* () {
              // 通知前端连接断开
              yield* Effect.sync(() => {
                localSendSSEMessage(entry.connectionId, {
                  type: "ERROR",
                  message: `数据库连接已断开: ${e instanceof Error ? e.message : String(e)}`,
                  timestamp: Date.now(),
                });
              });
              // 尝试重建连接
              yield* Effect.promise(() => recreateUserClient(entry.connectionId)).pipe(Effect.catch(() => Effect.void));
            }))
          );
        } else if (s.dbKind === "sqlserver") {
          yield* Effect.tryPromise({
            try: () => s.userUsedClient.request().query("SELECT 1"),
            catch: (e) => new Error(e instanceof Error ? e.message : String(e))
          }).pipe(
            Effect.catch((e) => Effect.gen(function* () {
              // 通知前端连接断开
              yield* Effect.sync(() => {
                localSendSSEMessage(entry.connectionId, {
                  type: "ERROR",
                  message: `数据库连接已断开: ${e instanceof Error ? e.message : String(e)}`,
                  timestamp: Date.now(),
                });
              });
              // 尝试重建连接
              yield* Effect.promise(() => recreateUserClient(entry.connectionId)).pipe(Effect.catch(() => Effect.void));
            }))
          );
        } else {
          yield* Effect.tryPromise({
            try: () => s.userUsedClient.query("SELECT 1"),
            catch: (e) => new Error(e instanceof Error ? e.message : String(e))
          }).pipe(
            Effect.catch((e) => Effect.gen(function* () {
              // 通知前端连接断开
              yield* Effect.sync(() => {
                localSendSSEMessage(entry.connectionId, {
                  type: "ERROR",
                  message: `数据库连接已断开: ${e instanceof Error ? e.message : String(e)}`,
                  timestamp: Date.now(),
                });
              });
              // 尝试重建连接
              yield* Effect.promise(() => recreateUserClient(entry.connectionId)).pipe(Effect.catch(() => Effect.void));
            }))
          );
        }
      });

    const fiber = Effect.forever(Effect.andThen(probe(), Effect.sleep(USER_CLIENT_KEEPALIVE_MS)));
    return Effect.gen(function* () {
      const f = yield* Effect.forkIn(fiber, serviceScope);
      yield* FiberMap.set(keepalives, entry.connectionId, f);
    });
  };

  const disposeEntry = (entry: Entry) =>
    Effect.gen(function* () {
      yield* stopKeepalive(entry.connectionId);
      // 关闭该连接独占的 scope → 触发 release 链
      yield* Scope.close(entry.scope, Exit.void);
    });

  const connect: DbSessionsShape["connect"] = (spec) =>
    Effect.gen(function* () {
      const cid = spec.connectionId;
      // 同 id 已存在：先断开（幂等）
      const existing = yield* getEntry(cid);
      if (existing) yield* disposeEntry(existing);

      const scope = yield* Scope.make("sequential");
      const opened = yield* Scope.provide(
        Effect.acquireRelease(
          Effect.tryPromise({
            try: () => openSession(spec),
            catch: (e) => new Error(e instanceof Error ? e.message : String(e))
          }),
          (o) => Scope.provide(releaseSession(o.session), scope)
        ),
        scope
      );

      const entry: Entry = {
        connectionId: cid,
        dbKind: opened.dbType,
        session: opened.session,
        connector: opened.connector,
        scope,
        listeners: new Set(),
        hasActiveStream: () =>
          !!(opened.session as { cursor?: unknown }).cursor ||
          !!(opened.session as { mysqlRowStream?: unknown }).mysqlRowStream ||
          !!(opened.session as { sqlServerRowStream?: unknown }).sqlServerRowStream,
      };

      yield* Ref.update(entries, (m) => new Map(m).set(cid, entry));
      projection.set(cid, opened.session);
      connectors.set(cid, opened.connector);
      yield* startKeepalive(entry);

      return { success: true as const, connectionId: cid, dbType: opened.dbType };
    });

  const disconnect: DbSessionsShape["disconnect"] = (cid) =>
    Effect.gen(function* () {
      const entry = yield* getEntry(cid);
      if (!entry) return;
      yield* Ref.update(entries, (m) => {
        const n = new Map(m);
        n.delete(cid);
        return n;
      });
      projection.delete(cid);
      connectors.delete(cid);
      yield* disposeEntry(entry);
    });

  const reconnect: DbSessionsShape["reconnect"] = (cid) =>
    Effect.gen(function* () {
      const entry = yield* getEntry(cid);
      if (!entry) return;
      yield* Effect.promise(() => recreateUserClient(cid)).pipe(Effect.catch(() => Effect.void));
    });

  const emit: DbSessionsShape["emit"] = (cid, msg) =>
    Effect.sync(() => {
      const session = projection.get(cid);
      if (!session) return;
      for (const push of session.eventPushers) {
        try {
          push(msg);
        } catch {
          session.eventPushers.delete(push);
        }
      }
    });

  const getConnector: DbSessionsShape["getConnector"] = (cid) =>
    getEntry(cid).pipe(Effect.map((e) => e?.connector));

  const count = Ref.get(entries).pipe(Effect.map((m) => m.size));

  /**
   * 释放全部会话。
   * 注意：必须显式遍历并 disposeEntry —— 只调 `ManagedRuntime.dispose()` 不会清理
   * `Ref` 里的条目与投影，keepalive fiber 会继续挂住进程。
   */
  const disposeAll: Effect.Effect<void> = Effect.gen(function* () {
    const snapshot = [...(yield* Ref.get(entries)).values()];
    yield* Effect.forEach(snapshot, (e) => disposeEntry(e), { concurrency: "unbounded" }).pipe(
      Effect.catch(() => Effect.void)
    );
    yield* Ref.set(entries, new Map());
    yield* Effect.sync(() => {
      projection.clear();
      connectors.clear();
    });
  });

  return { connect, disconnect, reconnect, emit, getConnector, count, disposeAll };
  });
}

const DbSessionsLive = Layer.effect(DbSessions, makeSessions());

// ── 运行时与 Promise 门面 ─────────────────────────────────────

let runtime = ManagedRuntime.make(DbSessionsLive);

const run = <A, E>(eff: Effect.Effect<A, E, DbSessions>): Promise<A> => runtime.runPromise(eff as Effect.Effect<A, E, never>);

export const sessionsRuntime = {
  connect: (spec: ConnectDbRequest) => run(Effect.flatMap(DbSessions, (s) => s.connect(spec))).catch((e) => {
    console.error("[sessionsRuntime.connect error]", e);
    throw e; // 重新抛出，让上层处理
  }),
  disconnect: (cid: ConnectionId) => run(Effect.flatMap(DbSessions, (s) => s.disconnect(cid))).catch((e) => {
    console.error("[sessionsRuntime.disconnect error]", e);
    // 断开错误可以忽略，因为连接可能已经断开
  }),
  reconnect: (cid: ConnectionId) => run(Effect.flatMap(DbSessions, (s) => s.reconnect(cid))).catch((e) => {
    console.error("[sessionsRuntime.reconnect error]", e);
    // 重连错误通过 SSE 通知
    localSendSSEMessage(cid, {
      type: "ERROR",
      message: `重连失败: ${e instanceof Error ? e.message : String(e)}`,
      timestamp: Date.now(),
    });
  }),
  emit: (cid: ConnectionId, msg: SSEMessage) => run(Effect.flatMap(DbSessions, (s) => s.emit(cid, msg))).catch((e) => {
    console.error("[sessionsRuntime.emit error]", e);
    // 事件发送失败可以忽略
  }),
  getConnector: (cid: ConnectionId) => run(Effect.flatMap(DbSessions, (s) => s.getConnector(cid))).catch((e) => {
    console.error("[sessionsRuntime.getConnector error]", e);
    return undefined;
  }),
  count: () => run(Effect.flatMap(DbSessions, (s) => s.count)).catch((e) => {
    console.error("[sessionsRuntime.count error]", e);
    return 0;
  }),
  /** 进程退出收口：先释放所有会话（关 scope + 中断 fiber），再释放运行时 */
  disposeAll: async () => {
    await run(Effect.flatMap(DbSessions, (s) => s.disposeAll));
    await runtime.dispose();
  },
  /** 供测试：重建运行时 */
  resetRuntime: async () => {
    await runtime.dispose();
    runtime = ManagedRuntime.make(DbSessionsLive);
  },
};

/** 同步读取投影（handler 侧 API 是同步的） */
export function projectionGet(cid: ConnectionId): SessionConnection | undefined {
  return projection.get(cid);
}

/** 同步取连接器（自 api-core 的唯一连接入口；不再经 session 对象携带） */
export function connectorOf(cid: ConnectionId): DbConnector | undefined {
  return connectors.get(cid);
}

/**
 * 同步取会话摘要（**唯一对外安全形状**，不含任何连接句柄）。
 * 传输层/业务只应读它，而不是 `SessionConnection`。
 */
export function sessionInfoOf(cid: ConnectionId): SessionInfo | undefined {
  const session = projection.get(cid);
  const connector = connectors.get(cid);
  if (!session) return undefined;
  return {
    connectionId: cid,
    dbKind: session.dbKind,
    ...(connector?.currentDatabase?.() ? { currentDatabase: connector.currentDatabase() } : {}),
  };
}

/** 释放某会话连接器自持的资源（游标/行流）；用于重建连接前 */
export async function disposeConnectorOf(cid: ConnectionId): Promise<void> {
  await connectors.get(cid)?.dispose().catch(() => {});
}

export function projectionHas(cid: ConnectionId): boolean {
  return projection.has(cid);
}

export function projectionSize(): number {
  return projection.size;
}

export function projectionValues(): SessionConnection[] {
  return [...projection.values()];
}

/** 获取所有活跃的 connectionId（供全局错误处理使用） */
export function projectionKeys(): ConnectionId[] {
  return [...projection.keys()];
}
