/**
 * AI Key 本地加密存储（Web 端持久化）
 * 存储路径：与 connections 同目录下的 ai-keys.json
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

interface StoredAiKeyItem {
  keyRef: string;
  enc: string;
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
  return join(getBaseDir(), "ai-keys.json");
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

function loadRaw(): StoredAiKeyItem[] {
  const path = getStorePath();
  if (!existsSync(path)) return [];
  try {
    const raw = readFileSync(path, "utf8");
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((item) => item as Partial<StoredAiKeyItem>)
      .filter((item) => typeof item.keyRef === "string" && typeof item.enc === "string")
      .map((item) => ({ keyRef: String(item.keyRef), enc: String(item.enc) }));
  } catch {
    return [];
  }
}

function saveRaw(list: StoredAiKeyItem[]): void {
  const path = getStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(list, null, 2), { mode: 0o600 });
}

export function setAiKey(keyRef: string, apiKey: string): void {
  const ref = keyRef.trim();
  if (!ref || !apiKey.trim()) return;
  const list = loadRaw();
  const idx = list.findIndex((x) => x.keyRef === ref);
  const item: StoredAiKeyItem = { keyRef: ref, enc: encrypt(apiKey.trim()) };
  if (idx >= 0) list[idx] = item;
  else list.push(item);
  saveRaw(list);
}

export function getAiKey(keyRef: string): string | undefined {
  const ref = keyRef.trim();
  if (!ref) return undefined;
  const item = loadRaw().find((x) => x.keyRef === ref);
  if (!item) return undefined;
  try {
    return decrypt(item.enc);
  } catch {
    return undefined;
  }
}

export function deleteAiKey(keyRef: string): void {
  const ref = keyRef.trim();
  if (!ref) return;
  const list = loadRaw().filter((x) => x.keyRef !== ref);
  saveRaw(list);
}

