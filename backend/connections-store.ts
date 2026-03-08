/**
 * 服务端数据库连接持久化存储，使用 AES-GCM 加密
 * 存储路径：进程数据目录/connections.json
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PostgresLoginParams } from "../shared/src";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 32;

export interface StoredConnectionMeta {
  id: string;
  label: string;
  enc: string;
}

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

function loadRaw(): StoredConnectionMeta[] {
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

function saveRaw(list: StoredConnectionMeta[]): void {
  const path = getStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2), { mode: 0o600 });
}

/** 获取已保存连接列表（仅元数据） */
export function listConnections(): StoredConnectionMeta[] {
  return loadRaw();
}

/** 保存连接（加密存储） */
export function saveConnection(id: string, params: PostgresLoginParams): void {
  const enc = encrypt(JSON.stringify(params));
  const label = makeLabel(params);
  const list = loadRaw();
  const idx = list.findIndex((c) => c.id === id);
  const item: StoredConnectionMeta = { id, label, enc };
  if (idx >= 0) list[idx] = item;
  else list.push(item);
  saveRaw(list);
}

/** 删除已保存连接 */
export function removeConnection(id: string): void {
  saveRaw(loadRaw().filter((c) => c.id !== id));
}

/** 解密并返回连接参数（供服务端连接使用，不暴露给前端） */
export function getConnectionParams(id: string): (PostgresLoginParams & { id: string }) | null {
  const list = loadRaw();
  const item = list.find((c) => c.id === id);
  if (!item) return null;
  try {
    const params = JSON.parse(decrypt(item.enc)) as PostgresLoginParams;
    return { ...params, id: item.id };
  } catch {
    return null;
  }
}
