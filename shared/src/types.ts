/** 共享类型定义 */

/** 数据库方言（增库时在 union 中扩展） */
export type DbKind = "postgres" | "mysql" | "mariadb" | "sqlserver";

/** MySQL 与 MariaDB 共用 mysql2 协议与后端处理器 */
export function isMysqlFamily(kind: DbKind): kind is "mysql" | "mariadb" {
  return kind === "mysql" || kind === "mariadb";
}

/** Microsoft SQL Server（mssql / tedious） */
export function isSqlServer(kind: DbKind): boolean {
  return kind === "sqlserver";
}

/**
 * 当前数据库会话的能力开关（与后端 `db/capabilities`、前端 `getEffectiveDbCapabilities` 缓存对齐）。
 * 新增字段时须同步 `defaultDatabaseCapabilities` 与相关 UI 判断。
 */
export interface DatabaseCapabilities {
  /** 会话方言，与 `DbKind` 一致；用于在未命中服务端快照时选择默认能力矩阵 */
  dialect: DbKind;
  /** 是否使用流式结果集（`db/query-stream`）；为 false 时走只读单次查询且通常限制一次一条语句 */
  streamingQuery: boolean;
  /** 是否可调用 `db/cancel-query` 中止正在执行的查询；控制查询界面「中断」按钮等 */
  cancelQuery: boolean;
  /** 是否支持 JSON/结构化执行计划（如 PG `EXPLAIN (FORMAT JSON)`、MySQL `EXPLAIN FORMAT=JSON`） */
  explainAnalyzeJson: boolean;
  /** 是否支持文本形态 EXPLAIN；与 `explainAnalyzeJson` 共同决定是否显示「解释分析」入口 */
  explainText: boolean;
  /**
   * 是否开放会话级监控与 Kill：`db/session-monitor`、`db/session-control`。
   * PostgreSQL：pg_stat*、pg_stat_statements（可选）、锁等待、cancel_backend / terminate_backend。
   * MySQL：information_schema.PROCESSLIST、performance_schema 锁等待（若可用）、events_statements 摘要（可选）、KILL QUERY / KILL。
   */
  sessionMonitor: boolean;
  /**
   * PostgreSQL：是否开放已安装扩展的浏览与管理（`db/installed-extensions` 等侧栏入口）。
   * 与 `sessionMonitor` 解耦，便于日后仅接入其一的方言或权限策略。
   */
  pgExtensionCatalog: boolean;
  /** 是否启用图形化表设计器（新建/编辑表、生成 DDL）；为 false 时侧栏隐藏相关入口 */
  tableDesigner: boolean;
  /**
   * 查询结果网格是否允许就地编辑单元格、插入/删除行及批量保存（`db/save-changes`）。
   * 为 false 时隐藏待保存工具栏与相关右键菜单，且不接受单元格提交。
   */
  resultCellEdit: boolean;
  /**
   * 是否开放查询页「可视化构建」（Visual Query Builder：schema/表/列/外键拉取与生成 SQL）。
   * 为 false 时隐藏入口并关闭已打开的构建器浮层。
   */
  visualQueryBuilder: boolean;
  /**
   * 是否开放侧栏「生成假数据」等依赖 `db/import-rows` 的批量写入。
   * 为 false 时隐藏入口；方言未实现 `db/import-rows` 时应为 false。
   */
  fakeDataImport: boolean;
  /**
   * 是否开放侧栏表的「分区结构 / 裁剪预览」：依赖 `db/partition-info` 与文本 `db/explain`。
   * SQL Server 等尚未实现对应 RPC 时应为 false，避免打开弹窗即报错。
   */
  partitionStructureInspect: boolean;
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

/**
 * 建连请求：按 `dbType` 判别（与 `api-core` 中 `db/connect` 路由一致）。
 * 新增方言时在 {@link DbKind} 与此 union 中各增加一支，并实现 `*-db-handlers.ts`。
 */
export type ConnectDbRequest =
  | (PostgresLoginParams & { connectionId: string; dbType: "postgres" })
  | (PostgresLoginParams & { connectionId: string; dbType: "mysql" })
  | (PostgresLoginParams & { connectionId: string; dbType: "mariadb" })
  | (PostgresLoginParams & { connectionId: string; dbType: "sqlserver" });

/** 加密落盘的连接参数：在 PG 登录信息上增加方言，旧数据无 dbType 时视为 postgres */
export type StoredConnectionParams = PostgresLoginParams & { dbType?: DbKind };

/**
 * `connections/save` 载荷：登录参数 + 持久化项 id 与展示用 meta（与 `api-core` 一致）。
 */
export type ConnectionSavePayload = {
  id: string;
  name?: string;
  group?: string;
} & StoredConnectionParams;

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
  /** 表头展示用类型名（MySQL 等无 OID 时由后端填入；PostgreSQL 物理列可用 `format_type` 含数组维数） */
  dataTypeLabel?: string;
  tableName?: string;
  columnName?: string;
  uniqueKeyColumns?: string[];
  uniqueKeyFieldIndices?: number[];
  tableAlias?: string;
  /** 列是否允许 NULL（来自 pg_attribute.attnotnull） */
  nullable?: boolean;
  /** UPDATE/INSERT 字面量方言；MySQL 结果集由后端设置 */
  sqlDialect?: "postgres" | "mysql" | "sqlserver";
  /** 生成 INSERT 时省略（如 SQL Server identity / computed） */
  omitFromInsert?: boolean;
}
