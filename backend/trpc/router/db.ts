/**
 * DB Router
 * 处理数据库连接、查询、DDL 等全部 db/* 操作。
 *
 * 业务实现直接调用 `backend/db-handlers` 的 Effect handler 函数；
 * 这里只负责输入校验 / query-mutation 语义 / 返回类型标注 / 订阅实现。
 *
 * 返回类型是「唯一真源」：handler 函数返回类型在此集中标注，
 * 前端即可直接 `trpc.db.xxx.query(...)` 获得类型推断，无需再包一层封装。
 */
import { Cause, Effect } from 'effect';
import { t } from '../init';
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { getSessionInfo, subscribeSessionEvents } from '../../api-core';
import {
  dbConnect, dbDisconnect, dbCapabilities, dbSchemas, dbTables, dbColumns,
  dbQueryStream, dbQueryStreamMore, dbQuery, dbCancelQuery, dbSaveChanges, dbExplain,
  dbExplainText, dbIndexes, dbPrimaryKeys, dbUniqueConstraints, dbForeignKeys,
  dbDataTypes, dbTableComment, dbCheckConstraints, dbPartitionInfo, dbExecuteDdl,
  dbTableDdl, dbFunctionDdl, dbSchemaDump, dbDatabaseDump, dbImportRows,
  dbSessionMonitor, dbSessionControl, dbInstalledExtensions,
  getStrategy,
  CurrentConnectionId, CurrentDbType,
} from '../../db-handlers';
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

/**
 * db router 的错误出口：把 Effect 的 `UnknownError` 还原成原始错误。
 *
 * handler 内裸 `Effect.tryPromise`（无 `catch` 选项）失败时，effect 会把未知错误
 * 包成 `Cause.UnknownError`，其 `message` 固定为 "An error occurred in
 * Effect.tryPromise"，驱动层的真实原因（如 Access denied / 认证失败）只存在于
 * `Error.cause`。前端 `formatUnknownError` 只读 `message`，所以必须在这里拆包。
 *
 * 已带具体 message 的 Error 原样透传；非 Error 的 cause 包装成 Error。
 */
function unwrapEffectError(e: unknown): unknown {
  if (Cause.isUnknownError(e) && e.cause != null) {
    return e.cause instanceof Error ? e.cause : new Error(String(e.cause));
  }
  return e;
}

/**
 * 统一运行 db handler——**请求级 Context 的唯一 provide 点**：
 * 1. 把 zod 校验后的 input 投影为 `CurrentConnectionId` / `CurrentDbType`；
 * 2. handler 经 `currentConnection` 按需解析「会话 + 连接器 + 方言策略」，
 *    并派生绑定的 `query` / `notify`（connectionId 已闭入，无需逐个手递）；
 * 3. provide 之后 R = never，才能交给 `Effect.runPromise`。
 *
 * ⚠️ 这两个 tag 只允许在这里 provide；handler 内只 yield，不得在别处提供。
 */
