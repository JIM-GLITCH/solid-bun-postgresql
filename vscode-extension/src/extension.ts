// 前端 Webview 使用 frontend 打包的 webview.js，后端使用 backend/api-handlers-vscode，通过 postMessage 通信
import * as vscode from "vscode";
import { createVscodeMessageHandler } from "../../backend/api-handlers-vscode.js";
import { assertSubscriptionLicensed } from "../../backend/subscription-license.js";
import { setAiKeyResolver } from "../../backend/api-core.js";
import { TokenStorage } from "./token-storage";
import { DbPlayerUriHandler } from "./uri-handler";
import { LicenseValidator } from "./license-validator";
import { buildSubscriptionPortalEntryUrl, getDesktopOAuthContext } from "./desktop-host";
let currentPanel: vscode.WebviewPanel | null = null;

const AI_SECRET_PREFIX = "dbplayer_ai_key_";

/** 设置 / 环境变量优先，默认线上 dbplayer */
function getSubscriptionConfig(): { apiBase: string; frontendUrl: string } {
  const cfg = vscode.workspace.getConfiguration("dbPlayer");
  const apiBase =
    cfg.get<string>("subscriptionApiUrl")?.trim() ||
    process.env.DBPLAYER_SUBSCRIPTION_API?.trim() ||
    "https://api.dbplayer.top";
  const frontendUrl =
    cfg.get<string>("subscriptionFrontendUrl")?.trim() ||
    process.env.DBPLAYER_SUBSCRIPTION_FRONTEND?.trim() ||
    "https://dbplayer.top";
  return { apiBase, frontendUrl };
}

type SubscriptionDeps = {
  tokenStorage: TokenStorage;
  licenseValidator: LicenseValidator;
  getFrontendUrl: () => string;
  getApiBase: () => string;
};

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const seg = token.split(".")[1];
    if (!seg) return null;
    const base64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    const normalized = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = Buffer.from(normalized, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function fmtExpiry(exp?: number): string {
  if (!exp || !Number.isFinite(exp)) return "未知";
  return new Date(exp * 1000).toLocaleString();
}

async function fetchAccountSummary(token: string): Promise<string> {
  const apiBase = getSubscriptionConfig().apiBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${apiBase}/api/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      user?: { id?: number; email?: string | null };
      subscription?: { active?: boolean; plan?: string; expiresAt?: number | null };
    };
    const email = data.user?.email?.trim() || "未识别";
    const uid = data.user?.id != null ? String(data.user.id) : "未识别";
    const plan = data.subscription?.plan ?? "free";
    const active = data.subscription?.active ? "active" : "inactive";
    const expRaw = data.subscription?.expiresAt;
    const exp = typeof expRaw === "number" ? fmtExpiry(expRaw) : "∞";
    return `${email} (uid=${uid}, ${plan}/${active}, exp=${exp})`;
  } catch {
    const payload = decodeJwtPayload(token);
    const email = (payload?.email as string | undefined) || "未识别";
    const sub = (payload?.sub as string | undefined) || "未识别";
    const exp = typeof payload?.exp === "number" ? payload.exp : undefined;
    return `${email} (sub=${sub}, exp=${fmtExpiry(exp)})`;
  }
}

