/**
 * RPC 后端组装入口：transport + RpcMultiSessionServer + DbServer（3 驱动）+ AppServer。
 * 返回 Hono app 供各宿主（standalone / electrobun / vscode）挂载。
 * 参照 react-datatable apps/web/server/main.ts 的接线方式。
 */

// RIL 兜底：Node/Bun 下必须导入，否则 vscode-jsonrpc 消息队列静默失效
import "vscode-jsonrpc/node";

import type { Hono } from "hono";
import { AppServer, type AppServerOptions } from "./app-server";
import { DbServer } from "./db-server";
import { MysqlDriver } from "./drivers/mysql-driver";
import { PostgresDriver } from "./drivers/postgres-driver";
import { SqlServerDriver } from "./drivers/sqlserver-driver";
import { RpcMultiSessionServer } from "./rpc/rpc-session";
import type { TransportServer } from "./rpc/rpc-session/transport";
import {
  createHttpServerTransport,
  type HttpServerTransportOptions,
} from "./transport/http-server-transport";

export interface RpcBackend {
  server: RpcMultiSessionServer;
  dbServer: DbServer;
  appServer: AppServer;
  /** 含 /rpc/* 路由的 Hono app，宿主直接 route 挂载 */
  app: Hono;
}

/**
 * 在任意 TransportServer 上组装 RpcMultiSessionServer + DbServer（3 驱动）+ AppServer。
 * HTTP 宿主用 createRpcBackend；postMessage / electrobun 宿主自建传输层后调用本函数。
 */
export function buildRpcStack(transport: TransportServer, appOpts?: AppServerOptions) {
  const server = new RpcMultiSessionServer(transport);
  const dbServer = new DbServer(server);

  dbServer.registerDriver(new PostgresDriver());
  dbServer.registerDriver(new MysqlDriver());
  dbServer.registerDriver(new SqlServerDriver());

  const appServer = new AppServer(server, dbServer, appOpts);

  return { server, dbServer, appServer };
}

export function createRpcBackend(opts: HttpServerTransportOptions = {}): RpcBackend {
  const transport = createHttpServerTransport(opts);
  const { server, dbServer, appServer } = buildRpcStack(transport);
  return { server, dbServer, appServer, app: transport.getApp() as Hono };
}
