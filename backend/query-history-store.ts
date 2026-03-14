/**
 * 查询历史持久化存储 - 文件系统
 * 存储路径：与 connections 同目录下的 query-history.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX_ENTRIES = 500;

export interface QueryHistoryEntry {
  id: string;
  sql: string;
  timestamp: number;
  connectionId?: string;
}

function getBaseDir(): string {
  return (
    process.env.CONNECTIONS_STORE_DIR ||
    (typeof process !== "undefined" && (process as any).platform === "win32"
      ? join(process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd(), "db-client")
      : join(process.env.HOME || "/tmp", ".db-client"))
  );
}

function getStorePath(): string {
  return join(getBaseDir(), "query-history.json");
}

function loadRaw(): QueryHistoryEntry[] {
  const path = getStorePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveRaw(list: QueryHistoryEntry[]): void {
  const path = getStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2), { mode: 0o600 });
}

/** 添加一条查询（去重：与最近一条相同则只更新时间戳） */
export function addQuery(sql: string, connectionId?: string): void {
  const trimmed = sql.trim();
  if (!trimmed) return;

  let entries = loadRaw();

  if (entries.length > 0 && entries[0].sql === trimmed) {
    entries[0] = { ...entries[0], timestamp: Date.now(), connectionId };
  } else {
    const newEntry: QueryHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      sql: trimmed,
      timestamp: Date.now(),
      connectionId,
    };
    entries = [newEntry, ...entries].slice(0, MAX_ENTRIES);
  }

  saveRaw(entries);
}

/** 搜索历史：按 SQL 内容关键词、可选时间范围过滤 */
export function searchHistory(options?: {
  keyword?: string;
  since?: number;
  until?: number;
}): QueryHistoryEntry[] {
  let entries = loadRaw();

  if (options?.keyword?.trim()) {
    const kw = options.keyword.trim().toLowerCase();
    entries = entries.filter((e) => e.sql.toLowerCase().includes(kw));
  }

  if (options?.since != null) {
    entries = entries.filter((e) => e.timestamp >= options.since!);
  }

  if (options?.until != null) {
    entries = entries.filter((e) => e.timestamp <= options.until!);
  }

  return entries;
}

/** 删除单条 */
export function deleteEntry(id: string): void {
  const entries = loadRaw().filter((e) => e.id !== id);
  saveRaw(entries);
}

/** 清空全部 */
export function clearHistory(): void {
  saveRaw([]);
}
