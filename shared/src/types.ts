/** 共享类型定义 */

export interface PostgresLoginParams {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
}

/** 连接请求：支持明文 password（兼容）或加密的 passwordEncrypted */
export type ConnectPostgresRequest = Omit<PostgresLoginParams, "password"> & {
  password?: string;
  passwordEncrypted?: string;
};

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
