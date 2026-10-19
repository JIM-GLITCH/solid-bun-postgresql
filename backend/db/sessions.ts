/**
 * 会话生命周期（对外 API）：连接注册表、建连/断开、keepalive、事件推送、路由判定。
 *
 * Phase 2：内部实现已由 `db/sessions-effect.ts` 的 Effect 服务接管
 * （per-connection `Scope` + `FiberMap` keepalive + `ManagedRuntime`）；
 * 本文件保留**同步读取**与既有导出名，使业务 handler / 传输层无需改动。
 *
 * 边界约定：
 * - 连接句柄的唯一持有者是各 `DbConnector`（见 `db/connector-*.ts`）。
 * - 业务 handler **不得**读写 `SessionConnection` 上的连接句柄；只能通过 `DbConnector` 访问。
 */

import {
  type ConnectDbRequest,
  type DbKind,
  type SSEMessage,
  defaultDatabaseCapabilities,
  isMysqlFamily,
} from "../../shared/src";
import { connectPostgres } from "../connect-postgres";
import type { Client } from "pg";
import { teardownSqlServerRowStream } from "../sqlserver-mssql-query";
import type {
  MysqlSessionConnection,
  SessionConnection,
  SqlServerSessionConnection,
} from "../session-connection";
import type { DbConnector } from "./contract";
import {
  connectorOf,
  disposeConnectorOf,
  projectionGet,
  projectionSize,
  sessionInfoOf,
  sessionsRuntime,
  setRecreateUserClient,
  setSendSSEMessage,
  projectionValues as projectionValuesFromEffect,
} from "./sessions-effect";
import type { SessionInfo } from "./contract";

// ── 同步读取（handler 侧 API 是同步的，由 Effect 模块维护投影）──────

export function getSession(connectionId: string): SessionConnection | undefined {
  return projectionGet(connectionId);
}

export function getSessionDbKind(connectionId: string): DbKind | undefined {
  return projectionGet(connectionId)?.dbKind;
}

/** 供测试/诊断使用：当前活跃会话数 */
export function sessionCount(): number {
  return projectionSize();
}

/** 供诊断：当前投影中的会话 */
export function listSessions(): SessionConnection[] {
  return projectionValuesFromEffect();
}

// ── 事件推送 ──────────────────────────────────────────────────

/** 向指定连接的所有订阅者推送一条事件；无会话则静默忽略 */
export function sendSSEMessage(connectionId: string, message: SSEMessage): void {
  const conn = projectionGet(connectionId);
  if (!conn) return;

  for (const push of conn.eventPushers) {
    try {
      push(message);
    } catch {
      conn.eventPushers.delete(push);
    }
  }
}

/** 订阅连接的事件推送，返回取消订阅函数 */
export function subscribeSessionEvents(
  connectionId: string,
  push: (msg: SSEMessage) => void
): () => void {
  const conn = projectionGet(connectionId);
  if (!conn) throw new Error("未找到数据库连接，请先连接数据库");

  conn.eventPushers.add(push);
  return () => conn.eventPushers.delete(push);
}

// ── pg 客户端事件 → 会话事件 ──────────────────────────────────

export function attachPostgresClientHandlers(cid: string, client: Client): void {
  client.on("error", (err: Error) => {
    console.error(`[PostgreSQL client error for ${cid}]`, err);
    sendSSEMessage(cid, { type: "ERROR", message: err.message || String(err), timestamp: Date.now() });
  });
  client.on("notice", (msg: any) => {
    const severity = (msg.severity || "NOTICE").toUpperCase();
    sendSSEMessage(cid, {
      type: severity as SSEMessage["type"],
      message: msg.message || String(msg),
      timestamp: Date.now(),
      detail: msg.detail || msg.hint || undefined,
    });
  });
  client.on("notification", (msg: any) => {
    sendSSEMessage(cid, {
      type: "NOTIFICATION",
      message: `[${msg.channel}] ${msg.payload || "(无内容)"}`,
      timestamp: Date.now(),
    });
  });
  client.on("end", () => {
    console.warn(`[PostgreSQL connection ended for ${cid}]`);
    sendSSEMessage(cid, { type: "WARNING", message: "数据库连接已断开", timestamp: Date.now() });
  });
}

/** 同步取连接器（业务访问连接能力的唯一入口） */
export function sessionConnectorOf(cid: string): DbConnector | undefined {
  return connectorOf(cid);
}

