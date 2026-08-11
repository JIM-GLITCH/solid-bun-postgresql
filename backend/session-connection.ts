/**
 * 数据库会话类型 + 运行时连接管理（connectionMap / keepalive / disconnect / SSE 推送）
 */

import type { Client, Pool } from "pg";
import type Cursor from "pg-cursor";
import type { Readable } from "node:stream";
import type { Pool as MysqlPool, PoolConnection } from "mysql2/promise";
import type { ConnectionPool as MssqlConnectionPool, Request as MssqlRequest } from "mssql";
import type { SqlServerStreamingQueryHandle } from "./sqlserver-mssql-stream";
import {
  getSqlSegments,
  type DbKind,
  type SSEMessage,
  defaultDatabaseCapabilities,
  isMysqlFamily,
} from "../shared/src";
import { connectPostgres, type GetDbConfigResult } from "./connect-postgres";
import type { GetMysqlDbConfigResult } from "./connect-mysql";
import { openSqlServerPool, type GetSqlServerDbConfigResult } from "./connect-sqlserver";
import { teardownSqlServerRowStream } from "./sqlserver-mssql-stream";
import { teardownMysqlStreaming } from "./drivers/mysql-driver";

export interface PostgresSessionConnection {
  dbKind: "postgres";
  userUsedClient: Client;
  backGroundPool: Pool;
  dbForReconnect: GetDbConfigResult;
  runningQueryPid?: number;
  rpcPush?: (msg: SSEMessage) => void;
  closeTunnel?: () => Promise<void>;
  cursor?: {
    instance: Cursor;
    columns?: any[];
    isDone: boolean;
  };
  keepAliveTimer?: ReturnType<typeof setInterval>;
}

export interface MysqlSessionConnection {
  dbKind: "mysql" | "mariadb";
  userUsedClient: PoolConnection;
  backGroundPool: MysqlPool;
  dbForReconnect: GetMysqlDbConfigResult;
  rpcPush?: (msg: SSEMessage) => void;
  closeTunnel?: () => Promise<void>;
  keepAliveTimer?: ReturnType<typeof setInterval>;
  /** db/query-stream 未读完的 MySQL 行流（mysql2 协议层流式，非整结果集缓冲） */
  mysqlRowStream?: Readable;
  /** 当前在 userUsedClient 上执行语句时的连接线程号，供 KILL QUERY */
  mysqlRunningThreadId?: number;
  /** 最近通过 USE / defaultSchema 选中的库，用于未带库名的 SQL */
  mysqlCurrentDatabase?: string;
}

/** SQL Server：查询与侧栏共用同一 ConnectionPool（无独立「长连接」句柄） */
export interface SqlServerSessionConnection {
  dbKind: "sqlserver";
  /** node-mssql `ConnectionPool`（类型见 `@types/mssql`） */
  userUsedClient: MssqlConnectionPool;
  backGroundPool: MssqlConnectionPool;
  dbForReconnect: GetSqlServerDbConfigResult;
  rpcPush?: (msg: SSEMessage) => void;
  closeTunnel?: () => Promise<void>;
  keepAliveTimer?: ReturnType<typeof setInterval>;
  /** db/query-stream 未读完时的 mssql 流式请求 + 事务，须 teardown 后归还池 */
  sqlServerRowStream?: SqlServerStreamingQueryHandle;
  /** `db/query` 等非流式路径上可 `cancel()` 的当前 Request（由 `runSqlServerQueryWithColumnMetadata` 登记） */
  sqlServerActiveRequest?: MssqlRequest | null;
}

export type SessionConnection = PostgresSessionConnection | MysqlSessionConnection | SqlServerSessionConnection;

export function isPostgresSession(s: SessionConnection): s is PostgresSessionConnection {
  return s.dbKind === "postgres";
}

// ─── 连接运行时管理 ─────────────────────────────────────────────────────────

/** 以 connectionId 为 key 存储多个连接 */
export const connectionMap = new Map<string, SessionConnection>();

export function getSession(connectionId: string): SessionConnection | undefined {
  return connectionMap.get(connectionId);
}

export function sendSSEMessage(connectionId: string, message: SSEMessage) {
  connectionMap.get(connectionId)?.rpcPush?.(message);
}

export function assertSessionDbType(session: SessionConnection, dbType: DbKind | undefined): void {
  void session;
  void dbType;
}

export function capabilitiesForKind(kind: DbKind) {
  return defaultDatabaseCapabilities(kind);
}

export function isPgUserClientDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /not queryable|connection error|Connection terminated/i.test(msg);
}

function isMysqlUserClientDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /Connection lost|ECONNRESET|PROTOCOL_CONNECTION_LOST|not connected/i.test(msg);
}

function isSqlServerPoolDeadError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return /ECONNRESET|Connection lost|socket|timeout|closed|Failed to connect|broken/i.test(msg);
}

export function attachPostgresClientHandlers(cid: string, client: Client): void {
  client.on("error", (err: Error) => {
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
    sendSSEMessage(cid, { type: "WARNING", message: "数据库连接已断开", timestamp: Date.now() });
  });
}

