/**
 * DB Player 订阅 API
 * GitHub OAuth 登录 + 订阅校验
 * 适配阿里云 FC Custom Container，监听 9000 端口
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { pool, query, queryOne } from "./db";
import { signJwt, verifyJwt } from "./auth";

const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
// API 自身地址，用于 GitHub 回调 URL（FC 部署时为 FC 的 HTTP 触发器地址）
const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "9000"}`;

/** 从 Authorization 头解析 JWT */
async function getAuthUser(c: { req: { header: (k: string) => string | undefined } }) {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return verifyJwt(auth.slice(7));
}

// ========== 健康检查 ==========
app.get("/api/health", (c) => c.json({ ok: true }));

// ========== GitHub 登录 - 跳转授权 ==========
app.get("/api/auth/github", (c) => {
  const redirectUri = `${API_BASE_URL.replace(/\/$/, "")}/api/auth/github/callback`;
  const state = crypto.randomUUID();
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=${state}`;
  return c.redirect(url);
});

// ========== GitHub 回调（需由前端代理到后端，或直接用后端 URL） ==========
// 实际部署时，GitHub 回调 URL 应指向 FC 的 HTTP 触发器地址
app.get("/api/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code) {
    return c.json({ success: false, error: "缺少 code" }, 400);
  }

  try {
    // 用 code 换 access_token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (tokenData.error || !tokenData.access_token) {
      console.error("[github] token error:", tokenData);
      return c.json({ success: false, error: "GitHub 授权失败" }, 400);
    }

    // 获取用户信息
    const userRes = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const ghUser = (await userRes.json()) as {
      id: number;
      login: string;
      email?: string;
      name?: string;
      avatar_url?: string;
    };

    if (ghUser.id == null) {
      return c.json({ success: false, error: "获取用户信息失败" }, 400);
    }

    const provider = "github";
    const providerUserId = String(ghUser.id);

    // 查是否已有身份
    let identity = await queryOne<{ user_id: number }>(
      "SELECT user_id FROM user_identities WHERE provider = $1 AND provider_user_id = $2",
      [provider, providerUserId]
    );

    let userId: number;

    if (identity) {
      userId = identity.user_id;
    } else {
      // 新建用户
      const insertUser = await pool.query(
        "INSERT INTO users (email, name, avatar_url) VALUES ($1, $2, $3) RETURNING id",
        [ghUser.email ?? null, ghUser.name ?? ghUser.login, ghUser.avatar_url ?? null]
      );
      userId = insertUser.rows[0].id;
      await pool.query(
        "INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)",
        [userId, provider, providerUserId]
      );
    }

    const token = await signJwt({
      userId,
      email: (await queryOne<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]))
        ?.email ?? "",
    });

    // 重定向到前端，带上 token
    const redirect = `${FRONTEND_URL}${FRONTEND_URL.endsWith("/") ? "" : "/"}?token=${token}`;
    return c.redirect(redirect);
  } catch (e) {
    console.error("[github callback]", e);
    return c.json({ success: false, error: "登录失败" }, 500);
  }
});

// ========== 订阅状态（需登录） ==========
app.get("/api/subscription", async (c) => {
  const user = await getAuthUser(c);
  if (!user) {
    return c.json({ success: false, error: "未登录" }, 401);
  }

  const sub = await queryOne<{ plan: string; status: string; expires_at: Date | null }>(
    `SELECT plan, status, expires_at FROM subscriptions
     WHERE user_id = $1 AND status = 'active'
     ORDER BY expires_at DESC NULLS LAST
     LIMIT 1`,
    [user.userId]
  );

  let active = false;
  let plan = "free";
  let expiresAt: number | null = null;

  if (sub) {
    plan = sub.plan;
    expiresAt = sub.expires_at ? Math.floor(sub.expires_at.getTime() / 1000) : null;
    active = !expiresAt || expiresAt > Math.floor(Date.now() / 1000);
  }

  return c.json({
    success: true,
    subscription: { active, plan, expiresAt },
  });
});

const port = parseInt(process.env.PORT ?? "9000", 10);
console.log(`[subscription-api] listening on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