/**
 * 会话摘要（**传输层/业务应当读的收窄形状**，不含任何连接句柄）。
 * 需要连接能力时用 `sessionConnectorOf`（仅业务 handler 内部使用）。
 */
export function getSessionInfo(cid: string): SessionInfo | undefined {
  return sessionInfoOf(cid);
}

// ── 路由判定 ──────────────────────────────────────────────────

/**
 * `db/*` 是否交给 MySQL 处理器（与 PostgreSQL 二选一）。
 * 建连看载荷 `dbType`；已建连看会话 `dbKind`。
 */
export function shouldRouteDbRequestToMysql(method: string, payload: unknown): boolean {
  if (!method.startsWith("db/")) return false;
  if (method === "db/connect") {
    return isMysqlFamily((payload as ConnectDbRequest).dbType);
  }
  const cid = (payload as { connectionId?: string }).connectionId;
  if (cid == null || String(cid) === "") return false;
  const k = getSessionDbKind(String(cid));
  return k != null && isMysqlFamily(k);
}

export function shouldRouteDbRequestToSqlServer(method: string, payload: unknown): boolean {
  if (!method.startsWith("db/")) return false;
  if (method === "db/connect") {
    return (payload as ConnectDbRequest).dbType === "sqlserver";
  }
  const cid = (payload as { connectionId?: string }).connectionId;
  if (cid == null || String(cid) === "") return false;
  return getSessionDbKind(String(cid)) === "sqlserver";
}

// ── 死连接判定 ────────────────────────────────────────────────
// 注意：目前仍以错误文案正则判定，属既有实现；后续可改为类型优先、正则为兜底。

export function isPgUserClientDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /not queryable|connection error|Connection terminated/i.test(msg);
}

export function isMysqlUserClientDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /Connection lost|ECONNRESET|PROTOCOL_CONNECTION_LOST|not connected/i.test(msg);
}

export function isSqlServerPoolDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /ECONNRESET|Connection lost|socket|timeout|closed|Failed to connect|broken/i.test(msg);
}

// ── 查询专用连接的重建 ────────────────────────────────────────

/** Monaco 等使用的长连接 Client 异常后 pg 会报 not queryable；连接池仍可用故侧栏只读查询正常 */
export async function recreateUserUsedClient(cid: string): Promise<void> {
  const session = projectionGet(cid);
  if (!session) throw new Error("连接不存在");
  if (session.dbKind !== "postgres") throw new Error("内部错误：非 PostgreSQL 会话");
  // 游标由连接器持有，先让它释放
  await disposeConnectorOf(cid);
  session.runningQueryPid = undefined;
  await session.userUsedClient.end().catch(() => {});
  const client = await connectPostgres(session.dbForReconnect);
  attachPostgresClientHandlers(cid, client);
  session.userUsedClient = client;
  sendSSEMessage(cid, { type: "INFO", message: "查询专用连接已自动重建", timestamp: Date.now() });
}

export async function recreateMysqlUserUsedClient(cid: string): Promise<void> {
  const session = projectionGet(cid);
  if (!session) throw new Error("连接不存在");
  if (!isMysqlFamily(session.dbKind)) throw new Error("内部错误：非 MySQL/MariaDB 会话");
  const m = session as MysqlSessionConnection;
  // 行流由连接器持有，先让它释放
  await disposeConnectorOf(cid);
  try {
    m.userUsedClient.release();
  } catch {
    /* ignore */
  }
  const conn = await m.backGroundPool.getConnection();
  m.userUsedClient = conn;
  sendSSEMessage(cid, { type: "INFO", message: "查询专用连接已自动重建", timestamp: Date.now() });
}

export async function recreateSqlServerPool(cid: string): Promise<void> {
  const session = projectionGet(cid);
  if (!session) throw new Error("连接不存在");
  if (session.dbKind !== "sqlserver") throw new Error("内部错误：非 SQL Server 会话");
  const s = session as SqlServerSessionConnection;
  if (s.sqlServerRowStream) {
    await teardownSqlServerRowStream(s.sqlServerRowStream);
    s.sqlServerRowStream = undefined;
  }
  s.sqlServerActiveRequest = undefined;
  await s.userUsedClient.close().catch(() => {});
  const pool = await openSqlServerPoolLazy(s.dbForReconnect);
  s.userUsedClient = pool;
  s.backGroundPool = pool;
  sendSSEMessage(cid, { type: "INFO", message: "SQL Server 连接池已自动重建", timestamp: Date.now() });
}

