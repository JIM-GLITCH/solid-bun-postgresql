/**
 * 服务端数据库连接持久化存储，使用 AES-GCM 加密
 * 存储路径：进程数据目录/connections.json
 *
 * 数据结构：ConnectionList = (Connection | Group)[]
 * - Connection: 未分组的连接，顶层
 * - Group: { group: string; connections: Connection[] } 分组
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PostgresLoginParams } from "../shared/src";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

export interface StoredConnectionMeta {
  id: string;
  label: string;
  enc: string;
  name?: string;
  group?: string;
}

/** 单条连接（存储用，不含 group，group 由父级 Group 表示） */
interface StoredConnectionItem {
  id: string;
  label: string;
  enc: string;
  name?: string;
}

/** 分组：group 名称 + 连接列表 */
export interface StoredConnectionGroup {
  group: string;
  connections: StoredConnectionItem[];
}

/** 存储结构：顶层连接 + 分组 */
export type ConnectionList = (StoredConnectionItem | StoredConnectionGroup)[];

function getStorePath(): string {
  const base =
    process.env.CONNECTIONS_STORE_DIR ||
    (typeof process !== "undefined" && (process as any).platform === "win32"
      ? join(process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd(), "db-client")
      : join(process.env.HOME || "/tmp", ".db-client"));
  return join(base, "connections.json");
}

function getOrDeriveKey(): Buffer {
  const envKey = process.env.CONNECTIONS_ENCRYPTION_KEY;
  if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, "hex");
  }
  const storePath = getStorePath();
  const keyPath = join(dirname(storePath), ".key");
  if (existsSync(keyPath)) {
    return Buffer.from(readFileSync(keyPath, "utf8"), "hex");
  }
  const key = randomBytes(KEY_LEN);
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  return key;
}

function encrypt(plaintext: string): string {
  const key = getOrDeriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decrypt(encrypted: string): string {
  const key = getOrDeriveKey();
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

function makeLabel(params: PostgresLoginParams): string {
  return `${params.username}@${params.host}:${params.port}/${params.database}`;
}

function normalizeItem(raw: unknown): StoredConnectionItem {
  const o = raw as Record<string, unknown>;
  const item: StoredConnectionItem = {
    id: String(o?.id ?? ""),
    label: String(o?.label ?? ""),
    enc: String(o?.enc ?? ""),
  };
  if (o?.name != null && o.name !== "") item.name = String(o.name);
  return item;
}

function isGroupNode(node: unknown): node is StoredConnectionGroup {
  const o = node as Record<string, unknown>;
  return o != null && Array.isArray(o.connections) && typeof o.group === "string";
}

/** 加载并迁移：旧格式(扁平+group) -> 新格式 ConnectionList */
function loadRaw(): ConnectionList {
  const path = getStorePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];

    const isNewFormat = arr.some((x: unknown) => isGroupNode(x));
    if (isNewFormat) {
      return arr
        .map((node: unknown) => {
          if (isGroupNode(node)) {
            return {
              group: node.group,
              connections: (node.connections || [])
                .map(normalizeItem)
                .filter((c) => c.id && c.label && c.enc),
            } as StoredConnectionGroup;
          }
          const c = normalizeItem(node);
          return c.id && c.label && c.enc ? c : null;
        })
        .filter((x): x is StoredConnectionItem | StoredConnectionGroup => x != null);
    }

    const groupMap = new Map<string, StoredConnectionItem[]>();
    const ungrouped: StoredConnectionItem[] = [];
    for (const raw of arr) {
      const o = raw as Record<string, unknown>;
      const item = normalizeItem(raw);
      if (!item.id || !item.label || !item.enc) continue;
      const g = o?.group != null && o.group !== "" ? String(o.group) : "";
      if (g) {
        if (!groupMap.has(g)) groupMap.set(g, []);
        groupMap.get(g)!.push(item);
      } else {
        ungrouped.push(item);
      }
    }
    const result: ConnectionList = [...ungrouped];
    for (const [group, connections] of groupMap.entries()) {
      if (connections.length > 0) result.push({ group, connections });
    }
    return result;
  } catch {
    return [];
  }
}

function saveRaw(list: ConnectionList): void {
  const path = getStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2), { mode: 0o600 });
}

function findInList(list: ConnectionList, id: string): { item: StoredConnectionItem; group?: string } | null {
  for (const node of list) {
    if (isGroupNode(node)) {
      const item = node.connections.find((c) => c.id === id);
      if (item) return { item, group: node.group };
    } else {
      if (node.id === id) return { item: node };
    }
  }
  return null;
}

/** 获取已保存连接列表（嵌套结构，供前端直接解析） */
export function listConnections(): ConnectionList {
  return loadRaw();
}

/** 保存连接（加密存储） */
export function saveConnection(
  id: string,
  params: PostgresLoginParams,
  meta?: { name?: string; group?: string }
): void {
  const enc = encrypt(JSON.stringify(params));
  const label = meta?.name?.trim() || makeLabel(params);
  const list = loadRaw();
  const item: StoredConnectionItem = {
    id,
    label,
    enc,
    ...(meta?.name?.trim() && { name: meta.name.trim() }),
  };
  const groupKey = meta?.group?.trim() || "";

  const found = findInList(list, id);
  if (found) {
    removeFromList(list, id);
  }
  addToList(list, item, groupKey);
  saveRaw(list);
}

function addToList(list: ConnectionList, item: StoredConnectionItem, groupKey: string): void {
  if (!groupKey) {
    list.push(item);
    return;
  }
  let g = list.find((n) => isGroupNode(n) && n.group === groupKey) as StoredConnectionGroup | undefined;
  if (!g) {
    g = { group: groupKey, connections: [] };
    list.push(g);
  }
  g.connections.push(item);
}

function removeFromList(list: ConnectionList, id: string): void {
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (isGroupNode(node)) {
      node.connections = node.connections.filter((c: StoredConnectionItem) => c.id !== id);
      return;
    }
    if ((node as StoredConnectionItem).id === id) {
      list.splice(i, 1);
      return;
    }
  }
}

/** 仅更新连接的显示名称和分组（不触及加密数据） */
export function updateConnectionMeta(id: string, meta: { name?: string; group?: string }): void {
  const list = loadRaw();
  const found = findInList(list, id);
  if (!found) return;
  removeFromList(list, id);
  const { item } = found;
  if (meta.name !== undefined) {
    item.label = meta.name.trim() || makeLabel(JSON.parse(decrypt(item.enc)) as PostgresLoginParams);
    item.name = meta.name.trim() || undefined;
  }
  const newGroup = meta.group !== undefined ? meta.group.trim() || "" : found.group || "";
  addToList(list, item, newGroup);
  saveRaw(list);
}

/** 删除已保存连接 */
export function removeConnection(id: string): void {
  const list = loadRaw();
  removeFromList(list, id);
  saveRaw(list);
}

/** 新建空分组 */
export function addEmptyGroup(groupName: string): void {
  const name = groupName?.trim();
  if (!name) return;
  const list = loadRaw();
  const exists = list.some((n) => isGroupNode(n) && n.group === name);
  if (exists) return;
  list.push({ group: name, connections: [] });
  saveRaw(list);
}

/** 解密并返回连接参数（供服务端连接使用，不暴露给前端） */
export function getConnectionParams(id: string): (PostgresLoginParams & { id: string }) | null {
  const found = findInList(loadRaw(), id);
  if (!found) return null;
  try {
    const params = JSON.parse(decrypt(found.item.enc)) as PostgresLoginParams;
    return { ...params, id: found.item.id };
  } catch {
    return null;
  }
}
