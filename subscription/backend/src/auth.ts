/**
 * 认证工具：JWT
 */

import * as jose from "jose";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
const JWT_ISSUER = "db-player";
const JWT_AUDIENCE = "db-player-api";

export async function signJwt(payload: { userId: number; email: string | null }): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<{ userId: number; email: string | null } | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jose.jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    const rawId = payload.userId;
    const userId =
      typeof rawId === "number" && Number.isFinite(rawId)
        ? Math.trunc(rawId)
        : typeof rawId === "string" && /^\d+$/.test(rawId)
          ? parseInt(rawId, 10)
          : NaN;
    const email = (payload.email as string | null) ?? null;
    if (!Number.isFinite(userId) || userId < 1) return null;
    return { userId, email };
  } catch {
    return null;
  }
}
