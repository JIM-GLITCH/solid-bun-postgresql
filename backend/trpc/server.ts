/**
 * tRPC 服务器实现
 * 将现有的 Effect 框架处理器集成到 tRPC router 中
 */

import { initTRPC } from '@trpc/server';
import { Effect } from 'effect';
import { z } from 'zod';
import { routeApiRequest } from '../api/ApiCoreRefactored';
import { AppRuntime as WebAppRuntime } from '../runtime/app-runtime';
import { VscodeAppRuntime } from '../runtime/vscode-runtime';

// 默认使用 Web 文件加密运行时；VSCode 入口在 registerTrpcHandler 内通过 setTrpcRuntime
// 切换为 SecretStorage 运行时。所有 procedure 里的 AppRuntime.runPromise 都引用这个可变绑定。
let AppRuntime: typeof WebAppRuntime = WebAppRuntime;
export function setTrpcRuntime(runtime: typeof WebAppRuntime): void {
  AppRuntime = runtime;
}

// 使用 zod 定义输入 schema（与 router.ts 保持一致）
const connectDbInputSchema = z.object({
  connectionId: z.string(),
  dbType: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']),
  host: z.string(),
  port: z.string(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUsername: z.string().optional(),
  sshPassword: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  connectionTimeoutSec: z.number().optional(),
});

const dbRpcBaseSchema = z.object({
  connectionId: z.string(),
  dbType: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']),
});

const queryStreamInputSchema = dbRpcBaseSchema.extend({
  batchSize: z.number().optional(),
  defaultSchema: z.string().optional(),
  query: z.string().optional(),
  statements: z.array(z.string()).optional(),
});

const queryStreamMoreInputSchema = dbRpcBaseSchema.extend({
  batchSize: z.number().optional(),
  defaultSchema: z.string().optional(),
});

const explainInputSchema = dbRpcBaseSchema.extend({
  query: z.string(),
  defaultSchema: z.string().optional(),
});

const schemaTableInputSchema = dbRpcBaseSchema.extend({
  schema: z.string(),
  table: z.string().optional(),
});

const importRowsInputSchema = dbRpcBaseSchema.extend({
  schema: z.string(),
  table: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.any())),
  conflictColumns: z.array(z.string()).optional(),
  onConflict: z.enum(['nothing', 'update']).optional(),
  onError: z.enum(['rollback', 'discard']).optional(),
});

const sessionControlInputSchema = dbRpcBaseSchema.extend({
  pid: z.number(),
  action: z.enum(['cancel', 'terminate']),
});

const sessionMonitorInputSchema = dbRpcBaseSchema.extend({
  limit: z.number().optional(),
});

const aiConfigSetSchema = z.object({
  apiMode: z.enum(['openai-compatible', 'anthropic']),
  baseUrl: z.string().optional(),
  model: z.string(),
  keyRef: z.string().optional(),
  apiKey: z.string().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  stream: z.boolean().optional(),
  maxTokens: z.number().optional(),
});

const aiSqlEditSchema = z.object({
  connectionId: z.string(),
  sql: z.string(),
  instructions: z.string().optional(),
  keyRef: z.string().optional(),
  schema: z.string().optional(),
});

const aiBuildPromptSchema = z.object({
  connectionId: z.string(),
  sql: z.string(),
  schema: z.string().optional(),
  instructions: z.string().optional(),
});

const aiBuildDiffPromptSchema = z.object({
  connectionId: z.string(),
  sql: z.string(),
  schema: z.string().optional(),
});

const aiTestConnectionSchema = z.object({
  apiMode: z.enum(['openai-compatible', 'anthropic']).optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  keyRef: z.string().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  stream: z.boolean().optional(),
  maxTokens: z.number().optional(),
});

const vscodeSaveFileSchema = z.object({
  content: z.string(),
  filename: z.string(),
  isBase64: z.boolean().optional(),
});

const vscodeReadFileSchema = z.object({
  accept: z.array(z.string()).optional(),
});

const vscodeAiKeySetSchema = z.object({
  keyRef: z.string(),
  apiKey: z.string(),
});

const vscodeAiKeyDeleteSchema = z.object({
  keyRef: z.string(),
});

const subscriptionAssertSchema = z.object({
  feature: z.enum(['visual-query-builder', 'table-designer']),
});

// 初始化 tRPC 服务器
const t = initTRPC.create();

