/**
 * 本地凭据加密：共享密钥管理 + AES-256-GCM 加解密。
 *
 * 背景见 docs/code-review-findings.md #12：
 * - connections / ai-keys / subscription-token 三个 store 曾各自独立读写同一个 `.key`，
 *   并发首次初始化时会互相覆盖对方密钥，导致已有密文永久无法解密。现统一收口到本模块。
 * - `.key` 写入采用「临时文件 + rename」原子替换，防止进程崩溃留下截断的密钥文件。
 * - 生产环境建议通过 `CONNECTIONS_ENCRYPTION_KEY`（64 位 hex）由外部注入密钥——
 *   密钥与密文同目录对能读取该目录的攻击者不构成防护，这是本地单机工具的固有约束。
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const ALG = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

/** 凭据存储数据目录（与各 store 的落盘目录保持一致） */
export function getCredentialStoreBaseDir(): string {
  return (
    process.env.CONNECTIONS_STORE_DIR ||
    (typeof process !== "undefined" && (process as any).platform === "win32"
      ? join(process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd(), "db-client")
      : join(process.env.HOME || "/tmp", ".db-client"))
  );
}

export function getKeyFilePath(): string {
  return join(getCredentialStoreBaseDir(), ".key");
}

let cachedKey: Buffer | null = null;

/** 原子写：先写同目录临时文件再 rename，避免崩溃/断电留下截断的密钥 */
function atomicWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, content, { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * 取进程级加密密钥：
 * 1. `CONNECTIONS_ENCRYPTION_KEY` 环境变量（64 位 hex）优先；
 * 2. 其次内存缓存 / 数据目录 `.key` 文件（全进程唯一入口，杜绝多模块互相覆盖）；
 * 3. 都没有则生成新密钥并原子落盘。
 */
export function getOrDeriveKey(): Buffer {
  const envKey = process.env.CONNECTIONS_ENCRYPTION_KEY;
  if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
    return Buffer.from(envKey, "hex");
  }
  if (cachedKey) return cachedKey;

  const keyPath = getKeyFilePath();
  if (existsSync(keyPath)) {
    const hex = readFileSync(keyPath, "utf8").trim();
    if (/^[0-9a-fA-F]{64}$/.test(hex)) {
      cachedKey = Buffer.from(hex, "hex");
      return cachedKey;
    }
    // 密钥文件损坏：备份原文件后重新生成（旧密文将无法解密，但服务不会永远崩溃）
    console.error(`[crypto-store] .key 文件损坏，已备份并重新生成：${keyPath}`);
    try {
      renameSync(keyPath, `${keyPath}.corrupt-${Date.now()}`);
    } catch {
      /* 备份失败也继续：重新生成 */
    }
  }

  const key = randomBytes(KEY_LEN);
  atomicWriteFile(keyPath, key.toString("hex"));
  cachedKey = key;
  return key;
}

export function encrypt(plaintext: string): string {
  const key = getOrDeriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decrypt(encrypted: string): string {
  const key = getOrDeriveKey();
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const data = buf.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * 原子写 JSON：先写同目录临时文件再 rename（同文件系统内 rename 是原子的），
 * 避免进程崩溃/断电留下截断文件，导致下次 loadRaw 解析失败被误判为空列表、进而清空全部数据。
 */
export function atomicWriteJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}
