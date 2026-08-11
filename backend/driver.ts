/**
 * 数据库驱动接口（对齐 react-datatable `packages/backend/driver.ts`）。
 *
 * 业务侧（DbServer）只认 `DbDriver`，不关心具体数据库；新增数据源只需
 * 实现该接口并 `registerDriver`，分发逻辑零改动。
 */

import type { MessageConnection } from "vscode-jsonrpc";
import type {
  ApiRequestPayload,
  DatabaseCapabilities,
  DbKind,
  SSEMessage,
} from "../shared/src";
import type { SessionConnection } from "./session-connection";

export interface DriverContext {
  /** 该驱动所服务的 jsonrpc 会话连接（推送事件用） */
  connection: MessageConnection;
  allocConnectionId(): string;
  push(connectionId: string, event: SSEMessage): void;
}

export type DbConnectOutcome<TSession> = {
  session: TSession;
  /** 旧 handler 的 db/connect 返回值（{ success, connectionId, dbType }），原样回传前端 */
  result: unknown;
};

export interface DbDriver<TSession extends SessionConnection = SessionConnection> {
  /** 驱动主方言（注册标识） */
  readonly kind: DbKind;
  /** 驱动实际服务的方言集合（MySQL 驱动同时覆盖 mysql 与 mariadb） */
  readonly kinds: readonly DbKind[];

  connect(params: ApiRequestPayload["db/connect"], ctx: DriverContext): Promise<DbConnectOutcome<TSession>>;
  disconnect(session: TSession, params: ApiRequestPayload["db/disconnect"]): Promise<unknown>;
  capabilities(kind: DbKind): DatabaseCapabilities;

  query?(session: TSession, params: ApiRequestPayload["db/query"]): Promise<unknown>;
  queryStream?(session: TSession, params: ApiRequestPayload["db/query-stream"]): Promise<unknown>;
  queryStreamMore?(session: TSession, params: ApiRequestPayload["db/query-stream-more"]): Promise<unknown>;
  cancelQuery?(session: TSession, params: ApiRequestPayload["db/cancel-query"]): Promise<unknown>;

  saveChanges?(session: TSession, params: ApiRequestPayload["db/save-changes"]): Promise<unknown>;
  importRows?(session: TSession, params: ApiRequestPayload["db/import-rows"]): Promise<unknown>;

  explain?(session: TSession, params: ApiRequestPayload["db/explain"]): Promise<unknown>;
  explainText?(session: TSession, params: ApiRequestPayload["db/explain-text"]): Promise<unknown>;

  getSchemas?(session: TSession, params: ApiRequestPayload["db/schemas"]): Promise<unknown>;
  getTables?(session: TSession, params: ApiRequestPayload["db/tables"]): Promise<unknown>;
  getColumns?(session: TSession, params: ApiRequestPayload["db/columns"]): Promise<unknown>;
  getIndexes?(session: TSession, params: ApiRequestPayload["db/indexes"]): Promise<unknown>;
  getPrimaryKeys?(session: TSession, params: ApiRequestPayload["db/primary-keys"]): Promise<unknown>;
  getUniqueConstraints?(session: TSession, params: ApiRequestPayload["db/unique-constraints"]): Promise<unknown>;
  getCheckConstraints?(session: TSession, params: ApiRequestPayload["db/check-constraints"]): Promise<unknown>;
  getForeignKeys?(session: TSession, params: ApiRequestPayload["db/foreign-keys"]): Promise<unknown>;
  getDataTypes?(session: TSession, params: ApiRequestPayload["db/data-types"]): Promise<unknown>;
  getPartitionInfo?(session: TSession, params: ApiRequestPayload["db/partition-info"]): Promise<unknown>;

  executeDdl?(session: TSession, params: ApiRequestPayload["db/execute-ddl"]): Promise<unknown>;
  getTableDdl?(session: TSession, params: ApiRequestPayload["db/table-ddl"]): Promise<unknown>;
  getFunctionDdl?(session: TSession, params: ApiRequestPayload["db/function-ddl"]): Promise<unknown>;
  getTableComment?(session: TSession, params: ApiRequestPayload["db/table-comment"]): Promise<unknown>;
  schemaDump?(session: TSession, params: ApiRequestPayload["db/schema-dump"]): Promise<unknown>;
  databaseDump?(session: TSession, params: ApiRequestPayload["db/database-dump"]): Promise<unknown>;

  sessionMonitor?(session: TSession, params: ApiRequestPayload["db/session-monitor"]): Promise<unknown>;
  sessionControl?(session: TSession, params: ApiRequestPayload["db/session-control"]): Promise<unknown>;
  installedExtensions?(session: TSession, params: ApiRequestPayload["db/installed-extensions"]): Promise<unknown>;
}
