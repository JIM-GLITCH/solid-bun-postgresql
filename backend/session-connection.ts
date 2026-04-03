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

export type SessionConnection = PostgresSessionConnection | MysqlSessionConnection;

export function isPostgresSession(s: SessionConnection): s is PostgresSessionConnection {
  return s.dbKind === "postgres";
}