/** Monaco 等使用的长连接 Client 异常后 pg 会报 not queryable；连接池仍可用故侧栏只读查询正常 */
export async function recreateUserUsedClient(cid: string): Promise<void> {
  const session = connectionMap.get(cid);
  if (!session) throw new Error("连接不存在");
  if (session.dbKind !== "postgres") throw new Error("内部错误：非 PostgreSQL 会话");
  if (session.cursor) {
    try {
      await new Promise<void>((r) => session.cursor!.instance.close(() => r()));
    } catch {
      /* ignore */
    }
    session.cursor = undefined;
  }
  session.runningQueryPid = undefined;
  await session.userUsedClient.end().catch(() => {});
  const client = await connectPostgres(session.dbForReconnect);
  attachPostgresClientHandlers(cid, client);
  session.userUsedClient = client;
  sendSSEMessage(cid, { type: "INFO", message: "查询专用连接已自动重建", timestamp: Date.now() });
}

async function recreateMysqlUserUsedClient(cid: string): Promise<void> {
  const session = connectionMap.get(cid);
  if (!session) throw new Error("连接不存在");
  if (!isMysqlFamily(session.dbKind)) throw new Error("内部错误：非 MySQL/MariaDB 会话");
  const m = session as MysqlSessionConnection;
  try {
    m.userUsedClient.release();
  } catch {
    /* ignore */
  }
  const conn = await m.backGroundPool.getConnection();
  m.userUsedClient = conn;
  sendSSEMessage(cid, { type: "INFO", message: "查询专用连接已自动重建", timestamp: Date.now() });
}

async function recreateSqlServerPool(cid: string): Promise<void> {
  const session = connectionMap.get(cid);
  if (!session) throw new Error("连接不存在");
  if (session.dbKind !== "sqlserver") throw new Error("内部错误：非 SQL Server 会话");
  const s = session as SqlServerSessionConnection;
  if (s.sqlServerRowStream) {
    await teardownSqlServerRowStream(s.sqlServerRowStream);
    s.sqlServerRowStream = undefined;
  }
  s.sqlServerActiveRequest = undefined;
  await s.userUsedClient.close().catch(() => {});
  const pool = await openSqlServerPool(s.dbForReconnect);
  s.userUsedClient = pool;
  s.backGroundPool = pool;
  sendSSEMessage(cid, { type: "INFO", message: "SQL Server 连接池已自动重建", timestamp: Date.now() });
}

/** 以不在引号/注释内的 ; 拆成多条语句 */
export function getStatements(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

/** 探活间隔：略小于常见 idle 超时，避免首条 Monaco 查询才暴露死连接 */
const USER_CLIENT_KEEPALIVE_MS = 60_000;
const USER_CLIENT_KEEPALIVE_SQL = "SELECT 1 --keepalive";

export function stopUserClientKeepalive(session: SessionConnection): void {
  if (session.keepAliveTimer != null) {
    clearInterval(session.keepAliveTimer);
    session.keepAliveTimer = undefined;
  }
}

export function startUserClientKeepalive(cid: string): void {
  const session = connectionMap.get(cid);
  if (!session) return;
  stopUserClientKeepalive(session);
  session.keepAliveTimer = setInterval(() => {
    void (async () => {
      const s = connectionMap.get(cid);
      if (!s) return;
      if (s.dbKind === "postgres") {
        if (s.cursor) return;
        try {
          await s.userUsedClient.query(USER_CLIENT_KEEPALIVE_SQL);
        } catch (e) {
          if (isPgUserClientDeadError(e)) {
            await recreateUserUsedClient(cid).catch(() => {});
          }
        }
      } else if (s.dbKind === "sqlserver") {
        if (s.sqlServerRowStream) return;
        try {
          await s.userUsedClient.request().query("SELECT 1");
        } catch (e) {
          if (isSqlServerPoolDeadError(e)) {
            await recreateSqlServerPool(cid).catch(() => {});
          }
        }
      } else {
        try {
          await s.userUsedClient.query("SELECT 1");
        } catch (e) {
          if (isMysqlUserClientDeadError(e)) {
            await recreateMysqlUserUsedClient(cid).catch(() => {});
          }
        }
      }
    })();
  }, USER_CLIENT_KEEPALIVE_MS);
}

export function startMysqlUserClientKeepalive(cid: string): void {
  startUserClientKeepalive(cid);
}

/** 断开并释放连接资源 */
export async function disconnectConnection(connectionId: string): Promise<void> {
  const conn = connectionMap.get(connectionId);
  if (conn) {
    connectionMap.delete(connectionId);
    stopUserClientKeepalive(conn);
    if (conn.dbKind === "postgres") {
      await conn.userUsedClient.end().catch(() => {});
      await conn.backGroundPool.end().catch(() => {});
    } else if (conn.dbKind === "sqlserver") {
      if (conn.sqlServerRowStream) {
        await teardownSqlServerRowStream(conn.sqlServerRowStream);
        conn.sqlServerRowStream = undefined;
      }
      await conn.userUsedClient.close().catch(() => {});
    } else {
      if (isMysqlFamily(conn.dbKind)) {
        teardownMysqlStreaming(conn);
      }
      try {
        conn.userUsedClient.release();
      } catch {
        /* ignore */
      }
      await conn.backGroundPool.end().catch(() => {});
    }
    await conn.closeTunnel?.().catch(() => {});
  }
}
