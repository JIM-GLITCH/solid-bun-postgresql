/**
 * Standalone 订阅 Token 本地加密存储（单 token）
 * 存储路径：与 connections 同目录下的 subscription-token.json
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { encrypt, decrypt, getCredentialStoreBaseDir, atomicWriteJson } from "./crypto-store";

interface StoredTokenFile {
  enc: string;
  updatedAt: number;
}

function getStorePath(): string {
  return join(getCredentialStoreBaseDir(), "subscription-token.json");
}

export function setStoredSubscriptionToken(token: string): void {
  const t = token.trim();
  if (!t) return;
  const path = getStorePath();
  const payload: StoredTokenFile = {
    enc: encrypt(t),
    updatedAt: Date.now(),
  };
  atomicWriteJson(path, payload);
}

export function getStoredSubscriptionToken(): string | null {
  const path = getStorePath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredTokenFile>;
    if (!parsed?.enc || typeof parsed.enc !== "string") return null;
    const token = decrypt(parsed.enc).trim();
    return token || null;
  } catch {
    return null;
  }
}

export function clearStoredSubscriptionToken(): void {
  const path = getStorePath();
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}
