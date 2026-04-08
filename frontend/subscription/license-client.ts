/**
 * 浏览器侧调用订阅服务 GET /api/verify-license（与 VS Code LicenseValidator 行为一致，带短时缓存）
 */

const CACHE_TTL_MS = 60 * 60 * 1000;

type CacheEntry = {
  token: string;
  valid: boolean;
  expiresAt: number | null;
  cachedAt: number;
};

let cache: CacheEntry | null = null;

export function invalidateLicenseCache(): void {
  cache = null;
}

export async function verifyLicenseRemote(
  apiBase: string,
  token: string | null
): Promise<{ valid: boolean; expiresAt: number | null }> {
  if (!token) {
    cache = null;
    return { valid: false, expiresAt: null };
  }

  if (cache && cache.token === token && Date.now() - cache.cachedAt < CACHE_TTL_MS) {
    return { valid: cache.valid, expiresAt: cache.expiresAt };
  }

  const base = apiBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/verify-license`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      cache = { token, valid: false, expiresAt: null, cachedAt: Date.now() };
      return { valid: false, expiresAt: null };
    }
    const data = (await res.json()) as { valid?: boolean; expiresAt?: number | null };
    const valid = data.valid === true;
    const expiresAt = data.expiresAt ?? null;
    if (valid) {
      cache = { token, valid, expiresAt, cachedAt: Date.now() };
    } else {
      cache = { token, valid: false, expiresAt: null, cachedAt: Date.now() };
    }
    return { valid, expiresAt };
  } catch {
    cache = null;
    return { valid: false, expiresAt: null };
  }
}
