/**
 * 数据库连接契约（零驱动依赖）。
 *
 * 这是业务 handler 与连接层之间**唯一**的接口：handler 只依赖 `DbConnector`，
 * 不再读写 `SessionConnection` 上的任何连接句柄（userUsedClient / backGroundPool /
 * dbForReconnect / cursor / rowStream / runningQueryPid …）。
 *
 * 本文件不得 import `pg` / `mysql2` / `mssql` / `pg-cursor` / `ssh2`：
 * 方言私有的元数据类型一律用 `unknown` 挡住，只依赖 shared 的纯类型。
 */

import type { ColumnEditableInfo, DatabaseCapabilities, DbKind, SSEMessage } from "../../shared/src";

export type ConnectionId = string;

/** 方言无关的查询结果 */
export interface QueryResult<Row = any> {
  rows: Row[];
  rowCount?: number;
  /** 方言原始的字段元数据（给列可编辑性计算用），不做类型约束 */
  fields?: unknown;
  /** 语句类型标签（pg 的 command / mysql 的 info 等），仅用于展示 */
  command?: string;
  /** DML 结果头（mysql 的 ResultSetHeader：affectedRows / insertId 等） */
  header?: { affectedRows?: number; insertId?: number } | undefined;
  /** mssql 方言兼容别名：与 `rows` 同源，保留既有业务的 `r.recordset` 读法 */
  recordset?: unknown[];
}

export interface StreamPlan {
  /** 原始 SQL（连接层按方言规则拆分语句） */
  sql?: string;
  /** 已拆分语句；提供时连接层不再拆分 */
  statements?: string[];
  batchSize: number;
  defaultSchema?: string;
  /**
   * SQL Server 专用：首批的列可编辑性由业务侧基于原生流句柄装配。
   * 连接层把 `handle` 交给回调，避免把原生类型泄漏到契约。
   */
  streamColumnsFor?: (handle: unknown) => Promise<ColumnEditableInfo[]>;
}

export interface StreamBatch {
  /** 行数组的数组（各方言统一 array 模式） */
  rows: unknown[][];
  hasMore: boolean;
  columns?: ColumnEditableInfo[];
}

export interface SessionInfo {
  connectionId: ConnectionId;
  dbKind: DbKind;
  /** mysql 家族当前选中的库 */
  currentDatabase?: string;
}

/** 查询入参：纯 SQL，或 `{ text, values?, rowMode? }` 配置对象（后者用于 array 行模式） */
export interface QuerySpec {
  text: string;
  values?: readonly unknown[];
  rowMode?: "array";
  /** mysql 方言：把行以数组返回（与 rowMode: "array" 等价，mysql2 的原生选项名） */
  rowsAsArray?: boolean;
}

/**
 * 会话级连接能力。
 *
 * 两条查询通道**必须可并行**（见设计文档 §5.4/§5.5）：
 * - `query()`：元数据通道，走后台池，每请求 acquire/release
 * - `queryAsUser()`：会话专用通道（轨道 B），承担长查询 / 游标流式 / 取消登记
 *
 * ⚠️ 禁止用 `withPoolClient()` 实现 `query()`：`pool.query()` 内部已借一条连接，
 * 外层再借一条会在池上限 1~2 时自锁。
 */
export interface DbConnector {
  readonly connectionId: ConnectionId;
  readonly dbKind: DbKind;
  readonly capabilities: DatabaseCapabilities;

  /** 元数据通道：每请求 acquire/release */
  query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>>;

  /** 会话专用通道（轨道 B）：Monaco 长查询语义 */
  queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>>;

  /**
   * MySQL 方言：在**会话专用连接**上先 `USE <defaultSchema>` 再执行，并以数组行返回。
   * 之所以单列：`db/query` 需要「先切库再查」+ 数组行 + 字段元数据三者绑定在同一连接上。
   */
  queryWithDefaultSchema?<Row = any>(text: string, defaultSchema?: string): Promise<QueryResult<Row>>;

  /** 需要「同一连接上多语句」的场景（事务、dump、会话级 SET）。异常/取消路径也会归还 */
  withPoolClient<T>(fn: (client: BorrowedClient) => Promise<T>): Promise<T>;

  /** 流式首批（游标/行流由连接层持有，跨批次存活） */
  stream(plan: StreamPlan): Promise<StreamBatch>;
  /** 流式续批 */
  streamMore(opts: { batchSize: number; defaultSchema?: string }): Promise<StreamBatch>;
  /** 主动释放流式句柄（翻页超时 / 前端切走 / 断开前） */
  teardownStream(): Promise<void>;

  /** 会话销毁前释放连接器内部持有的状态（游标、登记的执行句柄等） */
  dispose(): Promise<void>;

  /** 取消当前执行中的语句（方言各自实现：pg_cancel_backend / KILL QUERY / request.cancel） */
  cancelCurrentQuery(): Promise<{ cancelled: boolean; message?: string }>;

  /** 会话自身的服务端连接标识（mysql threadId / pg backend pid / mssql spid），供「不允许结束自己」判断 */
  sessionThreadId(): number | undefined;

  /** 方言无关的会话摘要（供业务侧展示/日志；不含任何句柄） */
  sessionInfo(): SessionInfo;

  /** 会话当前选中的库（mysql 家族；用于列可编辑性等按库解析） */
  currentDatabase?(): string | undefined;

  /** SQL Server 专用：登记「可 cancel 的当前 Request」（由 db/query 写入） */
  setActiveRequest?(request: unknown): void;

  /** 方言各自的会话控制：cancel 当前语句 / terminate 连接 */
  sessionControl?(target: number, action: "cancel" | "terminate"): Promise<boolean>;

  /**
   * SQL Server 专用：暴露共享池给 `sqlserver-support` 的 helper 与事务编排。
   * 依旧以「方法」而非属性形式暴露，保持契约是能力而非句柄。
   */
  nativePool?(): unknown;

  /** 收集 AI 用的 schema 上下文（原 api-core 的三段实现移入连接层） */
  buildSchemaContext(schema?: string): Promise<{ context: string; injected: string[] }>;

  /** 订阅本连接的事件（NOTICE / ERROR / 流中断 …） */
  watch(): AsyncIterable<SSEMessage>;
}

/** 借出的连接：只暴露查询与连接标识，不暴露池对象 */
export interface BorrowedClient {
  query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>>;
  /** 原样执行（用于 `USE db` 等不能在参数化路径上走的语句）；默认与 query 同义 */
  exec?(sql: string): Promise<void>;
  /** mysql 方言：显式事务（pg 走 BEGIN/COMMIT 语句，不实现本方法） */
  beginTransaction?(): Promise<void>;
  commit?(): Promise<void>;
  rollback?(): Promise<void>;
  /** pg 的 processID / mysql 的 threadId；供取消时关联 */
  readonly nativeId?: number;
}

/** 业务层可安全读取的会话摘要（不含任何句柄） */
export function toSessionInfo(connector: DbConnector): SessionInfo {
  return { connectionId: connector.connectionId, dbKind: connector.dbKind };
}
