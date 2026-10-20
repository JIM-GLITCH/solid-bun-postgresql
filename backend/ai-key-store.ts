/**
 * AI Key 本地加密存储（Web 端持久化）
 * 存储路径：与 connections 同目录下的 ai-keys.json
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { encrypt, decrypt, getCredentialStoreBaseDir, atomicWriteJson } from "./crypto-store";

interface StoredAiKeyItem {
  keyRef: string;
  enc: string;
}

function getStorePath(): string {
  return join(getCredentialStoreBaseDir(), "ai-keys.json");
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
  atomicWriteJson(getStorePath(), list);
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

