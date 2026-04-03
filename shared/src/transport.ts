/**
 * 前后端消息通信抽象层
 * 支持不同运行环境：Web (fetch+SSE) / VSCode (postMessage)
 *
 * 数据库相关 RPC 统一为 db/*，载荷中须带 dbType（postgres / mysql 等）。
 */

import type { SSEMessage, ConnectDbRequest, DbKind, ConnectionSavePayload } from "./types";

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
  "db/query-readonly",
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
  "vscode/save-file",
  "vscode/read-file",
  "vscode/clipboard-write",
  "vscode/clipboard-read",
  "vscode/ai-key-set",
  "vscode/ai-key-delete",
] as const;

export type ApiMethod = (typeof API_METHODS)[number];

/** Web HTTP 可调用的 RPC（不含 vscode/*） */
export type HttpRpcMethod = Exclude<ApiMethod, `vscode/${string}`>;

function isHttpRpcMethod(m: ApiMethod): m is HttpRpcMethod {
  return !m.startsWith("vscode/");
}

/** `POST /api/${method}` 合法方法名集合 */
export const HTTP_API_METHOD_SET: ReadonlySet<HttpRpcMethod> = new Set(API_METHODS.filter(isHttpRpcMethod));

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
  "db/query-readonly": DbRpcBase & { query: string; limit?: number; defaultSchema?: string };
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
  "vscode/save-file": { content: string; filename: string; isBase64?: boolean };
  "vscode/read-file": { accept?: string[] };
  "vscode/clipboard-write": { text: string };
  "vscode/clipboard-read": Record<string, never>;
  "vscode/ai-key-set": { keyRef: string; apiKey: string };
  "vscode/ai-key-delete": { keyRef: string };
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

/** 传输层接口：前端通过此接口与后端通信 */
export interface IApiTransport {
  request<M extends ApiMethod>(method: M, payload: ApiRequestPayload[M]): Promise<unknown>;

  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void;
}
