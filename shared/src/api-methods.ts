/**
 * 业务 API 契约（方法名 + 请求载荷）。
 *
 * 这些方法是**业务后端**（`backend/api-core`）能处理的全集，运行时入口有两类：
 * - Web / Standalone：tRPC `appRouter` → `handleApiRequest`
 * - Electrobun 主进程：直接 `handleApiRequest`
 *
 * 传输层（HTTP / SSE / postMessage）已由 tRPC 与 vscode-messenger 各自封装，
 * 本文件只描述「方法 ↔ 载荷」映射，不含任何传输实现。
 *
 * 注意：宿主专属能力（`host/*` 的文件、剪贴板、AI Key，或 `dbplayer/*` 的登录态）
 * **不在此列**——它们同为 tRPC procedure（`host.*` / `subscription.*`），
 * 但由宿主实现而非本业务后端，见 `backend/trpc/router/host.ts`。
 */

import type { ConnectDbRequest, DbKind, ConnectionSavePayload } from "./types";

/** 需已有会话的 db 请求公共字段 */
export type DbRpcBase = { connectionId: string; dbType: DbKind };

/** API 方法名（唯一真源：增删 RPC 时只改此数组；`ApiMethod` 由其推导） */
export const API_METHODS = [
  "connections/list",
  "connections/save",
  "connections/delete",
  "connections/update-meta",
  "connections/reorder",
  "connections/get-params",
  "connections/connect",
  "query-history/add",
  "query-history/search",
  "query-history/delete",
  "query-history/clear",
  "db/connect",
  "db/disconnect",
  "db/query",
  "db/capabilities",
  "db/query-stream",
  "db/query-stream-more",
  "db/save-changes",
  "db/cancel-query",
  "db/explain",
  "db/schemas",
  "db/tables",
  "db/columns",
  "db/indexes",
  "db/foreign-keys",
  "db/data-types",
  "db/execute-ddl",
  "db/table-ddl",
  "db/function-ddl",
  "db/schema-dump",
  "db/database-dump",
  "db/primary-keys",
  "db/unique-constraints",
  "db/import-rows",
  "db/table-comment",
  "db/check-constraints",
  "db/partition-info",
  "db/explain-text",
  "db/session-monitor",
  "db/session-control",
  "db/installed-extensions",
  "ai/config/get",
  "ai/config/set",
  "ai/key/delete",
  "ai/test-connection",
  "ai/sql-edit",
  "ai/prompt-build",
  "ai/prompt-build-diff",
] as const;

export type ApiMethod = (typeof API_METHODS)[number];

/** 请求载荷 */
export type ApiRequestPayload = {
  "connections/list": {};
  "connections/save": ConnectionSavePayload;
  "connections/delete": { id: string };
  "connections/update-meta": { id: string; name?: string };
  "connections/reorder": { list: unknown[] };
  "connections/get-params": { id: string };
  "connections/connect": { id: string; sessionId?: string };
  "query-history/add": { sql: string; connectionId?: string };
  "query-history/search": { keyword?: string; since?: number; until?: number };
  "query-history/delete": { id: string };
  "query-history/clear": {};
  "db/connect": ConnectDbRequest;
  "db/disconnect": DbRpcBase;
  "db/query": DbRpcBase & { query: string; defaultSchema?: string };
  "db/capabilities": DbRpcBase;
  "db/query-stream": DbRpcBase & {
    query?: string;
    statements?: string[];
    batchSize?: number;
    /** MySQL：执行前 USE 该库（与侧栏「当前库」一致）；PostgreSQL忽略 */
    defaultSchema?: string;
  };
  "db/query-stream-more": DbRpcBase & { batchSize?: number; defaultSchema?: string };
  "db/save-changes": DbRpcBase & { sql: string };
  "db/cancel-query": DbRpcBase;
  "db/explain": DbRpcBase & { query: string; defaultSchema?: string };
  "db/schemas": DbRpcBase;
  "db/tables": DbRpcBase & { schema: string };
  "db/columns": DbRpcBase & { schema: string; table: string };
  "db/indexes": DbRpcBase & { schema: string; table: string };
  "db/foreign-keys": DbRpcBase & { schema: string; table: string };
  "db/data-types": DbRpcBase;
  "db/execute-ddl": DbRpcBase & { sql: string };
  "db/table-ddl": DbRpcBase & { schema: string; table: string };
  "db/function-ddl": DbRpcBase & { schema: string; function: string; oid?: number };
  "db/schema-dump": DbRpcBase & { schema: string; includeData?: boolean };
  "db/database-dump": DbRpcBase & { includeData?: boolean };
  "db/primary-keys": DbRpcBase & { schema: string; table: string };
  "db/unique-constraints": DbRpcBase & { schema: string; table: string };
  "db/import-rows": DbRpcBase & {
    schema: string;
    table: string;
    columns: string[];
    rows: any[][];
    conflictColumns?: string[];
    onConflict?: "nothing" | "update";
    onError?: "rollback" | "discard";
  };
  "ai/config/get": Record<string, never>;
  "ai/config/set": {
    apiMode: "openai-compatible" | "anthropic";
    baseUrl?: string;
    model: string;
    keyRef?: string;
    apiKey?: string;
    temperature?: number;
    topP?: number;
    stream?: boolean;
    maxTokens?: number;
  };
  "ai/key/delete": {
    keyRef?: string;
  };
  "ai/test-connection": {
    apiMode?: "openai-compatible" | "anthropic";
    baseUrl?: string;
    model?: string;
    keyRef?: string;
    temperature?: number;
    topP?: number;
    stream?: boolean;
    maxTokens?: number;
  };
  "ai/sql-edit": {
    connectionId: string;
    sql: string;
    instructions?: string;
    keyRef?: string;
    schema?: string;
  };
  "ai/prompt-build": {
    connectionId: string;
    sql: string;
    schema?: string;
    instructions?: string;
  };
  "ai/prompt-build-diff": {
    connectionId: string;
    sql: string;
    schema?: string;
  };
  "db/table-comment": DbRpcBase & { schema: string; table: string };
  "db/check-constraints": DbRpcBase & { schema: string; table: string };
  "db/partition-info": DbRpcBase & { schema: string; table: string };
  "db/explain-text": DbRpcBase & { query: string };
  "db/session-monitor": DbRpcBase & { limit?: number };
  "db/session-control": DbRpcBase & { pid: number; action: "cancel" | "terminate" };
  "db/installed-extensions": DbRpcBase;
};
