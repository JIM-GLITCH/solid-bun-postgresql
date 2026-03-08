/**
 * 数据库连接持久化存储，使用 AES-GCM 加密敏感数据
 * 密码等敏感信息加密后存入 localStorage
 */

import type { PostgresLoginParams } from "../shared/src";

const STORAGE_KEY = "db-connections-v1";
const KEY_STORAGE = "db-keystore-v1";

export interface StoredConnection {
  id: string;
  label: string;
  enc: string; // base64(iv + ciphertext + tag)
}

function getCrypto(): SubtleCrypto | null {
  if (typeof crypto !== "undefined" && crypto.subtle) return crypto.subtle;
  return null;
}

function getOrCreateKey(): Promise<CryptoKey> {
  const subtle = getCrypto();
  if (!subtle) throw new Error("当前环境不支持加密，请在 HTTPS 或 localhost 下使用");
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(KEY_STORAGE) : null;
  if (stored) {
    const keyBytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    return subtle.importKey("raw", keyBytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  return subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]).then(async (key) => {
    const exported = await subtle.exportKey("raw", key);
    const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY_STORAGE, b64);
    return key;
  });
}

async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const subtle = getCrypto();
  if (!subtle) throw new Error("当前环境不支持加密");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(key: CryptoKey, encrypted: string): Promise<string> {
  const subtle = getCrypto();
  if (!subtle) throw new Error("当前环境不支持加密");
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

function makeLabel(params: PostgresLoginParams): string {
  return `${params.username}@${params.host}:${params.port}/${params.database}`;
}

/** 加载已保存的连接列表（仅元数据，不含密码） */
export function loadStoredConnections(): StoredConnection[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as StoredConnection[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 解密并获取完整连接参数 */
export async function decryptConnection(stored: StoredConnection): Promise<PostgresLoginParams & { id: string }> {
  const key = await getOrCreateKey();
  const json = await decrypt(key, stored.enc);
  const params = JSON.parse(json) as PostgresLoginParams;
  return { ...params, id: stored.id };
}

/** 加密并保存连接 */
export async function saveConnection(id: string, params: PostgresLoginParams): Promise<void> {
  const key = await getOrCreateKey();
  const enc = await encrypt(key, JSON.stringify(params));
  const label = makeLabel(params);
  const list = loadStoredConnections();
  const idx = list.findIndex((c) => c.id === id);
  const item: StoredConnection = { id, label, enc };
  if (idx >= 0) {
    list[idx] = item;
  } else {
    list.push(item);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
}

/** 从存储中移除连接 */
export function removeStoredConnection(id: string): void {
  const list = loadStoredConnections().filter((c) => c.id !== id);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
}
