/**
 * Standalone Web：订阅 JWT 写入本地后端加密存储（单 token）
 */
import type { Hono } from "hono";
import {
  clearStoredSubscriptionToken,
  setStoredSubscriptionToken,
} from "../backend/subscription-token-store";

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function registerDbPlayerSubscriptionRoutes(app: Hono): void {
  app.get("/api/dbplayer/subscription-callback", (c) => {
    const token = c.req.query("token")?.trim() ?? "";
    if (!JWT_RE.test(token)) {
      return c.redirect("/", 302);
    }
    setStoredSubscriptionToken(token);
    return c.redirect("/", 302);
  });

  app.post("/api/dbplayer/subscription-token", async (c) => {
    let body: { token?: string };
    try {
      body = (await c.req.json()) as { token?: string };
    } catch {
      return c.json({ ok: false, error: "invalid json" }, 400);
    }
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!JWT_RE.test(token)) {
      return c.json({ ok: false, error: "invalid token" }, 400);
    }
    setStoredSubscriptionToken(token);
    return c.json({ ok: true });
  });

  app.post("/api/dbplayer/subscription-logout", (c) => {
    clearStoredSubscriptionToken();
    return c.json({ ok: true });
  });
}
