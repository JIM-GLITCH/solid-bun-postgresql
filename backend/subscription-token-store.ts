/**
 * Standalone 订阅 Token 本地加密存储（单 token）
 * 存储路径：与 connections 同目录下的 subscription-token.json
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

interface StoredTokenFile {
  enc: string;
  updatedAt: number;
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
  return join(getBaseDir(), "subscription-token.json");
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

export function setStoredSubscriptionToken(token: string): void {
  const t = token.trim();
  if (!t) return;
  const path = getStorePath();
  const payload: StoredTokenFile = {
    enc: encrypt(t),
    updatedAt: Date.now(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(payload, null, 2), { mode: 0o600 });
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
