import { TokenStorage } from "./token-storage";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时

interface CacheEntry {
  result: { valid: boolean; expiresAt: number | null };
  cachedAt: number;
}

export class LicenseValidator {
  private cache: CacheEntry | null = null;

  constructor(
    private readonly tokenStorage: TokenStorage,
    /** 允许在设置变更后读到新地址（无需重载窗口时尽量在 validate 前 invalidateCache） */
    private readonly getApiBase: () => string
  ) {}

  async validate(): Promise<{ valid: boolean; expiresAt: number | null }> {
    // 无 JWT 时直接返回无效
    const token = await this.tokenStorage.getToken();
    if (!token) return { valid: false, expiresAt: null };

    // 缓存有效时直接返回
    if (this.cache && Date.now() - this.cache.cachedAt < CACHE_TTL_MS) {
      return this.cache.result;
    }

    const apiBase = this.getApiBase().replace(/\/$/, "");

    try {
      const res = await fetch(`${apiBase}/api/verify-license`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.cache = null;
        return { valid: false, expiresAt: null };
      }
      const data = await res.json() as { valid: boolean; expiresAt?: number | null };
      const result = { valid: data.valid === true, expiresAt: data.expiresAt ?? null };
      if (result.valid) {
        this.cache = { result, cachedAt: Date.now() };
      } else {
        this.cache = null;
      }
      return result;
    } catch {
      this.cache = null;
      return { valid: false, expiresAt: null };
    }
  }

  invalidateCache(): void {
    this.cache = null;
  }
}
