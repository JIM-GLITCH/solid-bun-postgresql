import { Effect } from "effect"
import { ConnectionId, SessionStore } from "../../services/SessionStore"
import { ConnectDbRequest, DbKind } from "../../../shared/src"
import { handleMysqlConnect, handleMysqlDisconnect, handleMysqlCapabilities } from "./handlers/connection.handler";
import { handleMysqlQuery, handleMysqlQueryStream, handleMysqlCancel } from "./handlers/query.handler";
import { handleMysqlSchemas, handleMysqlTables, handleMysqlColumns } from "./handlers/schema.handler";
import { handleMysqlIndexes, handleMysqlPrimaryKeys, handleMysqlUniqueConstraints, handleMysqlCheckConstraints, handleMysqlForeignKeys } from "./handlers/metadata.handler";
import { handleMysqlExecuteDdl, handleMysqlTableDdl, handleMysqlFunctionDdl, handleMysqlSchemaDump, handleMysqlDatabaseDump } from "./handlers/ddl.handler";
import { handleMysqlImportRows, handleMysqlSaveChanges } from "./handlers/import.handler";
import { handleMysqlSessionMonitor, handleMysqlSessionControl, handleMysqlInstalledExtensions } from "./handlers/session.handler";
import { handleMysqlExplain, handleMysqlExplainText, handleMysqlPartitionInfo, handleMysqlDataTypes, handleMysqlTableComment } from "./handlers/misc.handler";
import type { DatabaseService } from "../../api/routes/db";

export interface MysqlHandlerContext {
  sendSSEMessage?: (connectionId: string, message: any) => void;
}

export class MysqlService implements DatabaseService {
  constructor(private ctx: MysqlHandlerContext = {}) {}

  connect(request: ConnectDbRequest) {
    return handleMysqlConnect(request);
  }

  disconnect() {
    return handleMysqlDisconnect();
  }

  getCapabilities(dbType: DbKind) {
    return handleMysqlCapabilities(dbType);
  }

  getSchemas() {
    return handleMysqlSchemas();
  }

  executeQuery(query: any) {
    return handleMysqlQuery(query);
  }

  executeQueryStream(query: any, batchSize: number) {
    return handleMysqlQueryStream(query, batchSize);
  }

  executeQueryStreamMore(batchSize: number) {
    return Effect.die("MySQL does not support query stream more");
  }

  cancelQuery() {
    return handleMysqlCancel();
  }

  getTables(schema: any) {
    return handleMysqlTables(schema);
  }

  getColumns(schema: any, table: any) {
    return handleMysqlColumns(schema, table);
  }

  getIndexes(schema: any, table: any) {
    return handleMysqlIndexes(schema, table);
  }

  getPrimaryKeys(schema: any, table: any) {
    return handleMysqlPrimaryKeys(schema, table);
  }

  getCheckConstraints(schema: any, table: any) {
    return handleMysqlCheckConstraints(schema, table);
  }

  getUniqueConstraints(schema: any, table: any) {
    return handleMysqlUniqueConstraints(schema, table);
  }

  getForeignKeys(schema: any, table: any) {
    return handleMysqlForeignKeys(schema, table);
  }

  executeDdl(sql: any) {
    return handleMysqlExecuteDdl(sql);
  }

  getTableDdl(schema: any, table: any) {
    return handleMysqlTableDdl(schema, table);
  }

  getFunctionDdl(schema: any, functionName: any) {
    return handleMysqlFunctionDdl(schema, functionName);
  }

  getSchemaDump(schema: any) {
    return handleMysqlSchemaDump(schema);
  }

  getDatabaseDump() {
    return handleMysqlDatabaseDump();
  }

  importRows(schema: any, table: any, columns: any, rows: any, conflictColumns: any, onConflict: any, onError: any) {
    return handleMysqlImportRows(schema, table, columns, rows, conflictColumns, onConflict, onError);
  }

  saveChanges(sql: any) {
    return handleMysqlSaveChanges(sql);
  }

  sessionMonitor() {
    return handleMysqlSessionMonitor();
  }

  sessionControl(action: any, targetPid: any) {
    return handleMysqlSessionControl(action, targetPid);
  }

  getInstalledExtensions() {
    return handleMysqlInstalledExtensions();
  }

  explain(query: any) {
    return handleMysqlExplain(query);
  }

  explainText(query: any) {
    return handleMysqlExplainText(query);
  }

  getPartitionInfo(schema: any, table: any) {
    return handleMysqlPartitionInfo(schema, table);
  }

  getDataTypes() {
    return handleMysqlDataTypes();
  }

  getTableComment(schema: any, table: any) {
    return handleMysqlTableComment(schema, table);
  }
}
