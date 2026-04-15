/**
 * 支付模块：支付宝 + 微信支付
 *
 * 凭证按 ALIPAY_SANDBOX 分流（勿混用）：
 * - true → ALIPAY_SANDBOX_* + 沙箱网关 openapi-sandbox.dl.alipaydev.com
 * - 否则 → ALIPAY_* + alipay-sdk 默认正式网关 openapi.alipay.com
 *
 * 若在开放平台开启「接口内容加密（AES）」：必须配置 Base64 AES 密钥，否则网关报 missing-encrypt-key。
 * 主变量：ALIPAY_SANDBOX_AES_KEY（沙箱）/ ALIPAY_AES_KEY（正式）；另可读 ALIPAY_*_ENCRYPT_KEY 等同义名。
 */

import { AlipaySdk } from "alipay-sdk";
import { pool } from "./db";

// ─── 套餐定义 ─────────────────────────────────────────────────────────────────

export const PLANS: Record<string, { label: string; amount: number; days: number }> = {
  monthly: { label: "月付订阅", amount: 1000, days: 30 }, // 单位：分
  yearly: { label: "年付订阅", amount: 5000, days: 365 },
};

// ─── 生成订单号 ───────────────────────────────────────────────────────────────

export function genOrderNo(): string {
  return `DBP${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// ─── 支付宝（电脑网站支付 alipay.trade.page.pay）─────────────────────────────

let alipayCached: AlipaySdk | null | undefined;
let alipayStartupLogged = false;

function normalizeKeyMaterial(raw: string): string {
  return raw.replace(/^\uFEFF/, "").trim().replace(/\\n/g, "\n");
}

/** 去掉 BOM、首尾引号、内部空白；避免 .env 里带引号或复制进空格导致 invalid-app-id */
function cleanAlipayAppId(raw: string | undefined): string {
  if (raw == null) return "";
  let s = raw.replace(/^\uFEFF/, "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.replace(/\s+/g, "");
}

/** 开放平台沙箱网关（与文档一致；正式环境不传 gateway，避免 undefined 覆盖 SDK 默认） */
const ALIPAY_GATEWAY_SANDBOX = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

function isAlipaySandbox(): boolean {
  const v = (process.env.ALIPAY_SANDBOX ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** 接口内容加密 AES 密钥（Base64，与开放平台「接口内容加密」页一致）；未配置则不下发 needEncrypt */
function readAlipayContentAesKey(sandbox: boolean): string | undefined {
  const candidates = sandbox
    ? [
        process.env.ALIPAY_SANDBOX_AES_KEY,
        process.env.ALIPAY_SANDBOX_ENCRYPT_KEY,
        process.env.ALIPAY_SANDBOX_CONTENT_AES_KEY,
      ]
    : [process.env.ALIPAY_AES_KEY, process.env.ALIPAY_ENCRYPT_KEY, process.env.ALIPAY_CONTENT_AES_KEY];
  for (const raw of candidates) {
    const s = normalizeKeyMaterial(raw ?? "");
    if (s) return s;
  }
  return undefined;
}

function readAlipayCredentials(sandbox: boolean): {
  appId: string;
  privateKeyRaw: string;
  publicKeyRaw: string;
} | null {
  if (sandbox) {
    const appId = cleanAlipayAppId(process.env.ALIPAY_SANDBOX_APP_ID);
    const privateKeyRaw = process.env.ALIPAY_SANDBOX_PRIVATE_KEY?.trim() ?? "";
    const publicKeyRaw = process.env.ALIPAY_SANDBOX_PUBLIC_KEY?.trim() ?? "";
    if (!appId || !privateKeyRaw || !publicKeyRaw) return null;
    return { appId, privateKeyRaw, publicKeyRaw };
  }
  const appId = cleanAlipayAppId(process.env.ALIPAY_APP_ID);
  const privateKeyRaw = process.env.ALIPAY_PRIVATE_KEY?.trim() ?? "";
  const publicKeyRaw = process.env.ALIPAY_PUBLIC_KEY?.trim() ?? "";
  if (!appId || !privateKeyRaw || !publicKeyRaw) return null;
  return { appId, privateKeyRaw, publicKeyRaw };
}

/** 沙箱/正式 或 AES 密钥变化时须重建 SDK */
let cacheAlipaySdkSig: string | undefined;

function tryCreateAlipaySdk(): AlipaySdk | null {
  const sandbox = isAlipaySandbox();
  const contentAesKey = readAlipayContentAesKey(sandbox);
  const sig = `${sandbox}|${contentAesKey ?? ""}`;
  if (cacheAlipaySdkSig !== sig) {
    alipayCached = undefined;
    cacheAlipaySdkSig = sig;
    alipayStartupLogged = false;
  }
  if (alipayCached !== undefined) return alipayCached;

  const creds = readAlipayCredentials(sandbox);
  if (!creds) {
    alipayCached = null;
    return null;
  }

  const { appId, privateKeyRaw, publicKeyRaw } = creds;
  const privateKey = normalizeKeyMaterial(privateKeyRaw);
  const alipayPublicKey = normalizeKeyMaterial(publicKeyRaw);
  const keyType: "PKCS1" | "PKCS8" = privateKey.includes("BEGIN RSA PRIVATE KEY") ? "PKCS1" : "PKCS8";

  const sdk = new AlipaySdk({
    appId,
    privateKey,
    alipayPublicKey,
    signType: "RSA2",
    ...(sandbox ? { gateway: ALIPAY_GATEWAY_SANDBOX } : {}),
    ...(contentAesKey ? { encryptKey: contentAesKey } : {}),
    keyType,
  });

  if (!alipayStartupLogged) {
    alipayStartupLogged = true;
    const mode = sandbox ? "沙箱" : "正式";
    const gw = sandbox ? ALIPAY_GATEWAY_SANDBOX : "https://openapi.alipay.com/gateway.do";
    const idOk = /^\d{10,20}$/.test(appId);
    const enc = contentAesKey ? " | 接口内容加密 AES=已配置" : "";
    console.info(
      `[alipay] ${mode} | gateway=${gw} | appId 长度=${appId.length}${idOk ? "" : "（异常：一般为 16 位数字 PID，请检查是否含多余字符）"} | 前缀=${appId.slice(0, 4)}… | 凭证=${sandbox ? "ALIPAY_SANDBOX_*" : "ALIPAY_*"}${enc}`
    );
    if (!contentAesKey) {
      console.warn(
        `[alipay] 未检测到内容加密 AES 密钥（${sandbox ? "ALIPAY_SANDBOX_AES_KEY 等" : "ALIPAY_AES_KEY 等"}）。若开放平台已开启「接口内容加密」，请求会报 missing-encrypt-key；请在 .env 填入控制台 Base64 密钥并重新部署。`
      );
    }
  }

  alipayCached = sdk;
  return sdk;
}

function getAlipaySdk(): AlipaySdk {
  const sdk = tryCreateAlipaySdk();
  if (!sdk) {
    const hint = isAlipaySandbox()
      ? "沙箱模式请设置 ALIPAY_SANDBOX_APP_ID、ALIPAY_SANDBOX_PRIVATE_KEY、ALIPAY_SANDBOX_PUBLIC_KEY"
      : "正式模式请设置 ALIPAY_APP_ID、ALIPAY_PRIVATE_KEY、ALIPAY_PUBLIC_KEY";
    throw new Error(`支付宝支付未配置：${hint}`);
  }
  return sdk;
}

/** 供验签使用：未配置时不抛错，直接验签失败 */
function getAlipaySdkOptional(): AlipaySdk | null {
  return tryCreateAlipaySdk();
}

export async function createAlipayOrder(
  orderNo: string,
  plan: string,
  notifyUrl: string,
  returnUrl: string
): Promise<string> {
  const alipay = getAlipaySdk();
  const p = PLANS[plan];
  if (!p) throw new Error("无效套餐");

  const totalAmount = (p.amount / 100).toFixed(2);
  const useWap =
    process.env.ALIPAY_USE_WAP_PAY === "1" ||
    process.env.ALIPAY_USE_WAP_PAY === "true" ||
    process.env.ALIPAY_USE_WAP_PAY === "yes";

  const bizBase = {
    outTradeNo: orderNo,
    totalAmount,
    subject: p.label,
    body: p.label,
  };

  const needEncrypt = !!readAlipayContentAesKey(isAlipaySandbox());
  const encryptOpt = needEncrypt ? ({ needEncrypt: true } as const) : {};

  const payUrl = useWap
    ? alipay.pageExec("alipay.trade.wap.pay", "GET", {
        notifyUrl,
        returnUrl,
        ...encryptOpt,
        bizContent: {
          ...bizBase,
          productCode: "QUICK_WAP_WAY",
          quitUrl: returnUrl,
        },
      })
    : alipay.pageExec("alipay.trade.page.pay", "GET", {
        notifyUrl,
        returnUrl,
        ...encryptOpt,
        bizContent: {
          ...bizBase,
          productCode: "FAST_INSTANT_TRADE_PAY",
        },
      });

  if (!payUrl.startsWith("http")) {
    throw new Error(`支付宝下单返回异常（非跳转 URL）：${payUrl.slice(0, 240)}`);
  }
  return payUrl;
}

export function verifyAlipayNotify(params: Record<string, unknown>): boolean {
  const sdk = getAlipaySdkOptional();
  if (!sdk) return false;

  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null || k === "") continue;
    flat[k] = typeof v === "string" ? v : String(v);
  }
  try {
    return sdk.checkNotifySignV2(flat);
  } catch {
    return false;
  }
}

// ─── 创建微信 Native 支付二维码（暂未启用） ──────────────────────────────────

export async function createWxpayOrder(
  _orderNo: string,
  _plan: string,
  _notifyUrl: string
): Promise<string> {
  throw new Error("微信支付暂未配置");
}

// ─── 验证微信回调签名（暂未启用） ────────────────────────────────────────────

export async function verifyWxpayNotify(
  _headers: Record<string, string>,
  _body: string
): Promise<{ tradeNo: string; orderNo: string; success: boolean } | null> {
  return null;
}

// ─── 订单完成后激活订阅 ───────────────────────────────────────────────────────

export async function activateSubscription(
  orderNo: string,
  tradeNo: string,
  paymentMethod: "alipay" | "wxpay"
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const orderRes = await client.query(
      `SELECT id, user_id, plan, status FROM payment_orders WHERE order_no = $1 FOR UPDATE`,
      [orderNo]
    );
    const order = orderRes.rows[0];
    if (!order || order.status === "paid") {
      await client.query("ROLLBACK");
      return;
    }

    const plan = PLANS[order.plan];
    if (!plan) throw new Error("无效套餐");

    const expiresAt = new Date(Date.now() + plan.days * 86400 * 1000);

    await client.query(
      `UPDATE payment_orders SET status='paid', payment_trade_no=$1, payment_method=$2, paid_at=NOW(), updated_at=NOW() WHERE order_no=$3`,
      [tradeNo, paymentMethod, orderNo]
    );

    const subRes = await client.query(
      `SELECT id, expires_at FROM subscriptions WHERE user_id=$1 AND status='active' ORDER BY expires_at DESC NULLS LAST LIMIT 1`,
      [order.user_id]
    );
    const existing = subRes.rows[0];

    if (existing) {
      const base =
        existing.expires_at && new Date(existing.expires_at) > new Date()
          ? new Date(existing.expires_at)
          : new Date();
      const newExpiry = new Date(base.getTime() + plan.days * 86400 * 1000);
      await client.query(`UPDATE subscriptions SET expires_at=$1, plan=$2, updated_at=NOW() WHERE id=$3`, [
        newExpiry,
        order.plan,
        existing.id,
      ]);
    } else {
      await client.query(
        `INSERT INTO subscriptions (user_id, plan, status, expires_at) VALUES ($1,$2,'active',$3)`,
        [order.user_id, order.plan, expiresAt]
      );
    }

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
