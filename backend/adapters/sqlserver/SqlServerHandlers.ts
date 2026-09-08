import { Effect } from "effect"
import { ConnectionId, SessionStore } from "../../services/SessionStore"
import { ConnectDbRequest, DbKind } from "../../../shared/src"
import { handleSqlServerConnect, handleSqlServerDisconnect, handleSqlServerCapabilities } from "./handlers/connection.handler";
import { handleSqlServerQuery, handleSqlServerQueryStream, handleSqlServerCancel } from "./handlers/query.handler";
import { handleSqlServerSchemas, handleSqlServerTables, handleSqlServerColumns } from "./handlers/schema.handler";
import { handleSqlServerSessionMonitor, handleSqlServerSessionControl } from "./handlers/session.handler";
import { handleSqlServerExplain, handleSqlServerExplainText, handleSqlServerPartitionInfo } from "./handlers/misc.handler";
import type { DatabaseService } from "../../api/routes/db";

export interface SqlServerHandlerContext {
  sendSSEMessage?: (connectionId: string, message: any) => void;
}

export class SqlServerService implements DatabaseService<SessionStore | ConnectionId> {
  constructor(private ctx: SqlServerHandlerContext = {}) {}

  connect(request: ConnectDbRequest) {
    return handleSqlServerConnect(request);
  }

  disconnect() {
    return handleSqlServerDisconnect();
  }

  getCapabilities(dbType: DbKind) {
    return handleSqlServerCapabilities(dbType);
  }

  getSchemas() {
    return handleSqlServerSchemas();
  }

  executeQuery(query: any) {
    return handleSqlServerQuery(query);
  }

  executeQueryStream(query: any, batchSize: number) {
    return handleSqlServerQueryStream(query, batchSize);
  }

  executeQueryStreamMore(batchSize: number) {
    return Effect.die("SQL Server does not support query stream more");
  }

  cancelQuery() {
    return handleSqlServerCancel();
  }

  getTables(schema: any) {
    return handleSqlServerTables(schema);
  }

  getColumns(schema: any, table: any) {
    return handleSqlServerColumns(schema, table);
  }

  getIndexes(schema: any, table: any) {
    return Effect.die("SQL Server does not support getIndexes");
  }

  getPrimaryKeys(schema: any, table: any) {
    return Effect.die("SQL Server does not support getPrimaryKeys");
  }

  getCheckConstraints(schema: any, table: any) {
    return Effect.die("SQL Server does not support getCheckConstraints");
  }

  getUniqueConstraints(schema: any, table: any) {
    return Effect.die("SQL Server does not support getUniqueConstraints");
  }

  getForeignKeys(schema: any, table: any) {
    return Effect.die("SQL Server does not support getForeignKeys");
  }

  executeDdl(sql: any) {
    return Effect.die("SQL Server does not support executeDdl");
  }

  getTableDdl(schema: any, table: any) {
    return Effect.die("SQL Server does not support getTableDdl");
  }

  getFunctionDdl(schema: any, functionName: any) {
    return Effect.die("SQL Server does not support getFunctionDdl");
  }

  getSchemaDump(schema: any) {
    return Effect.die("SQL Server does not support getSchemaDump");
  }

  getDatabaseDump() {
    return Effect.die("SQL Server does not support getDatabaseDump");
  }

  importRows(schema: any, table: any, columns: any, rows: any, conflictColumns: any, onConflict: any, onError: any) {
    return Effect.die("SQL Server does not support importRows");
  }

  saveChanges(sql: any) {
    return Effect.die("SQL Server does not support saveChanges");
  }

  sessionMonitor() {
    return handleSqlServerSessionMonitor(20);
  }

  sessionControl(action: any, targetPid: any) {
    return handleSqlServerSessionControl(targetPid, action);
  }

  getInstalledExtensions() {
    return Effect.die("SQL Server does not support getInstalledExtensions");
  }

  explain(query: any) {
    return handleSqlServerExplain(query);
  }

  explainText(query: any) {
    return handleSqlServerExplainText(query);
  }

  getPartitionInfo(schema: any, table: any) {
    return handleSqlServerPartitionInfo(schema, table);
  }

  getDataTypes() {
    return Effect.die("SQL Server does not support getDataTypes");
  }

  getTableComment(schema: any, table: any) {
    return Effect.die("SQL Server does not support getTableComment");
  }
}
