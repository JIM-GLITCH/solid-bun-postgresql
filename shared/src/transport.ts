/**
 * 前后端消息通信抽象层
 * 支持不同运行环境：Web (fetch+SSE) / VSCode (postMessage)
 */

import type { PostgresLoginParams, SSEMessage, ConnectPostgresRequest } from "./types";

/** API 方法名 */
export type ApiMethod =
  | "connections/list"
  | "connections/save"
  | "connections/delete"
  | "connections/update-meta"
  | "connections/reorder"
  | "connections/get-params"
  | "connections/connect"
  | "query-history/add"
  | "query-history/search"
  | "query-history/delete"
  | "query-history/clear"
  | "connect-postgres"
  | "disconnect-postgres"
  | "postgres/query"
  | "postgres/query-stream"
  | "postgres/query-stream-more"
  | "postgres/save-changes"
  | "postgres/cancel-query"
  | "postgres/query-readonly"
  | "postgres/explain"
  | "postgres/schemas"
  | "postgres/tables"
  | "postgres/columns"
  | "postgres/indexes"
  | "postgres/foreign-keys"
  | "postgres/data-types"
  | "postgres/execute-ddl"
  | "postgres/table-ddl"
  | "postgres/function-ddl"
  | "postgres/schema-dump"
  | "postgres/database-dump"
  | "postgres/primary-keys"
  | "postgres/unique-constraints"
  | "postgres/import-rows"
  | "postgres/table-comment"
  | "postgres/check-constraints"
  | "postgres/partition-info"
  | "postgres/explain-text"
  | "postgres/pg-stat-overview"
  | "postgres/manage-backend"
  | "postgres/installed-extensions"
  | "ai/config/get"
  | "ai/config/set"
  | "ai/key/delete"
  | "ai/test-connection"
  | "ai/sql-edit"
  | "ai/prompt-build"
  | "ai/prompt-build-diff"
  | "vscode/save-file"
  | "vscode/read-file"
  | "vscode/clipboard-write"
  | "vscode/clipboard-read"
  | "vscode/ai-key-set"
  | "vscode/ai-key-delete";

/** 请求载荷 */
export type ApiRequestPayload = {
  "connections/list": {};
  "connections/save": { id: string; name?: string } & PostgresLoginParams;
  "connections/delete": { id: string };
  "connections/update-meta": { id: string; name?: string };
  "connections/reorder": { list: unknown[] };
  "connections/get-params": { id: string };
  "connections/connect": { id: string; sessionId?: string };
  "query-history/add": { sql: string; connectionId?: string };
  "query-history/search": { keyword?: string; since?: number; until?: number };
  "query-history/delete": { id: string };
  "query-history/clear": {};
  "connect-postgres": ConnectPostgresRequest;
  "disconnect-postgres": { connectionId: string };
  "postgres/query": { query: string; connectionId: string };
  "postgres/query-stream": { connectionId: string; query?: string; statements?: string[]; batchSize?: number };
  "postgres/query-stream-more": { batchSize?: number; connectionId: string };
  "postgres/save-changes": { sql: string; connectionId: string };
  "postgres/cancel-query": { connectionId: string };
  "postgres/query-readonly": { query: string; limit?: number; connectionId: string };
  "postgres/explain": { query: string; connectionId: string };
  "postgres/schemas": { connectionId: string };
  "postgres/tables": { schema: string; connectionId: string };
  "postgres/columns": { schema: string; table: string; connectionId: string };
  "postgres/indexes": { schema: string; table: string; connectionId: string };
  "postgres/foreign-keys": { schema: string; table: string; connectionId: string };
  "postgres/data-types": { connectionId: string };
  "postgres/execute-ddl": { connectionId: string; sql: string };
  "postgres/table-ddl": { connectionId: string; schema: string; table: string };
  "postgres/function-ddl": { connectionId: string; schema: string; function: string; oid?: number };
  "postgres/schema-dump": { connectionId: string; schema: string; includeData?: boolean };
  "postgres/database-dump": { connectionId: string; includeData?: boolean };
  "postgres/primary-keys": { connectionId: string; schema: string; table: string };
  "postgres/unique-constraints": { connectionId: string; schema: string; table: string };
  "postgres/import-rows": {
    connectionId: string;
    schema: string;
    table: string;
    columns: string[];
    rows: any[][];
    /** 作为冲突检测的列（来自列映射中勾选“主键”的目标列），空则纯插入 */
    conflictColumns?: string[];
    /** 唯一约束冲突时：nothing=保留旧数据，update=更新为新数据 */
    onConflict?: "nothing" | "update";
    /** 插入报错时：rollback=整体回退，discard=丢弃该行继续 */
    onError?: "rollback" | "discard";
  };
  /** VSCode 插件内：保存文件到用户选择路径（Extension Host 弹窗 + 写盘） */
  "vscode/save-file": { content: string; filename: string; isBase64?: boolean };
  /** VSCode 插件内：打开文件选择器并返回文件内容（Extension Host 弹窗 + 读盘） */
  "vscode/read-file": { accept?: string[] };
  /** VSCode 插件内：写入剪贴板（webview 中 navigator.clipboard 受限） */
  "vscode/clipboard-write": { text: string };
  /** VSCode 插件内：读取剪贴板 */
  "vscode/clipboard-read": Record<string, never>;
  /** VSCode 插件内：保存 AI key 到 SecretStorage */
  "vscode/ai-key-set": { keyRef: string; apiKey: string };
  /** VSCode 插件内：删除 AI key */
  "vscode/ai-key-delete": { keyRef: string };
  /** 获取 AI 配置（不含密钥） */
  "ai/config/get": Record<string, never>;
  /** 设置 AI 配置（Web 可附带 apiKey 用于会话缓存） */
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
  /** 删除已保存 AI key（Web 持久化存储） */
  "ai/key/delete": {
    keyRef?: string;
  };
  /** 校验 AI Provider 连接可用性 */
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
  /** 自然语言 -> SQL */
  "ai/sql-edit": {
    connectionId: string;
    sql: string;
    instructions?: string;
    keyRef?: string;
    schema?: string;
  };
  /** 构建可复制到免费 AI 的 prompt（含 schema 注入） */
  "ai/prompt-build": {
    connectionId: string;
    sql: string;
    schema?: string;
    instructions?: string;
  };
  /** 构建 diff prompt（含 schema 注入） */
  "ai/prompt-build-diff": {
    connectionId: string;
    sql: string;
    schema?: string;
  };
  "postgres/table-comment": { connectionId: string; schema: string; table: string };
  "postgres/check-constraints": { connectionId: string; schema: string; table: string };
  "postgres/partition-info": { connectionId: string; schema: string; table: string };
  /** EXPLAIN (FORMAT TEXT)，不写库、不 ANALYZE，用于分区裁剪等计划预览 */
  "postgres/explain-text": { connectionId: string; query: string };
  /** pg_stat 监控概览：慢查询、锁等待、连接统计 */
  "postgres/pg-stat-overview": { connectionId: string; limit?: number };
  /** pg_stat 中对会话执行 cancel/terminate */
  "postgres/manage-backend": { connectionId: string; pid: number; action: "cancel" | "terminate" };
  /** 当前库已安装的 PostgreSQL 扩展（名称、版本、说明等） */
  "postgres/installed-extensions": { connectionId: string };
};

/** 传输层接口：前端通过此接口与后端通信 */
export interface IApiTransport {
  /** 发送 RPC 请求 */
  request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown>;

  /** 订阅服务端推送（数据库 NOTICE/ERROR 等） */
  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void;
}
