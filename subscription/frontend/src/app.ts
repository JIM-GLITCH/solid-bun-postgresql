import { getApiUrl } from "./config";

const TOKEN_KEY = "dbplayer_token";
const CLIENT_SOURCE_KEY = "dbplayer_client_source";
const HOST_LABEL_KEY = "dbplayer_host_label";
const STANDALONE_RETURN_KEY = "dbplayer_standalone_oauth_return";

const EXTENSION_AUTHORITY = "lilr.db-player";

/** 桌面扩展类 OAuth：自定义协议回跳（vscode / cursor / kiro / …） */
function isDesktopCustomProtocolSource(src: string): boolean {
  if (src === "standalone" || src === "webapp") return false;
  return /^[a-z][a-z0-9.-]*$/i.test(src);
}

const KNOWN_SCHEME_LABEL: Record<string, string> = {
  vscode: "VS Code",
  "vscode-insiders": "VS Code Insiders",
  cursor: "Cursor",
  kiro: "Kiro",
  vscodium: "VSCodium",
  "code-oss": "Code - OSS",
  windsurf: "Windsurf",
  trae: "Trae",
  "antigravity-ide": "Antigravity",
};

const $ = (id: string) => document.getElementById(id)!;
const $btnLogin = $("btn-login");
const $btnLogout = $("btn-logout");
const $btnBackVscode = $("btn-back-vscode");
const $btnSubscribe = $("btn-subscribe");
const $btnSubscribeYearly = $("btn-subscribe-yearly");
const $userInfo = $("user-info");
const $subscriptionStatus = $("subscription-status");
const $statusContent = $("status-content");

function getToken(): string | null {
  const params = new URLSearchParams(location.search);
  const raw = params.get("token") || localStorage.getItem(TOKEN_KEY);
  const token = raw?.trim() || null;
  if (params.get("token") && token) {
    localStorage.setItem(TOKEN_KEY, token);
    params.delete("token");
    const newSearch = params.toString();
    history.replaceState({}, "", location.pathname + (newSearch ? "?" + newSearch : "") + location.hash);
  }
  return token;
}

function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

/** 根据入口 URL ?source=&host= 区分各桌面宿主 / Standalone / 纯网页 */
function detectClientSource(): void {
  if (sessionStorage.getItem("dbplayer_source") === "vscode") {
    sessionStorage.setItem(CLIENT_SOURCE_KEY, "vscode");
    sessionStorage.removeItem("dbplayer_source");
  }

  const params = new URLSearchParams(location.search);
  const rawSource = params.get("source")?.trim();
  if (rawSource === "standalone" || rawSource === "webapp") {
    sessionStorage.setItem(CLIENT_SOURCE_KEY, rawSource);
  } else if (rawSource && isDesktopCustomProtocolSource(rawSource.toLowerCase())) {
    sessionStorage.setItem(CLIENT_SOURCE_KEY, rawSource.toLowerCase());
  }

  const hostLabel = params.get("host")?.trim();
  if (hostLabel) {
    sessionStorage.setItem(HOST_LABEL_KEY, hostLabel);
  }

  const ret = params.get("return");
  if (ret?.trim()) {
    try {
      const u = new URL(ret.trim());
      if (u.protocol === "http:" || u.protocol === "https:") {
        sessionStorage.setItem(STANDALONE_RETURN_KEY, ret.trim());
      }
    } catch {
      /* ignore */
    }
  }

  params.delete("source");
  params.delete("host");
  params.delete("return");
  const newSearch = params.toString();
  history.replaceState({}, "", location.pathname + (newSearch ? "?" + newSearch : "") + location.hash);
}

function getClientSource(): string {
  const v = sessionStorage.getItem(CLIENT_SOURCE_KEY)?.trim().toLowerCase();
  if (v === "standalone" || v === "webapp") return v;
  if (v && isDesktopCustomProtocolSource(v)) return v;
  return "webapp";
}

function getHostDisplayName(): string {
  const fromQuery = sessionStorage.getItem(HOST_LABEL_KEY)?.trim();
  if (fromQuery) return fromQuery;
  const src = getClientSource();
  if (KNOWN_SCHEME_LABEL[src]) return KNOWN_SCHEME_LABEL[src];
  if (src === "standalone") return "本地 DB Player";
  if (src === "webapp") return "浏览器";
  if (isDesktopCustomProtocolSource(src)) {
    return src.length ? src.charAt(0).toUpperCase() + src.slice(1) : "编辑器";
  }
  return "浏览器";
}

function githubOAuthStartUrl(): string {
  const apiUrl = getApiUrl();
  const src = getClientSource();
  const q = new URLSearchParams();
  q.set("source", src);
  if (src === "standalone") {
    // OAuth 完成后先回到订阅站（可看订阅状态/下单）；localhost 回跳地址只存在 sessionStorage，供「返回本地 DB Player」
    const stayOnPortal = new URL(window.location.pathname || "/", window.location.origin).toString();
    q.set("redirect", stayOnPortal);
  } else if (isDesktopCustomProtocolSource(src)) {
    q.set("redirect", `${src}://${EXTENSION_AUTHORITY}/auth`);
  }
  return `${apiUrl}/api/auth/github?${q.toString()}`;
}

