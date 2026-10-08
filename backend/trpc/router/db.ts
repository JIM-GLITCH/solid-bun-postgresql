/**
 * DB Router
 * 处理数据库连接、查询、DDL 等全部 db/* 操作。
 *
 * 业务实现复用 `backend/api-core` 的 `handleApiRequest`（单一真源）；
 * 这里只负责输入校验 / query-mutation 语义 / 返回类型标注 / 订阅实现（替代旧的 SSE `/api/events`）。
 *
 * 返回类型是「唯一真源」：`handleApiRequest` 返回 `unknown`，在此集中标注，
 * 前端即可直接 `trpc.db.xxx.query(...)` 获得类型推断，无需再包一层封装。
 */

import { t } from '../init';
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { handleApiRequest, getSession, subscribeSessionEvents } from '../../api-core';
import type {
  ConnectDbRequest,
  ColumnEditableInfo,
  DatabaseCapabilities,
  DbKind,
  SSEMessage,
} from '../../../shared/src';

const dbKindSchema = z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']);

/** 需已有会话的 db 请求公共字段 */
const dbBase = {
  connectionId: z.string(),
  dbType: dbKindSchema,
};

/** 便捷：schema + table 组合 */
const schemaTable = { ...dbBase, schema: z.string(), table: z.string() };

// ── 各 db/* 方法的返回类型（与 api-core 实现一致）────────────────────────
/** 分区表元数据（非分区表为 role:none） */
export type PartitionInfo =
  | { role: 'none' }
  | {
      role: 'parent';
      strategy: string | null;
      partitionKey: string | null;
      partitions: Array<{ schema: string; name: string; qualified: string; bound: string }>;
    }
  | {
      role: 'partition';
      parentQualified: string;
      parentSchema: string;
      parentName: string;
      thisBound: string;
      strategy: string | null;
      partitionKey: string | null;
    };

/** 会话与锁监控摘要 */
export type SessionMonitorResult = {
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
  slowQuerySource:
    | 'pg_stat_statements'
    | 'pg_stat_activity'
    | 'mysql_processlist'
    | 'mysql_events_statements'
    | 'mssql_requests';
  collectedAt: number;
};

/** 已安装扩展 */
export type InstalledExtensionsResult = {
  extensions: Array<{
    name: string;
    installedVersion: string;
    schema: string;
    relocatable: boolean;
    defaultVersion: string | null;
    description: string | null;
  }>;
};

/** db/* 方法返回类型映射（前端据此推断） */
type DbResults = {
  'db/disconnect': { success: boolean; error?: string };
  'db/capabilities': { capabilities: DatabaseCapabilities };
  'db/query-stream': { rows: any[][]; columns: ColumnEditableInfo[]; hasMore: boolean; error?: string };
  'db/query-stream-more': { rows: any[][]; hasMore: boolean; error?: string };
  'db/cancel-query': { success: boolean; cancelled?: boolean; message?: string; error?: string };
  'db/save-changes': { success: boolean; rowCount?: number; error?: string };
  'db/explain': {
    plan: Array<{ Plan: any; 'Planning Time'?: number; 'Execution Time'?: number }>;
    error?: string;
  };
  'db/explain-text': { lines: string[] };
  'db/schemas': { schemas: string[]; error?: string };
  'db/tables': {
    tables: string[];
    views: string[];
    functions?: Array<{ oid: number; schema: string; name: string; args: string }>;
    error?: string;
  };
  'db/columns': { columns: any[]; error?: string };
  'db/indexes': { indexes: any[]; error?: string };
  'db/primary-keys': { columns: string[]; constraintName?: string; error?: string };
  'db/unique-constraints': {
    constraints: Array<{ name: string; type: string; columns: string[] }>;
    error?: string;
  };
  'db/foreign-keys': { outgoing: any[]; incoming: any[]; error?: string };
  'db/data-types': { types: string[]; error?: string };
  'db/table-comment': { comment: string | null };
  'db/check-constraints': { constraints: Array<{ name: string; expression: string }> };
  'db/partition-info': PartitionInfo;
  'db/execute-ddl': { success: boolean; error?: string };
  'db/table-ddl': { ddl: string; error?: string };
  'db/function-ddl': { ddl: string; error?: string };
  'db/schema-dump': { dump: string; error?: string };
  'db/database-dump': { dump: string; error?: string };
  'db/import-rows': { success: boolean; rowCount?: number; error?: string };
  'db/session-monitor': SessionMonitorResult;
  'db/session-control': { success: boolean; pid: number; action: 'cancel' | 'terminate' };
  'db/installed-extensions': InstalledExtensionsResult;
};

