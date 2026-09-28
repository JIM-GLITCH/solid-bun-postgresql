/**
 * 查询历史 - 后端持久化（与连接存储同目录）
 * 保存最近 500 条查询，支持按内容/时间搜索、一键复用
 */

import { getTrpcClient } from "./trpc/client";

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  timestamp: number;
  connectionId?: string;
}

/** 添加一条查询（去重：与最近一条相同则只更新时间戳） */
export async function addQuery(sql: string, connectionId?: string): Promise<void> {
  const trimmed = sql.trim();
  if (!trimmed) return;

  const trpc = getTrpcClient();
  await trpc.queryHistory.add.mutate({ sql: trimmed, connectionId });
}

/** 搜索历史：按 SQL 内容关键词、可选时间范围过滤 */
export async function searchHistory(options?: {
  keyword?: string;
  since?: number;
  until?: number;
}): Promise<QueryHistoryEntry[]> {
  const trpc = getTrpcClient();
  const result = await trpc.queryHistory.search.query({
    keyword: options?.keyword,
    since: options?.since,
    until: options?.until,
  });
  return Array.isArray(result) ? result : [];
}

/** 删除单条 */
export async function deleteEntry(id: string): Promise<void> {
  const trpc = getTrpcClient();
  await trpc.queryHistory.delete.mutate({ id });
}

/** 清空全部 */
export async function clearHistory(): Promise<void> {
  const trpc = getTrpcClient();
  await trpc.queryHistory.clear.mutate({});
}
