/**
 * DB Player 订阅 API
 * GitHub OAuth 登录 + 订阅校验
 * 适配阿里云 FC Custom Container，监听 9000 端口
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { pool, queryOne } from "./db";
import { signJwt, verifyJwt } from "./auth";
import { handle } from 'hono-alibaba-cloud-fc3-adapter';
import {
  PLANS,
  genOrderNo,
  createAlipayOrder,
  createWxpayOrder,
  verifyAlipayNotify,
  verifyWxpayNotify,
  activateSubscription,
} from "./payment";

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID ?? "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET ?? "";
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
// API 自身地址，用于 GitHub 回调 URL（FC 部署时为 FC 的 HTTP 触发器地址）
const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? "9000"}`;

const frontOrigin = FRONTEND_URL.replace(/\/$/, "");
/** 与网关/自定义域名上已配置的 ACAO 不要重复：此处禁止使用 *，只回显白名单内的 Origin */
const CORS_ORIGIN_ALLOWLIST = new Set(
  (process.env.CORS_ORIGINS?.trim()
    ? process.env.CORS_ORIGINS.split(",")
    : [
        frontOrigin,
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "https://dbplayer.top",
        "https://www.dbplayer.top",
      ]
  )
    .map((s) => s.trim())
    .filter(Boolean)
);

/** 将异常转为可给前端展示的字段（便于调试；生产可设 API_DEBUG=0 去掉堆栈） */
function publicError(e: unknown): { error: string; detail: string } {
  const includeStack = process.env.API_DEBUG !== "0";
  if (e instanceof Error) {
    const pg = e as { code?: string; detail?: string; hint?: string };
    const bits = [e.message];
    if (pg.code) bits.push(`pg_code=${pg.code}`);
    if (pg.detail) bits.push(`pg_detail=${pg.detail}`);
    if (pg.hint) bits.push(`hint=${pg.hint}`);
    const head = bits.filter(Boolean).join(" | ");
    const detail = includeStack && e.stack ? `${head}\n---\n${e.stack}` : head;
    return { error: e.message || "内部错误", detail };
  }
  const s = String(e);
  return { error: s, detail: s };
}

const app = new Hono();

app.onError((err, c) => {
  console.error("[onError]", err);
  const { error, detail } = publicError(err);
  return c.json({ success: false, error, detail }, 500);
});

// 自定义域名/全站加速若已配置跨域响应头，不可再套一层，否则浏览器会看到两个 ACAO（例如 https://x, https://x）
const gatewayHandlesCors = process.env.GATEWAY_HANDLES_CORS === "1";
if (!gatewayHandlesCors) {
  app.use(
    "*",
    cors({
      origin: (origin) => (origin && CORS_ORIGIN_ALLOWLIST.has(origin) ? origin : null),
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization"],
    })
  );
} else {
  // 预检必须是 2xx。网关把 OPTIONS 转给 FC 时，若无处理会 404，浏览器报「does not have HTTP ok status」
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS") {
      return c.body(null, 204);
    }
    await next();
  });
}

/** 解析 Bearer 令牌（大小写不敏感；兼容仅传 token 不带 Bearer 的少数客户端） */
function parseBearerToken(c: { req: { header: (k: string) => string | undefined } }): string | null {
  const auth =
    c.req.header("Authorization") ??
    c.req.header("authorization") ??
    c.req.header("AUTHORIZATION");
  if (auth == null || !auth.trim()) return null;
  const m = /^Bearer\s+(\S+)/i.exec(auth.trim());
  if (m?.[1]) return m[1].trim();
  // 若整段看起来像 JWT（无空格），当作裸 token
  if (/^[\w-]+\.[\w-]+\.[\w-]+$/.test(auth.trim())) return auth.trim();
  return null;
}

type AuthResult =
  | { ok: true; user: { userId: number; email: string | null } }
  | { ok: false; hadBearerToken: boolean };

async function authorize(c: { req: { header: (k: string) => string | undefined } }): Promise<AuthResult> {
  const token = parseBearerToken(c);
  if (!token) return { ok: false, hadBearerToken: false };
  const user = await verifyJwt(token);
  if (!user) return { ok: false, hadBearerToken: true };
  return { ok: true, user };
}