// 创建实际的 tRPC router，集成现有的 Effect 处理器
export const appRouter = t.router({
  // 数据库相关路由
  db: t.router({
    // 连接数据库
    connect: t.procedure
      .input(connectDbInputSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/connect', input)
          );
          return result as { success: boolean; error?: string; dbType?: string };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 断开连接
    disconnect: t.procedure
      .input(dbRpcBaseSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/disconnect', input)
          );
          return result as { success: boolean; error?: string };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取数据库能力
    capabilities: t.procedure
      .input(dbRpcBaseSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/capabilities', input)
          );
          return result as { capabilities: any; error?: string };
        } catch (error) {
          return {
            capabilities: {},
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 流式查询 - 第一批
    queryStream: t.procedure
      .input(queryStreamInputSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/query-stream', input)
          );
          return result as { rows: any[][]; columns: any[]; hasMore: boolean; error?: string };
        } catch (error) {
          return {
            rows: [],
            columns: [],
            hasMore: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 流式查询 - 加载更多
    queryStreamMore: t.procedure
      .input(queryStreamMoreInputSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/query-stream-more', input)
          );
          return result as { rows: any[][]; hasMore: boolean; error?: string };
        } catch (error) {
          return {
            rows: [],
            hasMore: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 取消查询
    cancelQuery: t.procedure
      .input(dbRpcBaseSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/cancel-query', input)
          );
          return result as { success: boolean; cancelled?: boolean; message?: string; error?: string };
        } catch (error) {
          return {
            success: false,
            cancelled: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 保存修改
    saveChanges: t.procedure
      .input(dbRpcBaseSchema.extend({ sql: z.string() }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/save-changes', input)
          );
          return result as { success: boolean; rowCount?: number; error?: string };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 执行 EXPLAIN ANALYZE
    explain: t.procedure
      .input(explainInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/explain', input)
          );
          return result as { plan: any[]; error?: string };
        } catch (error) {
          return {
            plan: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取 schemas
    schemas: t.procedure
      .input(dbRpcBaseSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/schemas', input)
          );
          return result as { schemas: string[]; error?: string };
        } catch (error) {
          return {
            schemas: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取表/视图/函数
    tables: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/tables', input)
          );
          return result as { tables: string[]; views: string[]; functions?: any[]; error?: string };
        } catch (error) {
          return {
            tables: [],
            views: [],
            functions: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取列信息
    columns: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/columns', input)
          );
          return result as { columns: any[]; error?: string };
        } catch (error) {
          return {
            columns: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取索引
    indexes: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/indexes', input)
          );
          return result as { indexes: any[]; error?: string };
        } catch (error) {
          return {
            indexes: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取主键列名
    primaryKeys: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/primary-keys', input)
          );
          return result as { columns: string[]; constraintName?: string; error?: string };
        } catch (error) {
          return {
            columns: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取唯一约束
    uniqueConstraints: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/unique-constraints', input)
          );
          return result as { constraints: any[]; error?: string };
        } catch (error) {
          return {
            constraints: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取外键
    foreignKeys: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/foreign-keys', input)
          );
          const raw = (result as any)?.foreignKeys ?? [];
          const outgoing = raw.map((fk: any) => ({
            constraint_name: fk.constraintName ?? "",
            source_schema: input.schema,
            source_table: input.table,
            source_column: fk.columnName,
            target_schema: fk.referencedSchema,
            target_table: fk.referencedTable,
            target_column: fk.referencedColumn,
          }));
          // 后端目前只查询 outgoing 方向（本表引用其它表），incoming（其它表引用本表）尚未实现
          return { outgoing, incoming: [] as any[] };
        } catch (error) {
          return {
            outgoing: [],
            incoming: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取数据类型列表
    dataTypes: t.procedure
      .input(dbRpcBaseSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/data-types', input)
          );
          return result as { types: string[]; error?: string };
        } catch (error) {
          return {
            types: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 执行 DDL
    executeDdl: t.procedure
      .input(dbRpcBaseSchema.extend({ sql: z.string() }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/execute-ddl', input)
          );
          return result as { success: boolean; error?: string };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取表 DDL
    tableDdl: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/table-ddl', input)
          );
          return result as { ddl: string; error?: string };
        } catch (error) {
          return {
            ddl: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取函数 DDL
    functionDdl: t.procedure
      .input(schemaTableInputSchema.extend({ function: z.string(), oid: z.number().optional() }))
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/function-ddl', input)
          );
          return result as { ddl: string; error?: string };
        } catch (error) {
          return {
            ddl: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 导出 schema dump
    schemaDump: t.procedure
      .input(dbRpcBaseSchema.extend({ schema: z.string(), includeData: z.boolean().optional() }))
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/schema-dump', input)
          );
          return result as { dump: string; error?: string };
        } catch (error) {
          return {
            dump: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 导出 database dump
    databaseDump: t.procedure
      .input(dbRpcBaseSchema.extend({ includeData: z.boolean().optional() }))
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/database-dump', input)
          );
          return result as { dump: string; error?: string };
        } catch (error) {
          return {
            dump: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 批量导入行
    importRows: t.procedure
      .input(importRowsInputSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/import-rows', input)
          );
          return result as { success: boolean; rowCount?: number; error?: string };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    // 获取表注释
    tableComment: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/table-comment', input)
          );
          return result as { comment: string | null };
        } catch (error) {
          return {
            comment: null,
          };
        }
      }),

    // 获取检查约束
    checkConstraints: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/check-constraints', input)
          );
          const raw = (result as any)?.checkConstraints ?? [];
          return {
            constraints: raw.map((c: any) => ({ name: c.name, expression: c.definition })),
          };
        } catch (error) {
          return {
            constraints: [],
          };
        }
      }),

    // 获取分区信息
    partitionInfo: t.procedure
      .input(schemaTableInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/partition-info', input)
          );
          return result as any;
        } catch (error) {
          return {
            role: 'none' as const,
          };
        }
      }),

    // EXPLAIN 文本计划
    explainText: t.procedure
      .input(dbRpcBaseSchema.extend({ query: z.string() }))
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/explain-text', input)
          );
          return result as { lines: string[] };
        } catch (error) {
          return {
            lines: [],
          };
        }
      }),

    // 会话监控
    sessionMonitor: t.procedure
      .input(sessionMonitorInputSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/session-monitor', input)
          );
          return result as any;
        } catch (error) {
          return {
            connectionStats: { total: 0, active: 0, idle: 0, waiting: 0 },
            lockWaits: [],
            slowQueries: [],
            slowQuerySource: 'pg_stat_activity' as const,
            collectedAt: Date.now(),
          };
        }
      }),

    // 获取已安装扩展
    installedExtensions: t.procedure
      .input(dbRpcBaseSchema)
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/installed-extensions', input)
          );
          return result as { extensions: any[] };
        } catch (error) {
          return {
            extensions: [],
          };
        }
      }),

    // 会话控制
    sessionControl: t.procedure
      .input(sessionControlInputSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('db/session-control', input)
          );
          return result as { success: boolean; pid: number; action: 'cancel' | 'terminate' };
        } catch (error) {
          return {
            success: false,
            pid: input.pid,
            action: input.action,
          };
        }
      }),
  }),

  // 连接管理路由
  connections: t.router({
    list: t.procedure.query(async () => {
      try {
        const result = await AppRuntime.runPromise(
          routeApiRequest('connections/list', {})
        );
        return { items: result as any[] };
      } catch (error) {
        return {
          items: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),

    save: t.procedure
      .input(z.object({
        id: z.string(),
        name: z.string().optional(),
        group: z.string().optional(),
        host: z.string(),
        port: z.string(),
        database: z.string(),
        username: z.string(),
        password: z.string(),
        dbType: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']).optional(),
      }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('connections/save', input)
          );
          return result as { ok?: boolean; error?: string };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    delete: t.procedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('connections/delete', input)
          );
          return result as { ok?: boolean; error?: string };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    getParams: t.procedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('connections/get-params', input)
          );
          return result as any;
        } catch (error) {
          return null;
        }
      }),

    updateMeta: t.procedure
      .input(z.object({ id: z.string(), name: z.string().optional() }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('connections/update-meta', input)
          );
          return result as { ok?: boolean; error?: string };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    reorder: t.procedure
      .input(z.object({ list: z.array(z.any()) }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('connections/reorder', input)
          );
          return result as { ok?: boolean; error?: string };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    connect: t.procedure
      .input(z.object({ id: z.string(), sessionId: z.string().optional() }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('connections/connect', input)
          );
          return result as any;
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
  }),

  // AI 相关路由
  ai: t.router({
    configGet: t.procedure.query(async () => {
      try {
        const result = await AppRuntime.runPromise(
          routeApiRequest('ai/config/get', {})
        );
        return result as any;
      } catch (error) {
        return {
          apiMode: 'openai-compatible' as const,
          model: '',
          keyRef: '',
          temperature: 0.7,
          maxTokens: 1000,
          hasKey: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),

    configSet: t.procedure
      .input(aiConfigSetSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('ai/config/set', input)
          );
          return result as { success?: boolean; error?: string };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    keyDelete: t.procedure
      .input(z.object({ keyRef: z.string().optional() }))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('ai/key/delete', input)
          );
          return result as { success: boolean };
        } catch (error) {
          return {
            success: false,
          };
        }
      }),

    testConnection: t.procedure
      .input(aiTestConnectionSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('ai/test-connection', input)
          );
          return result as { success: boolean };
        } catch (error) {
          return {
            success: false,
          };
        }
      }),

    sqlEdit: t.procedure
      .input(aiSqlEditSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('ai/sql-edit', input)
          );
          return result as any;
        } catch (error) {
          return {
            sql: '',
            rationale: '',
            warnings: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    promptBuild: t.procedure
      .input(aiBuildPromptSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('ai/prompt-build', input)
          );
          return result as any;
        } catch (error) {
          return {
            prompt: '',
            schemaInjected: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),

    promptBuildDiff: t.procedure
      .input(aiBuildDiffPromptSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('ai/prompt-build-diff', input)
          );
          return result as any;
        } catch (error) {
          return {
            prompt: '',
            schemaInjected: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
  }),

  // VSCode 相关路由
  vscode: t.router({
    saveFile: t.procedure
      .input(vscodeSaveFileSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('vscode/save-file', input)
          );
          return result as { success?: boolean; cancelled?: boolean };
        } catch (error) {
          return {
            success: false,
            cancelled: false,
          };
        }
      }),

    readFile: t.procedure
      .input(vscodeReadFileSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('vscode/read-file', input)
          );
          return result as any;
        } catch (error) {
          return {
            cancelled: false,
          };
        }
      }),

    aiKeySet: t.procedure
      .input(vscodeAiKeySetSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('vscode/ai-key-set', input)
          );
          return result as { success: boolean };
        } catch (error) {
          return {
            success: false,
          };
        }
      }),

    aiKeyDelete: t.procedure
      .input(vscodeAiKeyDeleteSchema)
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('vscode/ai-key-delete', input)
          );
          return result as { success: boolean };
        } catch (error) {
          return {
            success: false,
          };
        }
      }),

    clipboardWrite: t.procedure
      .input(z.object({ text: z.string() }))
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('vscode/clipboard-write', input)
          );
          return;
        } catch (error) {
          throw error;
        }
      }),

    clipboardRead: t.procedure
      .input(z.object({}))
      .mutation(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('vscode/clipboard-read', input)
          );
          return result as { text?: string };
        } catch (error) {
          return {
            text: '',
          };
        }
      }),
  }),

  // 查询历史路由
  queryHistory: t.router({
    add: t.procedure
      .input(z.object({ sql: z.string(), connectionId: z.string().optional() }))
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('query-history/add', input)
          );
          return;
        } catch (error) {
          throw error;
        }
      }),

    search: t.procedure
      .input(z.object({
        keyword: z.string().optional(),
        since: z.number().optional(),
        until: z.number().optional(),
      }))
      .query(async ({ input }) => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('query-history/search', input)
          );
          return Array.isArray(result) ? result : [];
        } catch (error) {
          return [];
        }
      }),

    delete: t.procedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('query-history/delete', input)
          );
          return;
        } catch (error) {
          throw error;
        }
      }),

    clear: t.procedure
      .input(z.object({}))
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('query-history/clear', input)
          );
          return;
        } catch (error) {
          throw error;
        }
      }),
  }),

  // 订阅相关路由
  subscription: t.router({
    assert: t.procedure
      .input(subscriptionAssertSchema)
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('subscription/assert', input)
          );
          return;
        } catch (error) {
          throw error;
        }
      }),

    account: t.procedure
      .query(async () => {
        try {
          const result = await AppRuntime.runPromise(
            routeApiRequest('subscription/account', {})
          );
          return result as { loggedIn: boolean; user?: { id?: number; email?: string | null } };
        } catch (error) {
          return {
            loggedIn: false,
            user: undefined,
          };
        }
      }),

    // 订阅连接事件
    subscribeEvents: t.procedure
      .input(z.object({ connectionId: z.string() }))
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('subscription/subscribe-events', input)
          );
          return { success: true };
        } catch (error) {
          throw error;
        }
      }),

    // 订阅服务端推送
    subscribeServerMessages: t.procedure
      .input(z.object({}))
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('subscription/subscribe-server-messages', input)
          );
          return { success: true };
        } catch (error) {
          throw error;
        }
      }),

    // 订阅账号状态
    subscribeAccountState: t.procedure
      .input(z.object({}))
      .mutation(async ({ input }) => {
        try {
          await AppRuntime.runPromise(
            routeApiRequest('subscription/subscribe-account-state', input)
          );
          return { success: true };
        } catch (error) {
          throw error;
        }
      }),
  }),
});

// 导出 router 类型（确保与前端一致）
export type AppRouter = typeof appRouter;