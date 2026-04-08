import { TokenStorage } from "./token-storage";

export class LicenseValidator {
  constructor(
    private readonly tokenStorage: TokenStorage,
    /** 允许在设置变更后读到新地址（无需重载窗口时尽量在 validate 前 invalidateCache） */
    private readonly getApiBase: () => string
  ) {}

  async validate(): Promise<{ valid: boolean; expiresAt: number | null }> {
    const token = await this.tokenStorage.getToken();
    if (!token) return { valid: false, expiresAt: null };

    const apiBase = this.getApiBase().replace(/\/$/, "");

    try {
      const res = await fetch(`${apiBase}/api/verify-license`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { valid: false, expiresAt: null };

      const data = await res.json() as { valid: boolean; expiresAt?: number | null };
      return { valid: data.valid === true, expiresAt: data.expiresAt ?? null };
    } catch {
      return { valid: false, expiresAt: null };
    }
  }

  invalidateCache(): void {
    /* 已无本地缓存，保留方法供调用方兼容 */
  }
}