async function getAccountStateFromTokenStorage(
  tokenStorage: TokenStorage
): Promise<{ loggedIn: boolean; user?: { id?: number; email?: string | null } }> {
  const token = await tokenStorage.getToken();
  if (!token) {
    return { loggedIn: false };
  }
  const api = getSubscriptionConfig().apiBase.replace(/\/$/, "");
  try {
    const res = await fetch(`${api}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { user?: { id?: number; email?: string | null } };
    return { loggedIn: true, user: data.user };
  } catch {
    return { loggedIn: true };
  }
}

/** 根据 SecretStorage 中的 JWT 向 Webview 推送当前登录态（与侧栏「账号」展示一致） */
async function postAccountStateToWebview(
  webview: vscode.Webview,
  tokenStorage: TokenStorage
): Promise<void> {
  webview.postMessage({ type: "dbplayer/account", ...(await getAccountStateFromTokenStorage(tokenStorage)) });
}

async function openSubscriptionLogin(deps: SubscriptionDeps): Promise<void> {
  const loginUrl = buildSubscriptionPortalEntryUrl(deps.getFrontendUrl());
  const ok = await vscode.env.openExternal(vscode.Uri.parse(loginUrl));
  if (!ok) {
    vscode.window.showWarningMessage(
      `未能用系统浏览器打开订阅页。请复制链接到浏览器：${loginUrl}`
    );
  }
}

async function manageSubscriptionAccount(deps: SubscriptionDeps): Promise<void> {
  const token = (await deps.tokenStorage.getToken()) ?? "";
  const loggedIn = !!token;
  const who = loggedIn ? await fetchAccountSummary(token) : "当前未登录";

  const pick = await vscode.window.showQuickPick(
    [
      { label: `账号: ${who}`, value: "noop" as const },
      { label: "打开订阅中心", value: "open" as const },
      { label: "切换账号（重新登录）", value: "switch" as const },
      { label: "退出登录（清除本地凭据）", value: "logout" as const },
    ],
    {
      placeHolder: "DB Player 账号管理",
      ignoreFocusOut: true,
    }
  );
  if (!pick || pick.value === "noop") return;

  if (pick.value === "open") {
    await vscode.env.openExternal(vscode.Uri.parse(buildSubscriptionPortalEntryUrl(deps.getFrontendUrl())));
    return;
  }
  if (pick.value === "switch") {
    if (token) {
      try {
        const apiBase = getSubscriptionConfig().apiBase.replace(/\/$/, "");
        await fetch(`${apiBase}/api/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      } catch {
        /* ignore */
      }
    }
    await deps.tokenStorage.clearToken();
    deps.licenseValidator.invalidateCache();
    if (currentPanel) void postAccountStateToWebview(currentPanel.webview, deps.tokenStorage);
    await openSubscriptionLogin(deps);
    vscode.window.showInformationMessage("已清除本地登录，正在打开登录页。");
    return;
  }
  if (pick.value === "logout") {
    if (token) {
      try {
        const apiBase = getSubscriptionConfig().apiBase.replace(/\/$/, "");
        await fetch(`${apiBase}/api/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      } catch {
        /* ignore */
      }
    }
    await deps.tokenStorage.clearToken();
    deps.licenseValidator.invalidateCache();
    if (currentPanel) void postAccountStateToWebview(currentPanel.webview, deps.tokenStorage);
    vscode.window.showInformationMessage("DB Player: 已退出登录（本地凭据已清除）");
  }
}

export function activate(context: vscode.ExtensionContext) {
  const tokenStorage = new TokenStorage(context.secrets);
  const getApiBase = () => getSubscriptionConfig().apiBase;
  const getFrontendUrl = () => getSubscriptionConfig().frontendUrl;
  const licenseValidator = new LicenseValidator(tokenStorage, getApiBase);
  const deps: SubscriptionDeps = { tokenStorage, licenseValidator, getFrontendUrl, getApiBase };
  setAiKeyResolver(async (keyRef) => context.secrets.get(`${AI_SECRET_PREFIX}${keyRef}`));

  // 注册 URI Handler：{uriScheme}://lilr.db-player/auth?token=JWT（随宿主变化，如 vscode / cursor / kiro）
  context.subscriptions.push(
    vscode.window.registerUriHandler(
      new DbPlayerUriHandler(tokenStorage, () => {
        licenseValidator.invalidateCache();
        if (currentPanel) void postAccountStateToWebview(currentPanel.webview, tokenStorage);
      })
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("db-player.helloWorld", () => {
      openDbPlayerWebview(context, deps).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage("DB Player 启动失败: " + msg);
        console.error("DB Player open error:", err);
      });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("db-player.manageSubscriptionAccount", async () => {
      try {
        await manageSubscriptionAccount(deps);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`DB Player 账号管理失败: ${msg}`);
      }
    })
  );
  // Create a status bar item that opens the DB Player when clicked
  // Place it on the left but with low priority so it won't sit at the far-left edge
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBar.command = 'db-player.helloWorld';
  statusBar.text = '$(database) DB Player';
  statusBar.tooltip = 'Open DB Player';
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Helper to map VS Code theme to a monaco theme and simple kind
  function getThemeInfo(): { themeKind: 'light' | 'dark' | 'high-contrast'; monacoTheme: string } {
    const kind = vscode.window.activeColorTheme.kind;
    if (kind === vscode.ColorThemeKind.Dark) return { themeKind: 'dark', monacoTheme: 'vs-dark' };
    if (kind === vscode.ColorThemeKind.HighContrast) return { themeKind: 'high-contrast', monacoTheme: 'hc-black' };
    return { themeKind: 'light', monacoTheme: 'vs' };
  }

  // Listen for VS Code theme changes and notify the webview (no reload needed - theme-sync updates Monaco via subscribe)
  const themeListener = vscode.window.onDidChangeActiveColorTheme(() => {
    const info = getThemeInfo();
    if (currentPanel) {
      currentPanel.webview.postMessage({ type: 'theme', themeKind: info.themeKind, monacoTheme: info.monacoTheme });
    }
  });
  context.subscriptions.push(themeListener);
}

export function deactivate() {}

/** VSCode 插件内：保存文件（弹窗选路径后写入） */
async function handleVscodeSaveFile(
  webview: vscode.Webview,
  id: number,
  payload: { content: string; filename: string; isBase64?: boolean }
): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(payload.filename),
    saveLabel: "保存",
  });
  if (!uri) {
    webview.postMessage({ id, data: { cancelled: true } });
    return;
  }
  const content = payload.isBase64
    ? Buffer.from(payload.content, "base64")
    : new TextEncoder().encode(payload.content);
  await vscode.workspace.fs.writeFile(uri, new Uint8Array(content));
  webview.postMessage({ id, data: { success: true, path: uri.fsPath } });
}

/** VSCode 插件内：打开文件（弹窗选文件后读取内容返回） */
async function handleVscodeReadFile(
  webview: vscode.Webview,
  id: number,
  payload: { accept?: string[] }
): Promise<void> {
  const filters: Record<string, string[]> = {};
  if (payload.accept?.length) {
    filters["导入文件"] = payload.accept.map((e) => e.replace(/^\./, ""));
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: Object.keys(filters).length ? filters : undefined,
  });
  if (!uris?.length) {
    webview.postMessage({ id, data: { cancelled: true } });
    return;
  }
  const uri = uris[0];
  const bytes = await vscode.workspace.fs.readFile(uri);
  const name = uri.path.split(/[/\\]/).pop() ?? "file";
  const isBinary = /\.(xlsx|xls)$/i.test(name);
  if (isBinary) {
    const base64 = Buffer.from(bytes).toString("base64");
    webview.postMessage({ id, data: { contentBase64: base64, filename: name } });
  } else {
    const content = new TextDecoder("utf-8").decode(bytes);
    webview.postMessage({ id, data: { content, filename: name } });
  }
}

/** 脱敏后用于日志，避免把密码或密文打到输出 */
function redactPayload(msg: unknown): unknown {
  if (msg && typeof msg === "object" && "payload" in msg && typeof (msg as any).payload === "object") {
    const p = (msg as any).payload as Record<string, unknown>;
    const copy = { ...p };
    if ("password" in copy && copy.password) copy.password = "<redacted>";
    if ("passwordEncrypted" in copy && copy.passwordEncrypted) copy.passwordEncrypted = "<redacted>";
    return { ...msg, payload: copy };
  }
  return msg;
}

async function openDbPlayerWebview(context: vscode.ExtensionContext, deps: SubscriptionDeps) {
  // 与 Web 一致：启动主界面时不校验订阅；仅在表格设计器 / 可视化查询等处调用 subscription/assert 时再校验

  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  const panel = vscode.window.createWebviewPanel(
    "dbPlayer",
    "DB Player",
    column,
    {
      enableScripts: true,
      enableCommandUris: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
    }
  );

  // set current panel reference and clear when disposed
  currentPanel = panel;
  panel.onDidDispose(() => {
    if (currentPanel === panel) currentPanel = null;
  });

  const webview = panel.webview;
  const output = vscode.window.createOutputChannel("DB Player");
  const assertLicensed = async () => {
    const token = (await deps.tokenStorage.getToken()) ?? null;
    await assertSubscriptionLicensed(token, getSubscriptionConfig().apiBase.replace(/\/$/, ""));
  };
  const baseHandler = createVscodeMessageHandler(webview, {
    assertLicensed,
    // 仅对显式订阅入口做校验；其他功能默认可用
    shouldAssertLicensed: ({ kind, method }) => kind === "rpc" && method === "subscription/assert",
  });
  webview.onDidReceiveMessage(async (message: unknown) => {
    const safe = redactPayload(message);
    output.appendLine(`[webview→ext] ${JSON.stringify(safe)}`);
    if (
      message &&
      typeof message === "object" &&
      (message as { type?: string }).type === "dbplayer/open-subscription-login"
    ) {
      await openSubscriptionLogin(deps);
      return;
    }
    if (message && typeof message === "object" && (message as { type?: string }).type === "dbplayer/logout-subscription") {
      const tok = await deps.tokenStorage.getToken();
      if (tok) {
        try {
          const api = getSubscriptionConfig().apiBase.replace(/\/$/, "");
          await fetch(`${api}/api/logout`, { method: "POST", headers: { Authorization: `Bearer ${tok}` } });
        } catch {
          /* ignore */
        }
      }
      await deps.tokenStorage.clearToken();
      deps.licenseValidator.invalidateCache();
      webview.postMessage({ type: "dbplayer/account", loggedIn: false });
      return;
    }
    const msg = message as { id?: number; method?: string; payload?: unknown };
    if (typeof msg.id === "number" && msg.method === "vscode/save-file" && msg.payload != null) {
      try {
        await handleVscodeSaveFile(webview, msg.id, msg.payload as { content: string; filename: string; isBase64?: boolean });
      } catch (e: any) {
        webview.postMessage({ id: msg.id, error: e?.message ?? String(e) });
      }
      return;
    }
    if (typeof msg.id === "number" && msg.method === "vscode/read-file" && msg.payload != null) {
      try {
        await handleVscodeReadFile(webview, msg.id, msg.payload as { accept?: string[] });
      } catch (e: any) {
        webview.postMessage({ id: msg.id, error: e?.message ?? String(e) });
      }
      return;
    }
    if (typeof msg.id === "number" && msg.method === "vscode/clipboard-write" && msg.payload != null) {
      try {
        const text = (msg.payload as { text?: string }).text ?? "";
        await vscode.env.clipboard.writeText(text);
        webview.postMessage({ id: msg.id, data: { success: true } });
      } catch (e: any) {
        webview.postMessage({ id: msg.id, error: e?.message ?? String(e) });
      }
      return;
    }
    if (typeof msg.id === "number" && msg.method === "vscode/clipboard-read") {
      try {
        const text = await vscode.env.clipboard.readText();
        webview.postMessage({ id: msg.id, data: { text: text ?? "" } });
      } catch (e: any) {
        webview.postMessage({ id: msg.id, error: e?.message ?? String(e) });
      }
      return;
    }
    if (typeof msg.id === "number" && msg.method === "vscode/ai-key-set" && msg.payload != null) {
      try {
        const { keyRef, apiKey } = msg.payload as { keyRef?: string; apiKey?: string };
        if (!keyRef?.trim() || !apiKey?.trim()) throw new Error("缺少 keyRef 或 apiKey");
        await context.secrets.store(`${AI_SECRET_PREFIX}${keyRef.trim()}`, apiKey.trim());
        webview.postMessage({ id: msg.id, data: { success: true } });
      } catch (e: any) {
        webview.postMessage({ id: msg.id, error: e?.message ?? String(e) });
      }
      return;
    }
    if (typeof msg.id === "number" && msg.method === "vscode/ai-key-delete" && msg.payload != null) {
      try {
        const { keyRef } = msg.payload as { keyRef?: string };
        if (!keyRef?.trim()) throw new Error("缺少 keyRef");
        await context.secrets.delete(`${AI_SECRET_PREFIX}${keyRef.trim()}`);
        webview.postMessage({ id: msg.id, data: { success: true } });
      } catch (e: any) {
        webview.postMessage({ id: msg.id, error: e?.message ?? String(e) });
      }
      return;
    }
    if (typeof msg.id === "number" && msg.method === "subscription/assert") {
      try {
        await assertLicensed();
        webview.postMessage({ id: msg.id, data: { success: true } });
      } catch (e: any) {
        webview.postMessage({
          id: msg.id,
          error: e?.message ?? String(e),
          subscriptionRequired: true,
        });
      }
      return;
    }
    if (typeof msg.id === "number" && msg.method === "subscription/account") {
      try {
        webview.postMessage({ id: msg.id, data: await getAccountStateFromTokenStorage(deps.tokenStorage) });
      } catch (e: any) {
        webview.postMessage({ id: msg.id, error: e?.message ?? String(e) });
      }
      return;
    }
    baseHandler(message as any);
  });

  // HTML 来自 src/index.html，构建时复制到 out/index.html
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "out", "index-webview.js")
  );
  const monacoBaseUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "out", "vs")
  );
  const htmlUri = vscode.Uri.joinPath(context.extensionUri, "out", "index.html");
  const bytes = await vscode.workspace.fs.readFile(htmlUri);
  const html = new TextDecoder("utf-8").decode(bytes);

  const csp = [
    "default-src 'none'",
    // 使用 webview.cspSource 即可，不要把具体 script URI 塞进 script-src（会被判定为无效 source）
    "script-src 'unsafe-inline' 'unsafe-eval' " + webview.cspSource,
    "style-src 'unsafe-inline' " + webview.cspSource,
    // Allow fonts and images from the webview resources and data: URIs (Monaco may load embedded fonts)
    "font-src " + webview.cspSource + " data:",
    "img-src " + webview.cspSource + " data:",
    // Monaco 依赖 Web Worker；允许从 webview 资源和 blob 启动 worker
    "worker-src " + webview.cspSource + " blob:",
    // 允许 Webview 同源 fetch（例如连接存储接口）；避免被 CSP 直接拦截
    "connect-src 'self' " + webview.cspSource,
  ].join("; ");

  // Replace placeholders (use global replace for repeated occurrences)
  let newHtml = html
    .split("{{CSP}}").join(csp)
    .split("{{SCRIPT_URI}}").join(scriptUri.toString())
    .split("{{MONACO_BASE_URI}}").join(monacoBaseUri.toString());

  const hostBoot = getDesktopOAuthContext();
  const hostScript = `<script>window.__DBPLAYER_DESKTOP_HOST__=${JSON.stringify({
    source: hostBoot.source,
    displayName: hostBoot.displayName,
  })};<\/script>`;
  newHtml = newHtml.includes("</body>") ? newHtml.replace("</body>", `${hostScript}</body>`) : newHtml + hostScript;

  webview.html = newHtml;

  // Send initial theme info to the webview so it can initialize correctly
  const themeInfo = ((): { themeKind: string; monacoTheme: string } => {
    const t = vscode.window.activeColorTheme.kind;
    if (t === vscode.ColorThemeKind.Dark) return { themeKind: 'dark', monacoTheme: 'vs-dark' };
    if (t === vscode.ColorThemeKind.HighContrast) return { themeKind: 'high-contrast', monacoTheme: 'hc-black' };
    return { themeKind: 'light', monacoTheme: 'vs' };
  })();
  panel.webview.postMessage({ type: 'theme', themeKind: themeInfo.themeKind, monacoTheme: themeInfo.monacoTheme });
}
