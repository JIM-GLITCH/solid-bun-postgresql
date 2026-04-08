/** 订阅 API 根地址（勿以 / 结尾）；Vite 下可用 VITE_SUBSCRIPTION_API_URL */

export function getSubscriptionApiBaseFromEnv(): string {
  try {
    const v = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SUBSCRIPTION_API_URL;
    if (typeof v === "string" && v.trim()) return v.trim().replace(/\/$/, "");
  } catch {
    /* 非 Vite 打包 */
  }
  return "https://api.dbplayer.top";
}

/** 自托管等场景跳过订阅校验（VITE_SUBSCRIPTION_OFF=true|1） */
export function isSubscriptionCheckDisabled(): boolean {
  try {
    const v = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SUBSCRIPTION_OFF;
    return v === "true" || v === "1";
  } catch {
    return false;
  }
}
