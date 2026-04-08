/**
 * /api/verify-license 内存缓存：同一 JWT 在短时间内重复校验时跳过 JWT 解析与 DB 查询。
 * 环境变量 VERIFY_LICENSE_CACHE_TTL_SEC=0 可关闭。
 */

import { createHash } from "node:crypto";

export type CachedVerifyLicense = { valid: boolean; expiresAt: number | null };

const store = new Map<string, { value: CachedVerifyLicense; until: number }>();

function ttlMs(): number {
  const sec = parseInt(process.env.VERIFY_LICENSE_CACHE_TTL_SEC ?? "60", 10);
  if (!Number.isFinite(sec) || sec < 0) return 60_000;
  if (sec === 0) return 0;
  return sec * 1000;
}

function maxEntries(): number {
  const n = parseInt(process.env.VERIFY_LICENSE_CACHE_MAX ?? "20000", 10);
  return Number.isFinite(n) && n >= 500 ? n : 20_000;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function prune(now: number): void {
  const cap = maxEntries();
  for (const [k, v] of store) {
    if (v.until <= now) store.delete(k);
  }
  while (store.size > cap) {
    const first = store.keys().next().value as string | undefined;
    if (first === undefined) break;
    store.delete(first);
  }
}

export function getCachedVerifyLicense(token: string): CachedVerifyLicense | undefined {
  const ms = ttlMs();
  if (ms <= 0) return undefined;
  const now = Date.now();
  prune(now);
  const row = store.get(hashToken(token));
  if (!row || row.until <= now) return undefined;
  return row.value;
}

export function setCachedVerifyLicense(token: string, value: CachedVerifyLicense): void {
  const ms = ttlMs();
  if (ms <= 0) return;
  const now = Date.now();
  prune(now);
  store.set(hashToken(token), { value, until: now + ms });
}
