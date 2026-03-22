/**
 * 支付模块：支付宝 + 微信支付
 * TODO: 支付功能暂时禁用，待配置支付凭证后启用
 */

import { pool } from "./db";

// ─── 套餐定义 ─────────────────────────────────────────────────────────────────

export const PLANS: Record<string, { label: string; amount: number; days: number }> = {
  monthly: { label: "月付订阅", amount: 2900, days: 30 },   // 单位：分
  yearly:  { label: "年付订阅", amount: 19900, days: 365 },
};

// ─── 生成订单号 ───────────────────────────────────────────────────────────────

export function genOrderNo(): string {
  return `DBP${Date.now()}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

// ─── 创建支付宝手机网站支付链接（暂未启用） ──────────────────────────────────

export async function createAlipayOrder(
  _orderNo: string,
  _plan: string,
  _notifyUrl: string,
  _returnUrl: string
): Promise<string> {
  throw new Error("支付宝支付暂未配置");
}

// ─── 创建微信 Native 支付二维码（暂未启用） ──────────────────────────────────

export async function createWxpayOrder(
  _orderNo: string,
  _plan: string,
  _notifyUrl: string
): Promise<string> {
  throw new Error("微信支付暂未配置");
}

// ─── 验证支付宝回调签名（暂未启用） ──────────────────────────────────────────

export function verifyAlipayNotify(_params: Record<string, string>): boolean {
  return false;
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
      const base = existing.expires_at && new Date(existing.expires_at) > new Date()
        ? new Date(existing.expires_at)
        : new Date();
      const newExpiry = new Date(base.getTime() + plan.days * 86400 * 1000);
      await client.query(
        `UPDATE subscriptions SET expires_at=$1, plan=$2, updated_at=NOW() WHERE id=$3`,
        [newExpiry, order.plan, existing.id]
      );
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
