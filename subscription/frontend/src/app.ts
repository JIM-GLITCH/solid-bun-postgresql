import { getApiUrl } from "./config";

const TOKEN_KEY = "dbplayer_token";
const VSCODE_SOURCE_KEY = "dbplayer_source";

const $ = (id: string) => document.getElementById(id)!;
const $btnLogin = $("btn-login");
const $btnLogout = $("btn-logout");
const $btnSubscribe = $("btn-subscribe");
const $btnSubscribeYearly = $("btn-subscribe-yearly");
const $userInfo = $("user-info");
const $subscriptionStatus = $("subscription-status");
const $statusContent = $("status-content");

function getToken(): string | null {
  const params = new URLSearchParams(location.search);
  const token = params.get("token") || localStorage.getItem(TOKEN_KEY);
  if (params.get("token") && token) {
    localStorage.setItem(TOKEN_KEY, token);
    history.replaceState({}, "", location.pathname);
  }
  return token;
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

// ─── 任务 3.1：source=vscode 检测 ────────────────────────────────────────────

function detectVscodeSource(): void {
  const params = new URLSearchParams(location.search);
  const source = params.get("source");
  if (source === "vscode") {
    sessionStorage.setItem(VSCODE_SOURCE_KEY, "vscode");
    // 清除 URL 中的 source 参数
    params.delete("source");
    const newSearch = params.toString();
    const newUrl = location.pathname + (newSearch ? "?" + newSearch : "");
    history.replaceState({}, "", newUrl);
  }
}

function isVscodeSource(): boolean {
  return sessionStorage.getItem(VSCODE_SOURCE_KEY) === "vscode";
}

// ─── 任务 3.2：URI Scheme 跳转函数 ───────────────────────────────────────────

function redirectToVscode(token: string): void {
  window.location.href = `vscode://lilr.db-player/auth?token=${encodeURIComponent(token)}`;
}

// ─── 初始化 ───────────────────────────────────────────────────────────────────

function init(): void {
  // 先检测 source 参数（在 getToken 清理 URL 之前）
  detectVscodeSource();

  const token = getToken();
  if (token) {
    $btnLogin.classList.add("hidden");
    $btnLogout.classList.remove("hidden");
    fetchSubscription(token);

    // 任务 3.3：已登录且 source=vscode 时展示"返回 VSCode"按钮
    if (isVscodeSource()) {
      const $btnBackVscode = document.getElementById("btn-back-vscode");
      if ($btnBackVscode) {
        $btnBackVscode.classList.remove("hidden");
        $btnBackVscode.addEventListener("click", () => {
          redirectToVscode(getToken()!);
        });
      }
    }
  } else {
    $btnLogin.classList.remove("hidden");
    $btnLogout.classList.add("hidden");
    $subscriptionStatus.classList.add("hidden");
  }
}

$btnLogin.addEventListener("click", () => {
  const apiUrl = getApiUrl();
  const sourceParam = isVscodeSource() ? "?source=vscode" : "";
  window.location.href = `${apiUrl}/api/auth/github${sourceParam}`;
});

$btnLogout.addEventListener("click", () => {
  clearToken();
  location.reload();
});

interface SubscriptionRes {
  success: boolean;
  subscription?: { active: boolean; plan: string; expiresAt: number | null };
}

interface PaymentRes {
  success: boolean;
  method?: "alipay" | "wxpay";
  payUrl?: string;
  codeUrl?: string;
  orderNo?: string;
  error?: string;
}

interface OrderStatusRes {
  success: boolean;
  status?: string;
}

async function fetchSubscription(token: string): Promise<void> {
  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json()) as SubscriptionRes;

    if (data.success && data.subscription) {
      const sub = data.subscription;
      $subscriptionStatus.classList.remove("hidden");
      $statusContent.innerHTML = sub.active
        ? `<p class="active">✓ 已订阅 (${sub.plan})${sub.expiresAt ? " · 到期: " + formatDate(sub.expiresAt) : ""}</p>`
        : `<p class="inactive">未订阅或已过期</p>`;

      const isActive = sub.active;
      ($btnSubscribe as HTMLButtonElement).disabled = isActive;
      ($btnSubscribeYearly as HTMLButtonElement).disabled = isActive;
      $btnSubscribe.textContent = isActive ? "已订阅" : "月付 ¥29";
      $btnSubscribeYearly.textContent = isActive ? "已订阅" : "年付 ¥199";
    }
  } catch (e) {
    console.error("fetch subscription:", e);
    $userInfo.textContent = "获取订阅状态失败";
  }
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp * 1000).toLocaleDateString("zh-CN");
}

// ─── 微信支付二维码弹窗 ───────────────────────────────────────────────────────