function unauthorizedJson(c: { json: (b: object, s: number) => Response }, hadToken: boolean) {
  return c.json(
    {
      success: false,
      error: hadToken ? "登录已失效或 token 无法通过校验，请重新登录" : "未登录（缺少 Authorization: Bearer）",
      reason: hadToken ? "invalid_token" : "missing_token",
      hint: hadToken
        ? "常见于 JWT_SECRET 与登录签发时不一致、token 过期或曾被篡改"
        : "请先从本站完成 GitHub 登录，或直接请求时不要漏掉 Authorization 头",
    },
    401
  );
}

// ========== 健康检查 ==========
app.get("/api/health", (c) => c.json({ ok: true }));

// ========== GitHub 登录 - 跳转授权 ==========
app.get("/api/auth/github", (c) => {
  const redirectUri = `${API_BASE_URL.replace(/\/$/, "")}/api/auth/github/callback`;
  const source = c.req.query("source");
  const statePayload: { nonce: string; source?: string } = { nonce: crypto.randomUUID() };
  if (source !== undefined) statePayload.source = source;
  const state = btoa(JSON.stringify(statePayload));
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email&state=${state}`;
  return c.redirect(url);
});

// ========== GitHub 回调（需由前端代理到后端，或直接用后端 URL） ==========
// 实际部署时，GitHub 回调 URL 应指向 FC 的 HTTP 触发器地址
app.get("/api/auth/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  let source: string | undefined;
  try {
    const parsed = JSON.parse(atob(state ?? ""));
    source = parsed.source;
  } catch {
    source = undefined;
  }
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
      return c.json({
        success: false,
        error: "GitHub 授权失败",
        detail: JSON.stringify(tokenData),
      }, 400);
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

    // 如果没有公开邮箱，调 /user/emails 拿主邮箱
    let email = ghUser.email ?? null;
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const emails = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
      const primaryEmail = emails.find((e) => e.primary && e.verified);
      email = primaryEmail?.email ?? null;
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
        [email, ghUser.name ?? ghUser.login, ghUser.avatar_url ?? null]
      );
      userId = insertUser.rows[0].id;
      await pool.query(
        "INSERT INTO user_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)",
        [userId, provider, providerUserId]
      );
    }

    const token = await signJwt({
      userId,
      email: email ?? (await queryOne<{ email: string }>("SELECT email FROM users WHERE id = $1", [userId]))?.email ?? null,
    });

    // callback 用 HTML meta refresh 跳转，避免 FC 拦截外部 302
    const baseRedirect = `${FRONTEND_URL}${FRONTEND_URL.endsWith("/") ? "" : "/"}?token=${token}`;
    const redirectUrl = source ? `${baseRedirect}&source=${encodeURIComponent(source)}` : baseRedirect;
    return c.html(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${redirectUrl}"></head><body>登录成功，跳转中...</body></html>`);
  } catch (e) {
    console.error("[github callback]", e);
    const { error, detail } = publicError(e);
    return c.json({ success: false, error: `登录失败: ${error}`, detail }, 500);
  }
});

