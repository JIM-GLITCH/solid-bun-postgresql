/**
 * DB Handler Effect Context Services
 * 定义所有用于依赖注入的 Context Tags
 */

import { Context, Effect } from "effect";
import type { DbKind, DatabaseCapabilities, SSEMessage } from "../../shared/src";
import type { SessionConnection } from "../session-connection";
import type { DbConnector } from "../db/contract";

// ========== 基础 Context Services ==========

export class ConnectorFor extends Context.Service<ConnectorFor, (cid: string) => DbConnector>()("ConnectorFor") {}
export class GetSession extends Context.Service<GetSession, (cid: string) => SessionConnection>()("GetSession") {}
export class SendSSEMessage extends Context.Service<SendSSEMessage, (cid: string, msg: SSEMessage) => void>()("SendSSEMessage") {}
export class DisconnectConnection extends Context.Service<DisconnectConnection, (cid: string) => Promise<void>>()("DisconnectConnection") {}
export class AssertSessionDbType extends Context.Service<AssertSessionDbType, (session: SessionConnection, dbType: DbKind | undefined) => void>()("AssertSessionDbType") {}
export class CapabilitiesForKind extends Context.Service<CapabilitiesForKind, (kind: DbKind) => DatabaseCapabilities>()("CapabilitiesForKind") {}

// ========== 请求级上下文（由 tRPC 边界每次调用提供） ==========

/** 当前请求的连接 id（router 从校验后的 input 提供；配合 currentConnection 解析会话/连接器/策略） */
export class CurrentConnectionId extends Context.Service<CurrentConnectionId, string>()("CurrentConnectionId") {}

/**
 * 客户端声明的方言。
 * ⚠️ 仅用于与服务端会话真源（session.dbKind）做一致性校验，**不用于选择策略**——
 * 按客户端声明选策略会因误声明而打错方言 SQL。
 */
export class CurrentDbType extends Context.Service<CurrentDbType, DbKind>()("CurrentDbType") {}

// ========== 策略接口 ==========

export interface Strategy {
  readonly dbType: 'postgres' | 'mysql' | 'mariadb' | 'sqlserver';
  
  // SQL构建
  readonly quoteIdentifier: (id: string) => string;
  readonly buildPlaceholder: (index: number) => string;
  
  // 元数据查询SQL
  readonly metadataQueries: {
    readonly schemas: string;
    readonly tables: string;
    readonly columns: string;
    readonly indexes: string;
    readonly primaryKeys: string;
    readonly foreignKeys: string;
    readonly uniqueConstraints: string;
    readonly checkConstraints: string;
    readonly dataTypes: string;
    readonly tableComment: string;
  };
  
  // 特殊处理函数
  /** values 为「一行一组」的二维数组；返回的 values 为驱动所需的扁平数组 */
  readonly buildInsertSQL: (params: InsertParams) => { sql: string; values: unknown[] };
  readonly parseExplainResult: (result: QueryResult) => Effect.Effect<ExplainPlan, Error>;
  
  // 数据库特有handler
  readonly specialHandlers?: Record<string, (payload: unknown) => Effect.Effect<unknown, Error>>;
  
  // 监控和诊断
  readonly sessionMonitor?: (connector: DbConnector, limit: number) => Effect.Effect<MonitorResult, Error>;
  readonly sessionControl?: (connector: DbConnector, pid: number, action: string) => Effect.Effect<boolean, Error>;
  /** 方言各自的 EXPLAIN 文本计划（返回可直接展示的行数组；不支持则缺省） */
  readonly explainText?: (connector: DbConnector, query: string) => Effect.Effect<string[], Error>;
}

// ========== 类型定义 ==========

export interface InsertParams {
  table: string;
  columns: string[];
  /** 二维数组：每个元素是一行（长度应与 columns 一致，多余/不足的列将被忽略/置 NULL 由调用方保证） */
  values: readonly unknown[][];
}

/**
 * 按方言引号函数引用限定表名：`schema.table` → `"schema"."table"`。
 * 不能对整个限定名加一层引号——`"public.users"` 在 PostgreSQL 中是名为 `public.users` 的单一标识符。
 * 与前端 `qualifiedTableForDdl`（frontend/sql-ddl-quote.ts）行为一致。
 */
export function quoteQualifiedTable(qualified: string, quote: (id: string) => string): string {
  return qualified
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => quote(part))
    .join(".");
}

export interface QueryResult {
  rows: any[];
  rowCount?: number;
}

export interface ExplainPlan {
  plan: any;
}

export interface MonitorResult {
  connectionStats: { total: number; active: number; idle: number; waiting: number };
  lockWaits: Array<{
    waiting_pid: number;
    waiting_user: string;
    waiting_query: string;
    blocking_pid: number;
    blocking_user: string;
    blocking_query: string;
    wait_event_type?: string | null;
    wait_event?: string | null;
  }>;
  slowQueries: Array<Record<string, unknown>>;
  slowQuerySource: string;
  collectedAt: number;
}

// ========== Handler Context 类型（运行时依赖）==========

export interface HandlerContext {
  connectorFor: (cid: string) => DbConnector;
  getS: (cid: string) => SessionConnection;
  getSWithDb: (cid: string) => SessionConnection;
  sendSSEMessage: (cid: string, msg: SSEMessage) => void;
  disconnectConnection: (cid: string) => Promise<void>;
  assertSessionDbType: (session: SessionConnection, dbType: DbKind | undefined) => void;
  capabilitiesForKind: (kind: DbKind) => DatabaseCapabilities;
}