function showWxQrModal(codeUrl: string, orderNo: string, token: string): void {
  // 动态加载 qrcode 库（CDN）
  const existing = document.getElementById("wx-qr-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "wx-qr-modal";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;
    align-items:center;justify-content:center;z-index:9999;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:32px;text-align:center;min-width:280px;">
      <h3 style="margin:0 0 16px;color:#333;">微信扫码支付</h3>
      <div id="wx-qr-canvas"></div>
      <p style="margin:16px 0 8px;color:#666;font-size:13px;">请使用微信扫描二维码完成支付</p>
      <p id="wx-qr-status" style="color:#999;font-size:12px;">等待支付...</p>
      <button id="wx-qr-close" style="margin-top:12px;padding:6px 20px;cursor:pointer;">关闭</button>
    </div>
  `;
  document.body.appendChild(modal);

  // 用 qrcode.js 生成二维码
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js";
  script.onload = () => {
    (window as any).QRCode.toCanvas(
      document.getElementById("wx-qr-canvas"),
      codeUrl,
      { width: 200 },
      (err: any) => { if (err) console.error(err); }
    );
  };
  document.head.appendChild(script);

  document.getElementById("wx-qr-close")!.addEventListener("click", () => {
    modal.remove();
    clearInterval(pollTimer);
  });

  // 轮询订单状态
  const apiUrl = getApiUrl();
  let pollTimer = setInterval(async () => {
    try {
      const r = await fetch(`${apiUrl}/api/payment/order/${orderNo}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const d = (await r.json()) as OrderStatusRes;
      if (d.success && d.status === "paid") {
        clearInterval(pollTimer);
        document.getElementById("wx-qr-status")!.textContent = "支付成功！";
        document.getElementById("wx-qr-status")!.style.color = "#07c160";
        // 任务 3.3：微信支付成功后，若 source=vscode 则触发 URI Scheme 跳转
        setTimeout(() => {
          if (isVscodeSource() && token) {
            modal.remove();
            redirectToVscode(token);
          } else {
            modal.remove();
            fetchSubscription(token);
          }
        }, 1500);
      }
    } catch { /* ignore */ }
  }, 3000);
}

// ─── 发起支付 ─────────────────────────────────────────────────────────────────

async function handleSubscribe(plan: "monthly" | "yearly", method: "alipay" | "wxpay"): Promise<void> {
  const token = getToken();
  if (!token) {
    const sourceParam = isVscodeSource() ? "?source=vscode" : "";
    window.location.href = `${getApiUrl()}/api/auth/github${sourceParam}`;
    return;
  }

  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/payment/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan, method }),
    });
    const data = (await res.json()) as PaymentRes;
    if (!data.success) {
      alert(data.error ?? "创建订单失败");
      return;
    }
    if (data.method === "alipay" && data.payUrl) {
      window.location.href = data.payUrl;
    } else if (data.method === "wxpay" && data.codeUrl && data.orderNo) {
      showWxQrModal(data.codeUrl, data.orderNo, token);
    }
  } catch (e) {
    console.error("payment:", e);
    alert("网络错误，请稍后重试");
  }
}

// ─── 支付方式选择弹窗 ─────────────────────────────────────────────────────────

function showPaymentMethodPicker(plan: "monthly" | "yearly"): void {
  const existing = document.getElementById("pay-method-modal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "pay-method-modal";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;
    align-items:center;justify-content:center;z-index:9999;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;padding:32px;text-align:center;min-width:260px;">
      <h3 style="margin:0 0 20px;color:#333;">选择支付方式</h3>
      <div style="display:flex;gap:16px;justify-content:center;">
        <button id="pay-alipay" style="padding:10px 24px;cursor:pointer;border-radius:8px;border:1px solid #1677ff;color:#1677ff;background:#fff;font-size:14px;">支付宝</button>
        <button id="pay-wxpay" style="padding:10px 24px;cursor:pointer;border-radius:8px;border:1px solid #07c160;color:#07c160;background:#fff;font-size:14px;">微信支付</button>
      </div>
      <button id="pay-cancel" style="margin-top:16px;padding:6px 20px;cursor:pointer;border:none;background:none;color:#999;">取消</button>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById("pay-alipay")!.addEventListener("click", () => {
    modal.remove();
    handleSubscribe(plan, "alipay");
  });
  document.getElementById("pay-wxpay")!.addEventListener("click", () => {
    modal.remove();
    handleSubscribe(plan, "wxpay");
  });
  document.getElementById("pay-cancel")!.addEventListener("click", () => modal.remove());
}

$btnSubscribe.addEventListener("click", () => showPaymentMethodPicker("monthly"));
$btnSubscribeYearly.addEventListener("click", () => showPaymentMethodPicker("yearly"));

init();
