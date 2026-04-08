/**
 * 业务进程侧订阅校验：请求订阅服务 GET /api/verify-license（与前端原 license-client 一致）
 */

import { getStoredSubscriptionToken } from "./subscription-token-store";

export class SubscriptionRequiredError extends Error {
  override readonly name = "SubscriptionRequiredError";
  readonly subscriptionRequired = true as const;
  constructor(
    message = "需要有效订阅：请先在订阅站登录并获取 Token，或粘贴到扩展/本地存储。自托管可设 SUBSCRIPTION_OFF=1。"
  ) {
    super(message);
  }
}

export function isSubscriptionCheckDisabled(): boolean {
  for (const raw of [process.env.SUBSCRIPTION_OFF, process.env.DBPLAYER_SUBSCRIPTION_OFF]) {
    const v = (raw ?? "").trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes") return true;
  }
  return false;
}

export function getSubscriptionApiBaseFromEnv(): string {
  const v = (process.env.SUBSCRIPTION_API_URL ?? "").trim();
  return (v || "https://api.dbplayer.top").replace(/\/$/, "");
}

export function parseBearerToken(req: Request): string | null {
  const h = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (h?.startsWith("Bearer ")) {
    const t = h.slice(7).trim();
    return t || null;
  }
  return null;
}

/** Web 业务 API：优先 Authorization，否则 fallback 到 standalone 本地后端加密存储 */
export function parseSubscriptionAccessToken(req: Request): string | null {
  return parseBearerToken(req) ?? getStoredSubscriptionToken();
}

/** EventSource 无法带 Header 时用 query（仅用于 GET /api/events） */
export function parseAccessTokenQuery(req: Request): string | null {
  const url = new URL(req.url);
  const q =
    url.searchParams.get("access_token")?.trim() ||
    url.searchParams.get("bearer")?.trim() ||
    "";
  return q || null;
}

async function verifyRemote(apiBase: string, token: string): Promise<boolean> {
  const base = apiBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/verify-license`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { valid?: boolean };
    return data.valid === true;
  } catch {
    return false;
  }
}

/**
 * @param token JWT 或 null
 * @param apiBaseOverride 不传则用 SUBSCRIPTION_API_URL / 默认线上
 */
export async function assertSubscriptionLicensed(
  token: string | null | undefined,
  apiBaseOverride?: string
): Promise<void> {
  if (isSubscriptionCheckDisabled()) return;
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) throw new SubscriptionRequiredError();
  const base = (apiBaseOverride ?? getSubscriptionApiBaseFromEnv()).replace(/\/$/, "");
  const valid = await verifyRemote(base, t);
  if (!valid) throw new SubscriptionRequiredError();
}
