import { Effect } from "effect"
import { ConnectionId, SessionStore } from "../../services/SessionStore"
import { ConnectDbRequest, DbKind } from "../../../shared/src"
import { handlePostgresConnect, handlePostgresDisconnect, handlePostgresCapabilities } from "./handlers/connection.handler";
import { handlePostgresQuery, handlePostgresQueryStream, handlePostgresQueryStreamMore, handlePostgresCancel } from "./handlers/query.handler";
import { handlePostgresSchemas, handlePostgresTables, handlePostgresColumns } from "./handlers/schema.handler";
import { handlePostgresIndexes, handlePostgresPrimaryKeys, handlePostgresUniqueConstraints, handlePostgresCheckConstraints, handlePostgresForeignKeys } from "./handlers/metadata.handler";
import { handlePostgresExecuteDdl, handlePostgresTableDdl, handlePostgresFunctionDdl, handlePostgresSchemaDump, handlePostgresDatabaseDump } from "./handlers/ddl.handler";
import { handlePostgresImportRows, handlePostgresSaveChanges } from "./handlers/import.handler";
import { handlePostgresSessionMonitor, handlePostgresSessionControl, handlePostgresInstalledExtensions } from "./handlers/session.handler";
import { handlePostgresExplain, handlePostgresExplainText, handlePostgresPartitionInfo, handlePostgresDataTypes, handlePostgresTableComment } from "./handlers/misc.handler";
import type { DatabaseService } from "../../api/routes/db";

export interface PostgresHandlerContext {
  sendSSEMessage?: (connectionId: string, message: any) => void;
}

export class PostgresService implements DatabaseService<SessionStore | ConnectionId> {
  constructor(private ctx: PostgresHandlerContext = {}) {}

  connect(request: ConnectDbRequest) {
    return handlePostgresConnect(request);
  }

  disconnect() {
    return handlePostgresDisconnect();
  }

  getCapabilities(dbType: DbKind) {
    return handlePostgresCapabilities(dbType);
  }

  getSchemas() {
    return handlePostgresSchemas();
  }

  executeQuery(query: any) {
    return handlePostgresQuery(query);
  }

  executeQueryStream(query: any, batchSize: number) {
    return handlePostgresQueryStream(query, batchSize);
  }

  executeQueryStreamMore(batchSize: number) {
    return handlePostgresQueryStreamMore(batchSize);
  }

  cancelQuery() {
    return handlePostgresCancel();
  }

  getTables(schema: any) {
    return handlePostgresTables(schema);
  }

  getColumns(schema: any, table: any) {
    return handlePostgresColumns(schema, table);
  }

  getIndexes(schema: any, table: any) {
    return handlePostgresIndexes(schema, table);
  }

  getPrimaryKeys(schema: any, table: any) {
    return handlePostgresPrimaryKeys(schema, table);
  }

  getCheckConstraints(schema: any, table: any) {
    return handlePostgresCheckConstraints(schema, table);
  }

  getUniqueConstraints(schema: any, table: any) {
    return handlePostgresUniqueConstraints(schema, table);
  }

  getForeignKeys(schema: any, table: any) {
    return handlePostgresForeignKeys(schema, table);
  }

  executeDdl(sql: any) {
    return handlePostgresExecuteDdl(sql);
  }

  getTableDdl(schema: any, table: any) {
    return handlePostgresTableDdl(schema, table);
  }

  getFunctionDdl(schema: any, functionName: any) {
    return handlePostgresFunctionDdl(schema, functionName);
  }

  getSchemaDump(schema: any) {
    return handlePostgresSchemaDump(schema);
  }

  getDatabaseDump() {
    return handlePostgresDatabaseDump();
  }

  importRows(schema: any, table: any, columns: any, rows: any, conflictColumns: any, onConflict: any, onError: any) {
    return handlePostgresImportRows(schema, table, columns, rows, conflictColumns, onConflict, onError);
  }

  saveChanges(sql: any) {
    return handlePostgresSaveChanges(sql);
  }

  sessionMonitor() {
    return handlePostgresSessionMonitor();
  }

  sessionControl(action: any, targetPid: any) {
    return handlePostgresSessionControl(action, targetPid);
  }

  getInstalledExtensions() {
    return handlePostgresInstalledExtensions();
  }

  explain(query: any) {
    return handlePostgresExplain(query);
  }

  explainText(query: any) {
    return handlePostgresExplainText(query);
  }

  getPartitionInfo(schema: any, table: any) {
    return handlePostgresPartitionInfo(schema, table);
  }

  getDataTypes() {
    return handlePostgresDataTypes();
  }

  getTableComment(schema: any, table: any) {
    return handlePostgresTableComment(schema, table, undefined);
  }
}
