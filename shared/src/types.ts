/** 共享类型定义 */

/** 数据库方言（增库时在 union 中扩展） */
export type DbKind = "postgres" | "mysql";

/** 会话能力（仅描述，具体以后端实现为准） */
export interface DatabaseCapabilities {
  dialect: DbKind;
  adhocSql: boolean;
  streamingQuery: boolean;
  cancelQuery: boolean;
  explainAnalyzeJson: boolean;
  explainText: boolean;
  metadataBrowser: boolean;
  postgresAdmin: boolean;
}

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

/** 统一连接请求：必须带 dbType（由路由根据类型做分支） */
export interface ConnectDbRequest extends ConnectPostgresRequest {
  dbType: DbKind;
}

/** 加密落盘的连接参数：在 PG 登录信息上增加方言，旧数据无 dbType 时视为 postgres */
export type StoredConnectionParams = PostgresLoginParams & { dbType?: DbKind };

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
  /** 表头展示用类型名（MySQL 等无 OID 时由后端填入） */
  dataTypeLabel?: string;
  tableName?: string;
  columnName?: string;
  uniqueKeyColumns?: string[];
  uniqueKeyFieldIndices?: number[];
  tableAlias?: string;
  /** 列是否允许 NULL（来自 pg_attribute.attnotnull） */
  nullable?: boolean;
  /** UPDATE/INSERT 字面量方言；MySQL 结果集由后端设置 */
  sqlDialect?: "postgres" | "mysql";
}
