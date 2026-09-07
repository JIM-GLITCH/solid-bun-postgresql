import { Context, Effect, Scope } from "effect"
import { DbKind, DatabaseCapabilities } from "../../../shared/src"

export interface ConnectParams {
  connectionId: string;
  dbType: DbKind;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sshEnabled?: boolean;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sshPrivateKey?: string;
  ssl?: boolean;
  connectionTimeoutSec?: number;
}

export interface QueryResult<A = unknown> {
  rows: A[];
  columns: string[];
  rowCount: number;
}

export interface StreamResult {
  rows: unknown[];
  columns: string[];
  hasMore: boolean;
}

export interface ConnectResult {
  success: true;
  connectionId: string;
  dbType: DbKind;
}

export interface DisconnectResult {
  success: true;
}

export interface CapabilitiesResult {
  capabilities: DatabaseCapabilities;
}

export interface SchemasResult {
  schemas: string[];
}

export interface TablesResult {
  tables: string[];
}

export interface ColumnsResult {
  columns: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    defaultValue?: string;
    comment?: string;
  }>;
}

export interface IndexesResult {
  indexes: Array<{
    name: string;
    columns: string[];
    unique: boolean;
  }>;
}

export interface PrimaryKeysResult {
  primaryKeys: Array<{
    columnName: string;
  }>;
}

export interface ForeignKeysResult {
  foreignKeys: Array<{
    columnName: string;
    referencedSchema: string;
    referencedTable: string;
    referencedColumn: string;
  }>;
}

export interface UniqueConstraintsResult {
  uniqueConstraints: Array<{
    name: string;
    columns: string[];
  }>;
}

export interface CheckConstraintsResult {
  checkConstraints: Array<{
    name: string;
    definition: string;
  }>;
}

export interface DataTypesResult {
  dataTypes: Array<{
    name: string;
    description: string;
  }>;
}

export interface TableDdlResult {
  ddl: string;
}

export interface FunctionDdlResult {
  ddl: string;
}

export interface SchemaDumpResult {
  dump: string;
}

export interface DatabaseDumpResult {
  dump: string;
}

export interface ExplainResult {
  plan: unknown;
}

export interface ExplainTextResult {
  plan: string;
}

export interface PartitionInfoResult {
  partitions: Array<{
    name: string;
    definition: string;
    rowCount?: number;
  }>;
}

export interface SessionMonitorResult {
  sessions: Array<{
    pid: number;
    state: string;
    query?: string;
    duration?: number;
  }>;
}

export interface SessionControlResult {
  success: true;
}

export interface InstalledExtensionsResult {
  extensions: Array<{
    name: string;
    version: string;
  }>;
}

export interface ImportRowsResult {
  success: true;
  rowCount: number;
}

export interface SaveChangesResult {
  success: true;
  rowCount: number;
}

export interface ExecuteDdlResult {
  success: true;
}

export interface TableCommentResult {
  success: true;
}

export interface DbHandler {
  handleRequest: (method: string, payload: unknown) => Effect.Effect<unknown, Error, Scope.Scope>;
}

export const DbHandlerTag = Context.Service<DbHandler>("DbHandler");