/** 延迟引入，避免 sessions 模块顶层依赖 sqlserver 连接模块的加载顺序 */
async function openSqlServerPoolLazy(db: SqlServerSessionConnection["dbForReconnect"]) {
  const mod = await import("../connect-sqlserver");
  return mod.openSqlServerPool(db);
}

// keepalive 探测失败后统一走这条重建路径（Effect 服务在探测捕获后调用）
setRecreateUserClient(async (cid) => {
  const session = projectionGet(cid);
  if (!session) return;
  if (session.dbKind === "postgres") await recreateUserUsedClient(cid);
  else if (session.dbKind === "sqlserver") await recreateSqlServerPool(cid);
  else await recreateMysqlUserUsedClient(cid);
});

// 注入 SSE 发送函数到 Effect 模块（避免循环依赖）
setSendSSEMessage(sendSSEMessage);

// ── keepalive（Phase 2：由 Effect 的 FiberMap 承载）────────────
// 保留同名导出以兼容既有 ctx 签名；真正的探测 fiber 在会话建立时由 Effect 服务启动，
// 随会话 Scope 关闭自动中断，无需手动开关。

export function stopUserClientKeepalive(_session: SessionConnection): void {
  /* no-op：fiber 生命周期由会话 Scope 管理 */
}

export function startUserClientKeepalive(_cid: string): void {
  /* no-op：见上 */
}

/** 方言对外的别名，保留以兼容既有 ctx 签名 */
export function startMysqlUserClientKeepalive(_cid: string): void {
  /* no-op */
}

/** 进程退出收口：释放所有连接、keepalive fiber 与 scope */
export function disposeAllSessions(): Promise<void> {
  return sessionsRuntime.disposeAll();
}

let disposeHookInstalled = false;

/**
 * 安装进程退出收口。
 *
 * Phase 2 起 keepalive 是 Effect 的常驻 fiber，若不收口会阻止进程正常退出；
 * 这里在 `beforeExit` / `SIGINT` / `SIGTERM` 上释放运行时（`ManagedRuntime.dispose()`
 * 会关闭服务级 scope，从而中断全部 keepalive fiber 并触发连接 release）。
 *
 * 幂等；由 `api-core` 在模块加载时调用一次。
 */
export function installSessionDisposeOnExit(): void {
  if (disposeHookInstalled) return;
  disposeHookInstalled = true;

  const dispose = () => {
    void disposeAllSessions().catch(() => {});
  };
  process.once("beforeExit", dispose);
  process.once("SIGINT", dispose);
  process.once("SIGTERM", dispose);
  // 兜底：宿主进程显式 exit 时同步触发一次（异步清理不保证完成，但要尽力）
  process.once("exit", dispose);
}

// ── 建连 / 断开 ───────────────────────────────────────────────

/**
 * 建立连接并登记到注册表。载荷 `dbType` 决定方言；同 id 已存在时先断开。
 * 返回体与搬移前三个 handler 的 `db/connect` 分支完全一致。
 */
export async function connectSession(
  params: ConnectDbRequest
): Promise<{ success: true; connectionId: string; dbType: DbKind }> {
  return sessionsRuntime.connect(params);
}

/** 断开并释放连接资源（供 tRPC / SSE 关闭 / 页面卸载 beacon 调用） */
export async function disconnectConnection(connectionId: string): Promise<void> {
  await sessionsRuntime.disconnect(connectionId);
}

/** 方言能力查询（业务层按会话 dbKind 取值） */
export function capabilitiesForKind(kind: DbKind) {
  return defaultDatabaseCapabilities(kind);
}

/** 会话方言校验：保持既有空实现语义（不做校验），避免行为变化 */
export function assertSessionDbType(session: SessionConnection, dbType: DbKind | undefined): void {
  void session;
  void dbType;
}

/**
 * 断开前或新建流式查询前：销毁进行中的 mysql 行流。
 * 实现已随连接器内聚到 `db-handlers/strategies/mysql-strategy-effect.ts`，此处再导出以兼容既有调用方。
 */
export function teardownMysqlStreaming(session: MysqlSessionConnection): void {
  const s = session.mysqlRowStream;
  if (s && !s.destroyed) {
    s.destroy();
  }
  session.mysqlRowStream = undefined;
  session.mysqlRunningThreadId = undefined;
}
