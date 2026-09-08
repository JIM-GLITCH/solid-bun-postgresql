/**
 * 前后端消息通信抽象层
 * 支持不同运行环境：Web (fetch+SSE) / VSCode (postMessage)
 *
 * 数据库相关 RPC 统一为 db/*，载荷中须带 dbType（postgres / mysql 等）。
 */

import type {
  AccountStateMessage,
  ServerPushMessage,
  SSEMessage,
  ConnectDbRequest,
  DbKind,
  ConnectionSavePayload,
  DatabaseCapabilities,
} from "./types";

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
  "subscription/assert",
  "subscription/account",
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
  "vscode/save-file",
  "vscode/read-file",
  "vscode/clipboard-write",
  "vscode/clipboard-read",
  "vscode/ai-key-set",
  "vscode/ai-key-delete",
] as const;

export type ApiMethod = (typeof API_METHODS)[number];

export type ApiRpcResultMap = {
  "connections/list": { items?: unknown[]; error?: string };
  "connections/save": { ok?: boolean; error?: string };
  "connections/delete": { ok?: boolean; error?: string };
  "connections/update-meta": { ok?: boolean; error?: string };
  "connections/reorder": { ok?: boolean; error?: string };
  "connections/get-params": { id: string; dbType?: DbKind; host?: string; port?: string; database?: string; username?: string; password?: string; error?: string };
  "connections/connect": { success?: boolean; error?: string; dbType?: DbKind };
  "query-history/add": { id?: string; error?: string };
  "query-history/search": { items?: unknown[]; error?: string };
  "query-history/delete": { ok?: boolean; error?: string };
  "query-history/clear": { ok?: boolean; error?: string };
  "subscription/assert": { ok?: boolean; error?: string };
  "subscription/account": { loggedIn: boolean; user?: { id?: number; email?: string | null } };
  "db/connect": { success?: boolean; error?: string; dbType?: DbKind };
  "db/disconnect": { success?: boolean; error?: string };
  "db/query": { rows: unknown[][]; columns?: unknown[]; error?: string };
  "db/capabilities": { capabilities: DatabaseCapabilities; error?: string };
  "db/query-stream": { rows: unknown[][]; columns?: unknown[]; hasMore: boolean; error?: string };
  "db/query-stream-more": { rows: unknown[][]; hasMore: boolean; error?: string };
  "db/save-changes": { success?: boolean; rowCount?: number; error?: string };
  "db/cancel-query": { success?: boolean; cancelled?: boolean; message?: string; error?: string };
  "db/explain": { plan: unknown[]; error?: string };
  "db/schemas": { schemas: string[]; error?: string };
  "db/tables": { tables: string[]; views: string[]; functions?: Array<{ oid?: number; schema?: string; name?: string; args?: string }>; error?: string };
  "db/columns": { columns: unknown[]; error?: string };
  "db/indexes": { indexes: unknown[]; error?: string };
  "db/foreign-keys": { outgoing: unknown[]; incoming: unknown[]; error?: string };
  "db/data-types": { types: string[]; error?: string };
  "db/execute-ddl": { success?: boolean; error?: string };
  "db/table-ddl": { ddl: string; error?: string };
  "db/function-ddl": { ddl: string; error?: string };
  "db/schema-dump": { dump: string; error?: string };
  "db/database-dump": { dump: string; error?: string };
  "db/primary-keys": { columns: string[]; constraintName?: string; error?: string };
  "db/unique-constraints": { constraints: Array<{ name: string; type: string; columns: string[] }>; error?: string };
  "db/import-rows": { success?: boolean; rowCount?: number; error?: string };
  "db/table-comment": { comment: string | null; error?: string };
  "db/check-constraints": { constraints: Array<{ name: string; expression: string }>; error?: string };
  "db/partition-info": { role: "none" | "parent" | "partition"; error?: string };
  "db/explain-text": { lines: string[]; error?: string };
  "db/session-monitor": { connectionStats?: unknown; lockWaits?: unknown[]; slowQueries?: unknown[]; slowQuerySource?: string; collectedAt?: number; error?: string };
  "db/session-control": { success?: boolean; pid?: number; action?: "cancel" | "terminate"; error?: string };
  "db/installed-extensions": { extensions: Array<{ name: string; installedVersion: string; schema: string; relocatable: boolean; defaultVersion: string | null; description: string | null }>; error?: string };
  "vscode/save-file": { success?: boolean; cancelled?: boolean; error?: string };
  "vscode/read-file": { cancelled?: boolean; content?: string; filename?: string; contentBase64?: string; error?: string };
  "vscode/clipboard-write": { success?: boolean; error?: string };
  "vscode/clipboard-read": { text?: string; error?: string };
  "vscode/ai-key-set": { success?: boolean; error?: string };
  "vscode/ai-key-delete": { success?: boolean; error?: string };
  "ai/config/get": { apiMode: "openai-compatible" | "anthropic"; baseUrl?: string; model: string; keyRef: string; temperature: number; topP?: number; stream?: boolean; maxTokens: number; hasKey: boolean; error?: string };
  "ai/config/set": { success?: boolean; error?: string };
  "ai/key/delete": { success?: boolean; error?: string };
  "ai/test-connection": { success?: boolean; error?: string };
  "ai/sql-edit": { sql: string; rationale: string; warnings: string[]; alternatives?: string[]; usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }; elapsedMs?: number; schemaInjected?: string[]; error?: string };
  "ai/prompt-build": { prompt: string; schemaInjected?: string[]; error?: string };
  "ai/prompt-build-diff": { prompt: string; schemaInjected?: string[]; error?: string };
};

export type ApiRpcResult<M extends ApiMethod> = ApiRpcResultMap[M];

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
  "subscription/assert": { feature: "visual-query-builder" | "table-designer" };
  "subscription/account": Record<string, never>;
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

/** `transport.on(...)` 订阅形态：仅 `request` + `on` 两入口 */
export type TransportOnSubscribe =
  | { event: "push"; handler: (msg: ServerPushMessage) => void }
  | { event: "connection"; connectionId: string; handler: (msg: SSEMessage) => void }
  | { event: "account"; handler: (msg: AccountStateMessage) => void };

/**
 * 传输层接口：与宿主后端的唯一通信面（RPC + 推送）。
 * 业务若只依赖 transport：`request` + `on` 即可，勿在业务里直接使用 EventSource / VSCode postMessage 协议细节。
 */
export interface IApiTransport {
  request<M extends ApiMethod>(method: M, payload: ApiRequestPayload[M]): Promise<ApiRpcResult<M>>;

  /** 订阅服务端推送（SSE / postMessage / IPC 封装在实现内） */
  on(sub: TransportOnSubscribe): () => void;
}