function redirectToCustomProtocolAuth(token: string, scheme: string): void {
  const s = scheme.trim().toLowerCase();
  window.location.href = `${s}://${EXTENSION_AUTHORITY}/auth?token=${encodeURIComponent(token)}`;
}

function redirectToStandaloneApp(token: string): void {
  const base = sessionStorage.getItem(STANDALONE_RETURN_KEY)?.trim();
  if (!base) {
    alert(
      "未配置本地应用回跳地址。\n请从 DB Player 网页侧栏点「登录」进入订阅；\n或使用：?source=standalone&return=你的应用 /api/dbplayer/subscription-callback 完整 URL（需编码）。"
    );
    return;
  }
  const u = new URL(base);
  u.searchParams.set("token", token);
  window.location.href = u.toString();
}

function redirectToDesktopClient(token: string): void {
  const src = getClientSource();
  if (isDesktopCustomProtocolSource(src)) {
    redirectToCustomProtocolAuth(token, src);
    return;
  }
  if (src === "standalone") redirectToStandaloneApp(token);
}

function syncBackButtonVisibility(hasToken: boolean): void {
  if (!hasToken) {
    $btnBackVscode.classList.add("hidden");
    return;
  }
  const src = getClientSource();
  if (src === "webapp") {
    $btnBackVscode.classList.add("hidden");
    return;
  }
  $btnBackVscode.classList.remove("hidden");
  if (src === "standalone") {
    $btnBackVscode.textContent = "返回本地 DB Player";
    return;
  }
  if (isDesktopCustomProtocolSource(src)) {
    $btnBackVscode.textContent = `返回 ${getHostDisplayName()} 并授权`;
    return;
  }
  $btnBackVscode.textContent = "返回客户端并授权";
}

// ─── 初始化 ───────────────────────────────────────────────────────────────────

function init(): void {
  detectClientSource();

  const token = getToken();
  if (token) {
    $btnLogin.classList.add("hidden");
    $btnLogout.classList.remove("hidden");
    fetchSubscription(token);
    syncBackButtonVisibility(true);
  } else {
    $btnLogin.classList.remove("hidden");
    $btnLogout.classList.add("hidden");
    $btnBackVscode.classList.add("hidden");
    $subscriptionStatus.classList.add("hidden");
  }
}

$btnLogin.addEventListener("click", () => {
  window.location.href = githubOAuthStartUrl();
});

$btnLogout.addEventListener("click", () => {
  clearToken();
  location.reload();
});

$btnBackVscode.addEventListener("click", () => {
  const token = getToken();
  if (!token) {
    alert("请先登录，再返回客户端授权。");
    return;
  }
  redirectToDesktopClient(token);
});

interface SubscriptionRes {
  success: boolean;
  subscription?: { active: boolean; plan: string; expiresAt: number | null };
  error?: string;
  detail?: string;
  reason?: string;
  hint?: string;
}

interface PaymentRes {
  success: boolean;
  method?: "alipay" | "wxpay";
  payUrl?: string;
  codeUrl?: string;
  orderNo?: string;
  error?: string;
  detail?: string;
}

interface OrderStatusRes {
  success: boolean;
  status?: string;
  error?: string;
  detail?: string;
}

function formatApiErr(data: { error?: string; detail?: string; reason?: string; hint?: string }): string {
  return [data.error, data.reason, data.hint, data.detail].filter((x) => x && String(x).trim()).join("\n\n");
}

async function parseResJson<T>(res: Response): Promise<{ ok: true; data: T; rawText: string } | { ok: false; rawText: string }> {
  const rawText = await res.text();
  try {
    return { ok: true, data: JSON.parse(rawText) as T, rawText };
  } catch {
    return { ok: false, rawText };
  }
}

async function fetchSubscription(token: string): Promise<void> {
  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const parsed = await parseResJson<SubscriptionRes>(res);
    if (!parsed.ok) {
      console.error("[subscription] 非 JSON:", parsed.rawText);
      $userInfo.textContent = `订阅接口异常 HTTP ${res.status}（见控制台）`;
      return;
    }
    const data = parsed.data;
    if (!data.success) {
      console.error("[subscription]", formatApiErr(data));
      $userInfo.textContent = formatApiErr(data) || "获取订阅状态失败";
      return;
    }

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
        setTimeout(() => {
          const src = getClientSource();
          modal.remove();
          if (isDesktopCustomProtocolSource(src)) {
            redirectToDesktopClient(token);
          } else {
            // standalone：留在订阅站刷新订阅状态，由用户点「返回本地 DB Player」
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
    window.location.href = githubOAuthStartUrl();
    return;
  }

  const apiUrl = getApiUrl();
  try {
    const res = await fetch(`${apiUrl}/api/payment/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan, method }),
    });
    const parsed = await parseResJson<PaymentRes>(res);
    if (!parsed.ok) {
      alert(`HTTP ${res.status}\n\n${parsed.rawText.slice(0, 1200)}`);
      return;
    }
    const data = parsed.data;
    if (!data.success) {
      alert(formatApiErr(data) || "创建订单失败");
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