const runDbHandler = <P, A, E>(
  handler: (params: P) => Effect.Effect<A, E, CurrentConnectionId | CurrentDbType>
) =>
  ({ input }: { input: P & { connectionId: string; dbType: DbKind } }): Promise<A> =>
    Effect.runPromise(
      handler(input).pipe(
        Effect.provideService(CurrentConnectionId, input.connectionId),
        Effect.provideService(CurrentDbType, input.dbType),
      )
    ).catch((e) => {
      throw unwrapEffectError(e);
    });

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
  /**
   * 慢查询来源标识。各策略实现返回的字面量联合（pg_stat_statements /
   * pg_stat_activity / mysql_processlist / mysql_events_statements /
   * mssql_requests，兜底为 unknown）在 handler 推断时被 widen 为 string，
   * 故声明宽化以对齐真实契约；消费方按 default 分支渲染。
   */
  slowQuerySource: string;
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
    .mutation(({ input }) =>
      // 真正的连接逻辑在 dbConnect（→ connectSession → sessionsRuntime.openSession）。
      // zod 的 dbKindSchema 已校验 dbType 为四者之一，此处收敛为 ConnectDbRequest 判别联合。
      Effect.runPromise(dbConnect(input as ConnectDbRequest)).catch((e) => {
        throw unwrapEffectError(e);
      })
    ),

  /** 断开数据库连接 */
  disconnect: t.procedure
    .input(z.object(dbBase))
    .mutation(runDbHandler(dbDisconnect)),

  /** 当前会话的方言能力 */
  capabilities: t.procedure
    .input(z.object(dbBase))
    .query(runDbHandler(dbCapabilities)),

  // ── 查询执行 ─────────────────────────────────────────
  /** 执行查询（非流式） */
  query: t.procedure
    .input(z.object({ ...dbBase, query: z.string(), defaultSchema: z.string().optional() }))
    .mutation(runDbHandler(dbQuery)),

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
    .mutation(runDbHandler(dbQueryStream)),

  /** 流式查询 - 加载更多 */
  queryStreamMore: t.procedure
    .input(z.object({ ...dbBase, batchSize: z.number().optional(), defaultSchema: z.string().optional() }))
    .mutation(runDbHandler(dbQueryStreamMore)),

  /** 取消当前查询 */
  cancelQuery: t.procedure
    .input(z.object(dbBase))
    .mutation(runDbHandler(dbCancelQuery)),

  /** 保存修改 */
  saveChanges: t.procedure
    .input(z.object({ ...dbBase, sql: z.string() }))
    .mutation(runDbHandler(dbSaveChanges)),

  /** EXPLAIN ANALYZE（JSON 执行计划） */
  explain: t.procedure
    .input(z.object({ ...dbBase, query: z.string(), defaultSchema: z.string().optional() }))
    .mutation(runDbHandler(dbExplain)),

  /** EXPLAIN 文本计划（不执行查询） */
  explainText: t.procedure
    .input(z.object({ ...dbBase, query: z.string() }))
    .query(runDbHandler(dbExplainText)),

  // ── 元数据 ───────────────────────────────────────────
  /** 获取 schemas */
  schemas: t.procedure.input(z.object(dbBase)).query(runDbHandler(dbSchemas)),

  /** 获取表 / 视图 / 函数 */
  tables: t.procedure
    .input(z.object({ ...dbBase, schema: z.string() }))
    .query(runDbHandler(dbTables)),

  /** 获取列信息 */
  columns: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbColumns)),

  /** 获取索引 */
  indexes: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbIndexes)),

  /** 获取主键列名 */
  primaryKeys: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbPrimaryKeys)),

  /** 获取唯一约束（含主键） */
  uniqueConstraints: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbUniqueConstraints)),

  /** 获取外键 */
  foreignKeys: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbForeignKeys)),

  /** 获取数据类型列表 */
  dataTypes: t.procedure.input(z.object(dbBase)).query(runDbHandler(dbDataTypes)),

  /** 获取表注释 */
  tableComment: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbTableComment)),

  /** 获取检查约束列表 */
  checkConstraints: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbCheckConstraints)),

  /** 分区表信息 */
  partitionInfo: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbPartitionInfo)),

  // ── DDL ──────────────────────────────────────────────
  /** 执行 DDL（CREATE/ALTER TABLE 等） */
  executeDdl: t.procedure
    .input(z.object({ ...dbBase, sql: z.string() }))
    .mutation(runDbHandler(dbExecuteDdl)),

  /** 获取表 / 视图的 DDL */
  tableDdl: t.procedure
    .input(z.object(schemaTable))
    .query(runDbHandler(dbTableDdl)),

  /** 获取函数的源码 DDL */
  functionDdl: t.procedure
    .input(z.object({ ...dbBase, schema: z.string(), function: z.string(), oid: z.number().optional() }))
    .query(runDbHandler(dbFunctionDdl)),

  /** 导出指定 schema 的 SQL dump */
  schemaDump: t.procedure
    .input(z.object({ ...dbBase, schema: z.string(), includeData: z.boolean().optional() }))
    .query(runDbHandler(dbSchemaDump)),

  /** 导出全库的 SQL dump */
  databaseDump: t.procedure
    .input(z.object({ ...dbBase, includeData: z.boolean().optional() }))
    .query(runDbHandler(dbDatabaseDump)),

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
    .mutation(runDbHandler(dbImportRows)),

  // ── 会话 / 会话控制 ──────────────────────────────────
  /** 会话与锁监控摘要 */
  sessionMonitor: t.procedure
    .input(z.object({ ...dbBase, limit: z.number().optional() }))
    .query(runDbHandler(dbSessionMonitor)),

  /** 取消当前语句或终止连接 */
  sessionControl: t.procedure
    .input(z.object({ ...dbBase, pid: z.number(), action: z.enum(['cancel', 'terminate']) }))
    .mutation(runDbHandler(dbSessionControl)),

  /** 当前数据库已安装的扩展 */
  installedExtensions: t.procedure
    .input(z.object(dbBase))
    .query(runDbHandler(dbInstalledExtensions)),

  // ── 订阅（替代旧 SSE `/api/events`）──────────────────
  /**
   * 订阅指定连接的数据库事件（NOTICE / ERROR / NOTIFICATION …）。
   * Web 端由 `httpSubscriptionLink` 通过 SSE 承载；VSCode / Electrobun 端由宿主 link 转发。
   */
  onConnectionEvents: t.procedure
    .input(z.object({ connectionId: z.string() }))
    .subscription(({ input }) => {
      return observable<SSEMessage>((emit) => {
        const session = getSessionInfo(input.connectionId);
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