/** 把校验后的输入交给业务层（业务层返回 pure data），并按方法标注返回类型 */
function call<K extends keyof DbResults>(method: K, input: unknown): Promise<DbResults[K]> {
  return handleApiRequest(method as never, input as never) as Promise<DbResults[K]>;
}

export const dbRouter = t.router({
  // ── 连接 ─────────────────────────────────────────────
  /** 连接数据库 */
  connect: t.procedure
    .input(
      z.object({
        connectionId: z.string(),
        dbType: dbKindSchema,
        host: z.string(),
        port: z.string(),
        username: z.string(),
        password: z.string(),
        database: z.string(),
        connectionTimeoutSec: z.number().optional(),
        sshEnabled: z.boolean().optional(),
        sshHost: z.string().optional(),
        sshPort: z.string().optional(),
        sshUsername: z.string().optional(),
        sshPassword: z.string().optional(),
        sshPrivateKey: z.string().optional(),
      })
    )
    .mutation(
      ({ input }) =>
        handleApiRequest('db/connect', input as ConnectDbRequest) as Promise<{
          success: boolean;
          connectionId?: string;
          dbType?: DbKind;
          error?: unknown;
        }>
    ),

  /** 断开数据库连接 */
  disconnect: t.procedure
    .input(z.object(dbBase))
    .mutation(({ input }) => call('db/disconnect', input)),

  /** 当前会话的方言能力 */
  capabilities: t.procedure
    .input(z.object(dbBase))
    .query(({ input }) => call('db/capabilities', input)),

  // ── 查询执行 ─────────────────────────────────────────
  /** 执行查询（非流式） */
  query: t.procedure
    .input(z.object({ ...dbBase, query: z.string(), defaultSchema: z.string().optional() }))
    .mutation(({ input }) => handleApiRequest('db/query', input)),

  /** 流式查询 - 第一批 */
  queryStream: t.procedure
    .input(
      z.object({
        ...dbBase,
        query: z.string().optional(),
        statements: z.array(z.string()).optional(),
        batchSize: z.number().optional(),
        defaultSchema: z.string().optional(),
      })
    )
    .mutation(({ input }) => call('db/query-stream', input)),

  /** 流式查询 - 加载更多 */
  queryStreamMore: t.procedure
    .input(z.object({ ...dbBase, batchSize: z.number().optional(), defaultSchema: z.string().optional() }))
    .mutation(({ input }) => call('db/query-stream-more', input)),

  /** 取消当前查询 */
  cancelQuery: t.procedure
    .input(z.object(dbBase))
    .mutation(({ input }) => call('db/cancel-query', input)),

  /** 保存修改 */
  saveChanges: t.procedure
    .input(z.object({ ...dbBase, sql: z.string() }))
    .mutation(({ input }) => call('db/save-changes', input)),

  /** EXPLAIN ANALYZE（JSON 执行计划） */
  explain: t.procedure
    .input(z.object({ ...dbBase, query: z.string(), defaultSchema: z.string().optional() }))
    .mutation(({ input }) => call('db/explain', input)),

  /** EXPLAIN 文本计划（不执行查询） */
  explainText: t.procedure
    .input(z.object({ ...dbBase, query: z.string() }))
    .query(({ input }) => call('db/explain-text', input)),

  // ── 元数据 ───────────────────────────────────────────
  /** 获取 schemas */
  schemas: t.procedure.input(z.object(dbBase)).query(({ input }) => call('db/schemas', input)),

  /** 获取表 / 视图 / 函数 */
  tables: t.procedure
    .input(z.object({ ...dbBase, schema: z.string() }))
    .query(({ input }) => call('db/tables', input)),

  /** 获取列信息 */
  columns: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/columns', input)),

  /** 获取索引 */
  indexes: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/indexes', input)),

  /** 获取主键列名 */
  primaryKeys: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/primary-keys', input)),

  /** 获取唯一约束（含主键） */
  uniqueConstraints: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/unique-constraints', input)),

  /** 获取外键 */
  foreignKeys: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/foreign-keys', input)),

  /** 获取数据类型列表 */
  dataTypes: t.procedure.input(z.object(dbBase)).query(({ input }) => call('db/data-types', input)),

  /** 获取表注释 */
  tableComment: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/table-comment', input)),

  /** 获取检查约束列表 */
  checkConstraints: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/check-constraints', input)),

  /** 分区表信息 */
  partitionInfo: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/partition-info', input)),

  // ── DDL ──────────────────────────────────────────────
  /** 执行 DDL（CREATE/ALTER TABLE 等） */
  executeDdl: t.procedure
    .input(z.object({ ...dbBase, sql: z.string() }))
    .mutation(({ input }) => call('db/execute-ddl', input)),

  /** 获取表 / 视图的 DDL */
  tableDdl: t.procedure
    .input(z.object(schemaTable))
    .query(({ input }) => call('db/table-ddl', input)),

  /** 获取函数的源码 DDL */
  functionDdl: t.procedure
    .input(z.object({ ...dbBase, schema: z.string(), function: z.string(), oid: z.number().optional() }))
    .query(({ input }) => call('db/function-ddl', input)),

  /** 导出指定 schema 的 SQL dump */
  schemaDump: t.procedure
    .input(z.object({ ...dbBase, schema: z.string(), includeData: z.boolean().optional() }))
    .query(({ input }) => call('db/schema-dump', input)),

  /** 导出全库的 SQL dump */
  databaseDump: t.procedure
    .input(z.object({ ...dbBase, includeData: z.boolean().optional() }))
    .query(({ input }) => call('db/database-dump', input)),

  // ── 数据写入 ─────────────────────────────────────────
  /** 批量导入行到表 */
  importRows: t.procedure
    .input(
      z.object({
        ...schemaTable,
        columns: z.array(z.string()),
        rows: z.array(z.array(z.unknown())),
        conflictColumns: z.array(z.string()).optional(),
        onConflict: z.enum(['nothing', 'update']).optional(),
        onError: z.enum(['rollback', 'discard']).optional(),
      })
    )
    .mutation(({ input }) => call('db/import-rows', input)),

  // ── 会话 / 会话控制 ──────────────────────────────────
  /** 会话与锁监控摘要 */
  sessionMonitor: t.procedure
    .input(z.object({ ...dbBase, limit: z.number().optional() }))
    .query(({ input }) => call('db/session-monitor', input)),

  /** 取消当前语句或终止连接 */
  sessionControl: t.procedure
    .input(z.object({ ...dbBase, pid: z.number(), action: z.enum(['cancel', 'terminate']) }))
    .mutation(({ input }) => call('db/session-control', input)),

  /** 当前数据库已安装的扩展 */
  installedExtensions: t.procedure
    .input(z.object(dbBase))
    .query(({ input }) => call('db/installed-extensions', input)),

  // ── 订阅（替代旧 SSE `/api/events`）──────────────────
  /**
   * 订阅指定连接的数据库事件（NOTICE / ERROR / NOTIFICATION …）。
   * Web 端由 `httpSubscriptionLink` 通过 SSE 承载；VSCode / Electrobun 端由宿主 link 转发。
   */
  onConnectionEvents: t.procedure
    .input(z.object({ connectionId: z.string() }))
    .subscription(({ input }) => {
      return observable<SSEMessage>((emit) => {
        const session = getSession(input.connectionId);
        if (!session) {
          emit.error(new TRPCError({ code: 'NOT_FOUND', message: '未找到数据库连接，请先连接数据库' }));
          return;
        }

        const push = (msg: SSEMessage) => emit.next(msg);
        // 订阅建立后立刻推一条，便于前端确认通道就绪（与旧 SSE 行为一致）
        push({ type: 'NOTIFICATION', message: '事件订阅已建立', timestamp: Date.now() });

        let unsubscribe: () => void;
        try {
          unsubscribe = subscribeSessionEvents(input.connectionId, push);
        } catch (e) {
          emit.error(new TRPCError({ code: 'NOT_FOUND', message: e instanceof Error ? e.message : String(e) }));
          return;
        }

        return () => unsubscribe();
      });
    }),
});

export type DbRouter = typeof dbRouter;
