/** 共享类型定义 */

export interface PostgresLoginParams {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

export interface SSEMessage {
  type: "NOTICE" | "ERROR" | "INFO" | "WARNING" | "QUERY" | "NOTIFICATION";
  message: string;
  timestamp: number;
  detail?: string;
}

export interface ColumnEditableInfo {
  name: string;
  tableID: number;
  columnID: number;
  isEditable: boolean;
  tableName?: string;
  columnName?: string;
  uniqueKeyColumns?: string[];
  uniqueKeyFieldIndices?: number[];
  tableAlias?: string;
}
