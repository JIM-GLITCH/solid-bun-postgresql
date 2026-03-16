/** 共享类型定义 */

export interface PostgresLoginParams {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  /** SSH 隧道：启用后通过跳板机连接数据库 */
  sshEnabled?: boolean;
  sshHost?: string;
  sshPort?: string;
  sshUsername?: string;
  /** 密码认证 */
  sshPassword?: string;
  /** 私钥认证（PEM 格式），与 sshPassword 二选一 */
  sshPrivateKey?: string;
  /** SSH/数据库连接超时（秒），默认 30 */
  connectionTimeoutSec?: number;
}

/** 连接请求：包含 connectionId 和连接参数 */
export interface ConnectPostgresRequest extends PostgresLoginParams {
  /** 连接唯一 ID，前端生成，用于区分多个连接 */
  connectionId: string;
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
  /** PostgreSQL 类型 OID，用于格式化显示与 SQL 值（timestamp 精度等） */
  dataTypeOid?: number;
  tableName?: string;
  columnName?: string;
  uniqueKeyColumns?: string[];
  uniqueKeyFieldIndices?: number[];
  tableAlias?: string;
  /** 列是否允许 NULL（来自 pg_attribute.attnotnull） */
  nullable?: boolean;
}
