/**
 * 服务端数据库连接持久化存储，使用 AES-GCM 加密
 * 存储路径：进程数据目录/connections.json
 *
 * 数据结构：Connection[] 扁平列表
 */

import { readFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { StoredConnectionParams, DbKind } from "../shared/src";
import { encrypt, decrypt, getCredentialStoreBaseDir, atomicWriteJson } from "./crypto-store";

export interface StoredConnectionMeta {
  id: string;
  label: string;
  enc: string;
  name?: string;
  /** 侧栏分组展示用（可选） */
  group?: string;
}

interface StoredConnectionItem {
  id: string;
  label: string;
  enc: string;
  name?: string;
  group?: string;
}

export type ConnectionList = StoredConnectionItem[];

function getStorePath(): string {
  return join(getCredentialStoreBaseDir(), "connections.json");
}

function makeLabel(params: StoredConnectionParams): string {
  return `${params.username}@${params.host}:${params.port}/${params.database}`;
}

function normalizeStoredParams(params: StoredConnectionParams): StoredConnectionParams {
  const dbType: DbKind = params.dbType ?? "postgres";
  return { ...params, dbType };
}

function normalizeItem(raw: unknown): StoredConnectionItem | null {
  const o = raw as Record<string, unknown>;
  if (!o?.id || !o?.label || !o?.enc) return null;
  const item: StoredConnectionItem = {
    id: String(o.id),
    label: String(o.label),
    enc: String(o.enc),
  };
  if (o.name != null && o.name !== "") item.name = String(o.name);
  if (o.group != null && String(o.group).trim() !== "") item.group = String(o.group).trim();
  return item;
}

/** 加载并迁移旧格式（含分组）到扁平列表 */
function loadRaw(): ConnectionList {
  const path = getStorePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];

    const result: StoredConnectionItem[] = [];
    for (const node of arr) {
      const o = node as Record<string, unknown>;
      // 旧格式分组节点：展开其中的连接
      if (Array.isArray(o?.connections) && typeof o?.group === "string") {
        const grp = String(o.group).trim();
        for (const c of o.connections as unknown[]) {
          const item = normalizeItem(c);
          if (item) {
            if (grp) item.group = grp;
            result.push(item);
          }
        }
      } else {
        const item = normalizeItem(node);
        if (item) result.push(item);
      }
    }
    return result;
  } catch {
    // 文件损坏：先备份，再返回空列表，避免 saveRaw 以空列表覆盖、静默清空所有已保存连接
    try {
      const p = getStorePath();
      if (existsSync(p)) renameSync(p, `${p}.corrupt-${Date.now()}`);
    } catch {
      /* 备份失败也继续：返回空列表 */
    }
    return [];
  }
}

function saveRaw(list: ConnectionList): void {
  atomicWriteJson(getStorePath(), list);
}

/** 获取已保存连接列表 */
export function listConnections(): ConnectionList {
  return loadRaw();
}

/** 保存连接（加密存储） */
export function saveConnection(
  id: string,
  params: StoredConnectionParams,
  meta?: { name?: string; group?: string }
): void {
  const enc = encrypt(JSON.stringify(normalizeStoredParams(params)));
  const list = loadRaw();
  const idx = list.findIndex((c) => c.id === id);
  const prev = idx !== -1 ? list[idx] : undefined;
  const name =
    meta?.name !== undefined ? meta.name.trim() || undefined : prev?.name;
  const group =
    meta?.group !== undefined ? meta.group.trim() || undefined : prev?.group;
  const label = name || makeLabel(params);
  const item: StoredConnectionItem = {
    id,
    label,
    enc,
    ...(name ? { name } : {}),
    ...(group ? { group } : {}),
  };
  if (idx !== -1) {
    list[idx] = item;
  } else {
    list.push(item);
  }
  saveRaw(list);
}

/** 仅更新连接的显示名称 */
export function updateConnectionMeta(id: string, meta: { name?: string }): void {
  const list = loadRaw();
  const idx = list.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const item = list[idx];
  if (meta.name !== undefined) {
    const newName = meta.name.trim() || undefined;
    item.name = newName;
    if (newName) {
      item.label = newName;
    } else {
      // 仅在清空名称时尝试从密文还原 label；解密失败（密钥轮换/文件损坏）不应抛出，避免调用方 500
      try {
        item.label = makeLabel(JSON.parse(decrypt(item.enc)) as StoredConnectionParams);
      } catch {
        /* 保留现有 label */
      }
    }
  }
  saveRaw(list);
}

/** 删除已保存连接 */
export function removeConnection(id: string): void {
  const list = loadRaw();
  const idx = list.findIndex((c) => c.id === id);
  if (idx !== -1) {
    list.splice(idx, 1);
    saveRaw(list);
  }
}

/** 原子性替换整个连接列表（用于拖拽排序） */
export function reorderConnections(rawList: unknown[]): void {
  const list: ConnectionList = (rawList as unknown[])
    .map(normalizeItem)
    .filter((x): x is StoredConnectionItem => x !== null);
  saveRaw(list);
}

/** 解密并返回连接参数（供服务端连接使用，不暴露给前端） */
export function getConnectionParams(id: string): (StoredConnectionParams & { id: string }) | null {
  const list = loadRaw();
  const item = list.find((c) => c.id === id);
  if (!item) return null;
  try {
    const parsed = JSON.parse(decrypt(item.enc)) as StoredConnectionParams;
    return { ...normalizeStoredParams(parsed), id: item.id };
  } catch {
    return null;
  }
}
