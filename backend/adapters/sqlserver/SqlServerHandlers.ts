import { Effect } from "effect"
import { ConnectionId, SessionStore } from "../../services/SessionStore"
import { ConnectDbRequest, DbKind } from "../../../shared/src"
import { handleSqlServerConnect, handleSqlServerDisconnect, handleSqlServerCapabilities } from "./handlers/connection.handler";
import { handleSqlServerQuery, handleSqlServerQueryStream, handleSqlServerCancel } from "./handlers/query.handler";
import { handleSqlServerSchemas, handleSqlServerTables, handleSqlServerColumns } from "./handlers/schema.handler";
import { handleSqlServerSessionMonitor, handleSqlServerSessionControl } from "./handlers/session.handler";
import { handleSqlServerExplain, handleSqlServerExplainText, handleSqlServerPartitionInfo, handleSqlServerDataTypes, handleSqlServerTableComment } from "./handlers/misc.handler";
import { handleSqlServerIndexes, handleSqlServerPrimaryKeys, handleSqlServerUniqueConstraints, handleSqlServerCheckConstraints, handleSqlServerForeignKeys } from "./handlers/metadata.handler";
import { handleSqlServerExecuteDdl, handleSqlServerTableDdl, handleSqlServerFunctionDdl, handleSqlServerSchemaDump, handleSqlServerDatabaseDump } from "./handlers/ddl.handler";
import { handleSqlServerImportRows, handleSqlServerSaveChanges } from "./handlers/import.handler";
import type { DatabaseService } from "../../api/routes/db";

export interface SqlServerHandlerContext {
  sendSSEMessage?: (connectionId: string, message: any) => void;
}

export class SqlServerService implements DatabaseService {
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
    return handleSqlServerIndexes(schema, table);
  }

  getPrimaryKeys(schema: any, table: any) {
    return handleSqlServerPrimaryKeys(schema, table);
  }

  getCheckConstraints(schema: any, table: any) {
    return handleSqlServerCheckConstraints(schema, table);
  }

  getUniqueConstraints(schema: any, table: any) {
    return handleSqlServerUniqueConstraints(schema, table);
  }

  getForeignKeys(schema: any, table: any) {
    return handleSqlServerForeignKeys(schema, table);
  }

  executeDdl(sql: any) {
    return handleSqlServerExecuteDdl(sql);
  }

  getTableDdl(schema: any, table: any) {
    return handleSqlServerTableDdl(schema, table);
  }

  getFunctionDdl(schema: any, functionName: any) {
    return handleSqlServerFunctionDdl(schema, functionName);
  }

  getSchemaDump(schema: any) {
    return handleSqlServerSchemaDump(schema);
  }

  getDatabaseDump() {
    return handleSqlServerDatabaseDump();
  }

  importRows(schema: any, table: any, columns: any, rows: any, conflictColumns: any, onConflict: any, onError: any) {
    return handleSqlServerImportRows(schema, table, columns, rows, conflictColumns, onConflict, onError);
  }

  saveChanges(sql: any) {
    return handleSqlServerSaveChanges(sql);
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
    return handleSqlServerDataTypes();
  }

  getTableComment(schema: any, table: any) {
    return handleSqlServerTableComment(schema, table);
  }
}
