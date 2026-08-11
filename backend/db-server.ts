/**
 * DbServer —— db/* 请求路由层（对齐 react-datatable `packages/backend/db-server.ts`）。
 *
 * 路由规则（继承自 solid-project 的教训）：
 * - `db/connect` 是特例：此时还没有 connectionId，用载荷的 dbType 选驱动；
 *   connectionId 优先使用客户端传入（保持 `${storedId}-${sessionId}` 规则），缺省才由服务端分配。
 * - 其余 `db/*` 一律以 connectionMap 记录的 dbKind 为准，不信载荷 dbType，
 *   防止客户端谎报类型导致句柄错配。
 * - 横切能力（连接登记、事件推送桥接、会话销毁清理）归 DbServer，不散落顶层。
 */

import type { MessageConnection, RequestType } from "vscode-jsonrpc";
import {
  CONNECTION_EVENT_NOTIFICATION,
  DB_CANCEL_QUERY,
  DB_CAPABILITIES,
  DB_CHECK_CONSTRAINTS,
  DB_COLUMNS,
  DB_CONNECT,
  DB_DATA_TYPES,
  DB_DATABASE_DUMP,
  DB_DISCONNECT,
  DB_EXECUTE_DDL,
  DB_EXPLAIN,
  DB_EXPLAIN_TEXT,
  DB_FOREIGN_KEYS,
  DB_FUNCTION_DDL,
  DB_IMPORT_ROWS,
  DB_INDEXES,
  DB_INSTALLED_EXTENSIONS,
  DB_PARTITION_INFO,
  DB_PRIMARY_KEYS,
  DB_QUERY,
  DB_QUERY_STREAM,
  DB_QUERY_STREAM_MORE,
  DB_SAVE_CHANGES,
  DB_SCHEMA_DUMP,
  DB_SCHEMAS,
  DB_SESSION_CONTROL,
  DB_SESSION_MONITOR,
  DB_TABLE_COMMENT,
  DB_TABLE_DDL,
  DB_TABLES,
  DB_UNIQUE_CONSTRAINTS,
  type DbKind,
  type DbRpcBase,
} from "../shared/src";
import type { RpcMultiSessionServer } from "./rpc/rpc-session";
import type { DbDriver, DriverContext } from "./driver";
import type { SessionConnection } from "./session-connection";

interface ConnectionRecord<TSession extends SessionConnection = SessionConnection> {
  driver: DbDriver<TSession>;
  session: TSession;
  dbKind: DbKind;
  ctx: DriverContext;
}

function invokeDriver<R>(rec: ConnectionRecord<any>, method: string, ...args: any[]): R {
  const fn = (rec.driver as any)[method];
  if (typeof fn !== "function") {
    throw new Error(`Driver "${rec.driver.kind}" does not implement "${method}"`);
  }
  return fn.call(rec.driver, rec.session, ...args);
}

export class DbServer {
  private drivers = new Map<DbKind, DbDriver<any>>();
  private connections = new Map<string, ConnectionRecord<any>>();