// ========== 订阅状态（需登录） ==========
app.get("/api/subscription", async (c) => {
  const auth = await authorize(c);
  if (!auth.ok) return unauthorizedJson(c, auth.hadBearerToken);
  const { user } = auth;

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

// ========== 创建支付订单 ==========
app.post("/api/payment/create", async (c) => {
  const auth = await authorize(c);
  if (!auth.ok) return unauthorizedJson(c, auth.hadBearerToken);
  const { user } = auth;

  let body: { plan: string; method: "alipay" | "wxpay" };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "请求体须为 JSON" }, 400);
  }
  const { plan, method } = body ?? {};
  if (!PLANS[plan]) return c.json({ success: false, error: "无效套餐" }, 400);
  if (method !== "alipay" && method !== "wxpay") return c.json({ success: false, error: "无效支付方式" }, 400);

  const orderNo = genOrderNo();
  const p = PLANS[plan];
  const notifyBase = (process.env.API_BASE_URL ?? API_BASE_URL).replace(/\/$/, "");

  try {
    if (method === "alipay") {
      const returnUrl = `${FRONTEND_URL.replace(/\/$/, "")}/`;
      const payUrl = await createAlipayOrder(orderNo, plan, `${notifyBase}/api/payment/alipay/notify`, returnUrl);
      await pool.query(
        `INSERT INTO payment_orders (order_no, user_id, plan, amount, status) VALUES ($1,$2,$3,$4,'pending')`,
        [orderNo, user.userId, plan, p.amount]
      );
      return c.json({ success: true, method: "alipay", payUrl, orderNo });
    }
    const codeUrl = await createWxpayOrder(orderNo, plan, `${notifyBase}/api/payment/wxpay/notify`);
    await pool.query(
      `INSERT INTO payment_orders (order_no, user_id, plan, amount, status) VALUES ($1,$2,$3,$4,'pending')`,
      [orderNo, user.userId, plan, p.amount]
    );
    return c.json({ success: true, method: "wxpay", codeUrl, orderNo });
  } catch (e: unknown) {
    console.error("[payment/create]", e);
    const { error, detail } = publicError(e);
    // 业务/依赖异常（支付宝、DB 等），用 500；原 503 易与网关「服务不可用」混淆
    return c.json({ success: false, error, detail }, 500);
  }
});

// ========== 支付宝异步回调 ==========
app.post("/api/payment/alipay/notify", async (c) => {
  const body = await c.req.parseBody() as Record<string, string>;
  if (!verifyAlipayNotify(body)) {
    return c.text("fail");
  }
  if (body.trade_status === "TRADE_SUCCESS" || body.trade_status === "TRADE_FINISHED") {
    try {
      await activateSubscription(body.out_trade_no, body.trade_no, "alipay");
    } catch (e) {
      console.error("[alipay/notify]", e);
      return c.text("fail");
    }
  }
  return c.text("success");
});

// ========== 微信支付异步回调 ==========
app.post("/api/payment/wxpay/notify", async (c) => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(c.req.header())) {
    if (v) headers[k.toLowerCase()] = v;
  }
  const rawBody = await c.req.text();
  const result = await verifyWxpayNotify(headers, rawBody);
  if (!result) {
    return c.json({ code: "FAIL", message: "验签失败" }, 400);
  }
  try {
    await activateSubscription(result.orderNo, result.tradeNo, "wxpay");
  } catch (e) {
    console.error("[wxpay/notify]", e);
    return c.json({ code: "FAIL", message: "处理失败" }, 500);
  }
  return c.json({ code: "SUCCESS" });
});

// ========== 查询订单状态（前端轮询用） ==========
app.get("/api/payment/order/:orderNo", async (c) => {
  const auth = await authorize(c);
  if (!auth.ok) return unauthorizedJson(c, auth.hadBearerToken);
  const { user } = auth;

  const orderNo = c.req.param("orderNo");
  const row = await queryOne<{ status: string; plan: string }>(
    `SELECT status, plan FROM payment_orders WHERE order_no=$1 AND user_id=$2`,
    [orderNo, user.userId]
  );
  if (!row) return c.json({ success: false, error: "订单不存在" }, 404);
  return c.json({ success: true, status: row.status, plan: row.plan });
});

// ========== VSCode 订阅校验（轻量，无需完整订阅信息） ==========
app.get("/api/verify-license", async (c) => {
  const auth = await authorize(c);
  if (!auth.ok) {
    return c.json(
      {
        valid: false,
        reason: auth.hadBearerToken ? "invalid_token" : "missing_token",
      },
      401
    );
  }
  const { user } = auth;

  const sub = await queryOne<{ expires_at: Date | null }>(
    `SELECT expires_at FROM subscriptions WHERE user_id=$1 AND status='active' ORDER BY expires_at DESC NULLS LAST LIMIT 1`,
    [user.userId]
  );

  if (!sub) return c.json({ valid: false });
  const expiresAt = sub.expires_at ? Math.floor(sub.expires_at.getTime() / 1000) : null;
  const valid = !expiresAt || expiresAt > Math.floor(Date.now() / 1000);
  return c.json({ valid, expiresAt });
});



app.post("/", async  (c)=>{
  return c.json("fuck you")
})

export const handler = handle(app)