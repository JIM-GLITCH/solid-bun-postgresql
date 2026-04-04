/**
 * 数据库会话类型（与传输层无关），供 api-core 与各 db handlers 共用。
 */

import type { Client, Pool } from "pg";
import type Cursor from "pg-cursor";
import type { Readable } from "node:stream";
import type { Pool as MysqlPool, PoolConnection } from "mysql2/promise";
import type { DbKind, SSEMessage } from "../shared/src";
import type { GetDbConfigResult } from "./connect-postgres";
import type { GetMysqlDbConfigResult } from "./connect-mysql";
import type { ConnectionPool as MssqlConnectionPool, Request as MssqlRequest } from "mssql";
import type { GetSqlServerDbConfigResult } from "./connect-sqlserver";
import type { SqlServerStreamingQueryHandle } from "./sqlserver-mssql-stream";

export interface PostgresSessionConnection {
  dbKind: "postgres";
  userUsedClient: Client;
  backGroundPool: Pool;
  dbForReconnect: GetDbConfigResult;
  runningQueryPid?: number;
  eventPushers: Set<(msg: SSEMessage) => void>;
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
  eventPushers: Set<(msg: SSEMessage) => void>;
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
  eventPushers: Set<(msg: SSEMessage) => void>;
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