  constructor(rpc: RpcMultiSessionServer) {
    rpc.onRequest(DB_CONNECT, (p, c) => this.handleConnect(p, c));
    rpc.onRequest(DB_DISCONNECT, (p) => this.handleDisconnect(p));
    rpc.onRequest(DB_CAPABILITIES, (p) => {
      const rec = this.requireConnection((p as DbRpcBase).connectionId);
      return rec.driver.capabilities(rec.dbKind);
    });

    const routes: [RequestType<any, any, void>, string][] = [
      [DB_QUERY, "query"],
      [DB_QUERY_STREAM, "queryStream"],
      [DB_QUERY_STREAM_MORE, "queryStreamMore"],
      [DB_CANCEL_QUERY, "cancelQuery"],
      [DB_SAVE_CHANGES, "saveChanges"],
      [DB_IMPORT_ROWS, "importRows"],
      [DB_EXPLAIN, "explain"],
      [DB_EXPLAIN_TEXT, "explainText"],
      [DB_SCHEMAS, "getSchemas"],
      [DB_TABLES, "getTables"],
      [DB_COLUMNS, "getColumns"],
      [DB_INDEXES, "getIndexes"],
      [DB_PRIMARY_KEYS, "getPrimaryKeys"],
      [DB_UNIQUE_CONSTRAINTS, "getUniqueConstraints"],
      [DB_CHECK_CONSTRAINTS, "getCheckConstraints"],
      [DB_FOREIGN_KEYS, "getForeignKeys"],
      [DB_DATA_TYPES, "getDataTypes"],
      [DB_PARTITION_INFO, "getPartitionInfo"],
      [DB_EXECUTE_DDL, "executeDdl"],
      [DB_TABLE_DDL, "getTableDdl"],
      [DB_FUNCTION_DDL, "getFunctionDdl"],
      [DB_TABLE_COMMENT, "getTableComment"],
      [DB_SCHEMA_DUMP, "schemaDump"],
      [DB_DATABASE_DUMP, "databaseDump"],
      [DB_SESSION_MONITOR, "sessionMonitor"],
      [DB_SESSION_CONTROL, "sessionControl"],
      [DB_INSTALLED_EXTENSIONS, "installedExtensions"],
    ];

    for (const [type, method] of routes) {
      rpc.onRequest(type, async (params) => {
        const rec = this.requireConnection((params as DbRpcBase).connectionId);
        return invokeDriver(rec, method, params);
      });
    }

    // jsonrpc 会话销毁（标签页关闭 / SSE 超过重连 TTL）时释放其名下 DB 连接
    rpc.onSessionDispose((_sessionId, connection) => {
      for (const [cid, rec] of [...this.connections]) {
        if (rec.ctx.connection !== connection) continue;
        this.connections.delete(cid);
        rec.driver
          .disconnect(rec.session, { connectionId: cid, dbType: rec.dbKind })
          .catch(() => {});
      }
    });
  }

  registerDriver(driver: DbDriver<any>): void {
    for (const kind of driver.kinds) {
      this.drivers.set(kind, driver);
    }
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  private resolveDriver(dbKind: DbKind): DbDriver<any> {
    const driver = this.drivers.get(dbKind);
    if (!driver) {
      throw new Error(`No driver registered for dbType "${dbKind}"`);
    }
    return driver;
  }

  private requireConnection(connectionId: string): ConnectionRecord<any> {
    const rec = this.connections.get(connectionId);
    if (!rec) {
      throw new Error("未找到数据库连接，请先连接数据库");
    }
    return rec;
  }

  private makeContext(connection: MessageConnection, connectionId: string): DriverContext {
    return {
      connection,
      allocConnectionId: () => connectionId,
      push: (cid, event) =>
        connection.sendNotification(CONNECTION_EVENT_NOTIFICATION.method, {
          connectionId: cid,
          event,
        }),
    };
  }

  async handleConnect(
    params: { connectionId?: string; dbType: DbKind } & Record<string, any>,
    connection: MessageConnection,
  ): Promise<unknown> {
    const driver = this.resolveDriver(params.dbType);
    const connectionId = params.connectionId?.trim() || crypto.randomUUID();
    const ctx = this.makeContext(connection, connectionId);
    const { session, result } = await driver.connect(
      { ...params, connectionId } as never,
      ctx,
    );
    this.connections.set(connectionId, {
      driver,
      session,
      dbKind: session.dbKind,
      ctx,
    });
    return result ?? { success: true, connectionId, dbType: session.dbKind };
  }

  private async handleDisconnect(params: DbRpcBase): Promise<unknown> {
    const rec = this.requireConnection(params.connectionId);
    try {
      return await invokeDriver<Promise<unknown>>(rec, "disconnect", params);
    } finally {
      this.connections.delete(params.connectionId);
    }
  }
}
