import { Effect } from "effect"
import { SessionStore } from "../../services/SessionStore"
import { ConnectDbRequest, DbKind } from "../../../shared/src"
import { handleMysqlConnect, handleMysqlDisconnect, handleMysqlCapabilities } from "./handlers/connection.handler";
import { handleMysqlQuery, handleMysqlQueryStream, handleMysqlCancel } from "./handlers/query.handler";
import { handleMysqlSchemas, handleMysqlTables, handleMysqlColumns } from "./handlers/schema.handler";
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
    return Effect.die("MySQL does not support getIndexes");
  }

  getPrimaryKeys(schema: any, table: any) {
    return Effect.die("MySQL does not support getPrimaryKeys");
  }

  getCheckConstraints(schema: any, table: any) {
    return Effect.die("MySQL does not support getCheckConstraints");
  }

  getUniqueConstraints(schema: any, table: any) {
    return Effect.die("MySQL does not support getUniqueConstraints");
  }

  getForeignKeys(schema: any, table: any) {
    return Effect.die("MySQL does not support getForeignKeys");
  }

  executeDdl(sql: any) {
    return Effect.die("MySQL does not support executeDdl");
  }

  getTableDdl(schema: any, table: any) {
    return Effect.die("MySQL does not support getTableDdl");
  }

  getFunctionDdl(schema: any, functionName: any) {
    return Effect.die("MySQL does not support getFunctionDdl");
  }

  getSchemaDump(schema: any) {
    return Effect.die("MySQL does not support getSchemaDump");
  }

  getDatabaseDump() {
    return Effect.die("MySQL does not support getDatabaseDump");
  }

  importRows(schema: any, table: any, columns: any, rows: any, conflictColumns: any, onConflict: any, onError: any) {
    return Effect.die("MySQL does not support importRows");
  }

  saveChanges(sql: any) {
    return Effect.die("MySQL does not support saveChanges");
  }

  sessionMonitor() {
    return Effect.die("MySQL does not support sessionMonitor");
  }

  sessionControl(action: any, targetPid: any) {
    return Effect.die("MySQL does not support sessionControl");
  }

  getInstalledExtensions() {
    return Effect.die("MySQL does not support getInstalledExtensions");
  }

  explain(query: any) {
    return Effect.die("MySQL does not support explain");
  }

  explainText(query: any) {
    return Effect.die("MySQL does not support explainText");
  }

  getPartitionInfo(schema: any, table: any) {
    return Effect.die("MySQL does not support getPartitionInfo");
  }

  getDataTypes() {
    return Effect.die("MySQL does not support getDataTypes");
  }

  getTableComment(schema: any, table: any) {
    return Effect.die("MySQL does not support getTableComment");
  }
}
