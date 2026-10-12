// 前端 Webview 与 Extension Host 通过 vscode-messenger（TypeFox）通信，
// 通道上只跑 tRPC：
// - Webview 侧：tRPC link（`trpc-vscode-link`），业务与宿主能力（`host.*`）都是 tRPC 调用
// - 扩展侧：createWebviewRpcBridge 按 procedure path 分派——业务走 appRouter，
//   宿主专属的 path（`host.*` / `subscription.openLogin` …）由 procedureOverrides 就地实现
import * as vscode from "vscode";
import { Messenger, type MessengerDiagnostic } from "vscode-messenger";
import type { WebviewIdMessageParticipant } from "vscode-messenger-common";
import { observable } from "@trpc/server/observable";
import { createWebviewRpcBridge, type WebviewRpcBridge } from "../../backend/vscode-messenger-bridge.js";
import { assertSubscriptionLicensed } from "../../backend/subscription-license.js";
import { setAiKeyResolver } from "../../backend/api-core.js";
import { TokenStorage } from "./token-storage";
import { DbPlayerUriHandler } from "./uri-handler";
import { LicenseValidator } from "./license-validator";
import { buildSubscriptionPortalEntryUrl, getDesktopOAuthContext } from "./desktop-host";

let currentPanel: vscode.WebviewPanel | null = null;
let currentReceiver: WebviewIdMessageParticipant | null = null;
let messenger: Messenger | null = null;

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

type AccountState = { loggedIn: boolean; user?: { id?: number; email?: string | null } };

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

async function getAccountStateFromTokenStorage(tokenStorage: TokenStorage): Promise<AccountState> {
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

/** 账号态订阅者：每个 Webview 的 `subscription.onAccountState` 订阅注册一个。 */
const accountStateListeners = new Set<(state: AccountState) => void>();

/** 把最新账号态同步给所有订阅者（登录 / 退出 / 切换账号后调用）。 */
function notifyAccountState(state: AccountState): void {
  for (const listener of [...accountStateListeners]) {
    try {
      listener(state);
    } catch {
      accountStateListeners.delete(listener);
    }
  }
}

/** 主动向 Webview 推送当前登录态（与侧栏「账号」展示一致） */
async function pushAccountState(tokenStorage: TokenStorage): Promise<void> {
  notifyAccountState(await getAccountStateFromTokenStorage(tokenStorage));
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

/** 退出登录：清扩展侧凭据 + 通知订阅服务 */
async function logoutSubscription(deps: SubscriptionDeps): Promise<{ success: boolean }> {
  const token = await deps.tokenStorage.getToken();
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
  notifyAccountState({ loggedIn: false });
  return { success: true };
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
    void pushAccountState(deps.tokenStorage);
    await openSubscriptionLogin(deps);
    vscode.window.showInformationMessage("已清除本地登录，正在打开登录页。");
    return;
  }
  if (pick.value === "logout") {
    await logoutSubscription(deps);
    vscode.window.showInformationMessage("DB Player: 已退出登录（本地凭据已清除）");
  }
}

export function activate(context: vscode.ExtensionContext): MessengerDiagnostic {
  const tokenStorage = new TokenStorage(context.secrets);
  const getApiBase = () => getSubscriptionConfig().apiBase;
  const getFrontendUrl = () => getSubscriptionConfig().frontendUrl;
  const licenseValidator = new LicenseValidator(tokenStorage, getApiBase);
  const deps: SubscriptionDeps = { tokenStorage, licenseValidator, getFrontendUrl, getApiBase };
  setAiKeyResolver(async (keyRef) => context.secrets.get(`${AI_SECRET_PREFIX}${keyRef}`));

  messenger = new Messenger();

  // 注册 URI Handler：{uriScheme}://lilr.db-player/auth?token=JWT（随宿主变化，如 vscode / cursor / kiro）
  context.subscriptions.push(
    vscode.window.registerUriHandler(
      new DbPlayerUriHandler(tokenStorage, () => {
        licenseValidator.invalidateCache();
        void pushAccountState(tokenStorage);
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

  // Helper to map VS Code theme kind（与 webview theme-sync 消息字段兼容）
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

  // 暴露 vscode-messenger 的诊断（调试）API：经扩展 exports 返回，
  // 供消息交互跟踪 / 调试工具读取当前 webviews、handlers、pending 请求并订阅消息事件。
  return messenger.diagnosticApi();
}

export function deactivate() {}

// ── 宿主专属 procedure 实现（覆盖服务端 appRouter 的同名 path）──────────────

type SaveFilePayload = { content: string; filename: string; isBase64?: boolean };
type ReadFilePayload = { accept?: string[] };

async function saveFileToWorkspace(payload: SaveFilePayload): Promise<{ cancelled?: boolean; success?: boolean; path?: string }> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(payload.filename),
    saveLabel: "保存",
  });
  if (!uri) return { cancelled: true };
  const content = payload.isBase64
    ? Buffer.from(payload.content, "base64")
    : new TextEncoder().encode(payload.content);
  await vscode.workspace.fs.writeFile(uri, new Uint8Array(content));
  return { success: true, path: uri.fsPath };
}

async function readFileFromWorkspace(payload: ReadFilePayload): Promise<Record<string, unknown>> {
  const filters: Record<string, string[]> = {};
  if (payload.accept?.length) {
    filters["导入文件"] = payload.accept.map((e) => e.replace(/^\./, ""));
  }
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: Object.keys(filters).length ? filters : undefined,
  });
  if (!uris?.length) return { cancelled: true };
  const uri = uris[0];
  const bytes = await vscode.workspace.fs.readFile(uri);
  const name = uri.path.split(/[/\\]/).pop() ?? "file";
  if (/\.(xlsx|xls)$/i.test(name)) {
    return { contentBase64: Buffer.from(bytes).toString("base64"), filename: name };
  }
  return { content: new TextDecoder("utf-8").decode(bytes), filename: name };
}

/**
 * 宿主专属 procedure 覆盖：path 与服务端 `appRouter` 同名，但改由扩展实现。
 * - `host.*`：文件、剪贴板、AI Key（服务端返回「不支持」）
 * - `subscription.openLogin` / `logout`：宿主动作
 * - `subscription.onAccountState`：由扩展事件驱动的事件流
 */
function createProcedureOverrides(context: vscode.ExtensionContext, deps: SubscriptionDeps) {
  return {
    "subscription.openLogin": async (): Promise<{ success: boolean }> => {
      await openSubscriptionLogin(deps);
      return { success: true };
    },

    "subscription.logout": () => logoutSubscription(deps),

    // 账号态推送：订阅建立即推一次当前状态，之后由 pushAccountState/notifyAccountState 驱动
    "subscription.onAccountState": () =>
      observable<AccountState>((emit) => {
        let active = true;
        const listener = (state: AccountState) => {
          if (active) emit.next(state);
        };
        accountStateListeners.add(listener);
        void getAccountStateFromTokenStorage(deps.tokenStorage).then((state) => {
          if (active) emit.next(state);
        });
        return () => {
          active = false;
          accountStateListeners.delete(listener);
        };
      }),

    "host.saveFile": (input: unknown) => saveFileToWorkspace(input as SaveFilePayload),

    "host.readFile": (input: unknown) => readFileFromWorkspace(input as ReadFilePayload),

    "host.clipboardWrite": async (input: unknown) => {
      await vscode.env.clipboard.writeText((input as { text?: string } | undefined)?.text ?? "");
      return { success: true };
    },

    "host.clipboardRead": async () => ({ text: (await vscode.env.clipboard.readText()) ?? "" }),

    "host.aiKeySet": async (input: unknown) => {
      const { keyRef, apiKey } = (input ?? {}) as { keyRef?: string; apiKey?: string };
      if (!keyRef?.trim() || !apiKey?.trim()) throw new Error("缺少 keyRef 或 apiKey");
      await context.secrets.store(`${AI_SECRET_PREFIX}${keyRef.trim()}`, apiKey.trim());
      return { success: true };
    },

    "host.aiKeyDelete": async (input: unknown) => {
      const { keyRef } = (input ?? {}) as { keyRef?: string };
      if (!keyRef?.trim()) throw new Error("缺少 keyRef");
      await context.secrets.delete(`${AI_SECRET_PREFIX}${keyRef.trim()}`);
      return { success: true };
    },
  };
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

  const webview = panel.webview;
  const assertLicensed = async () => {
    const token = (await deps.tokenStorage.getToken()) ?? null;
    await assertSubscriptionLicensed(token, getSubscriptionConfig().apiBase.replace(/\/$/, ""));
  };

  // Webview 侧只调 tRPC：业务 path 走 appRouter，宿主专属 path 由 overrides 覆盖
  const receiver = messenger!.registerWebviewPanel(panel);
  const bridge: WebviewRpcBridge = createWebviewRpcBridge({
    messenger: messenger!,
    receiver,
    getContext: () => ({}),
    procedureOverrides: {
      // 订阅校验用扩展侧凭据（服务端 Cookie/Bearer 逻辑不适用）
      "subscription.assert": async (input) => {
        const feature = (input as { feature?: string } | undefined)?.feature;
        if (feature !== "visual-query-builder" && feature !== "table-designer") {
          throw new Error("无效的功能标识");
        }
        await assertLicensed();
        return { success: true };
      },
      "subscription.account": () => getAccountStateFromTokenStorage(deps.tokenStorage),
      ...createProcedureOverrides(context, deps),
    },
  });

  // set current panel reference and clear when disposed
  currentPanel = panel;
  currentReceiver = receiver;
  panel.onDidDispose(() => {
    bridge.dispose();
    if (currentPanel === panel) currentPanel = null;
    if (currentReceiver === receiver) currentReceiver = null;
  });

  // HTML 来自 src/index.html，构建时复制到 out/index.html
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, "out", "index-webview.js")
  );
  const htmlUri = vscode.Uri.joinPath(context.extensionUri, "out", "index.html");
  const bytes = await vscode.workspace.fs.readFile(htmlUri);
  const html = new TextDecoder("utf-8").decode(bytes);

  const csp = [
    "default-src 'none'",
    // 使用 webview.cspSource 即可，不要把具体 script URI 塞进 script-src（会被判定为无效 source）
    "script-src 'unsafe-inline' 'unsafe-eval' " + webview.cspSource,
    "style-src 'unsafe-inline' " + webview.cspSource,
    "font-src " + webview.cspSource + " data:",
    "img-src " + webview.cspSource + " data:",
    // 允许 Webview 同源 fetch（例如连接存储接口）；避免被 CSP 直接拦截
    "connect-src 'self' " + webview.cspSource,
  ].join("; ");

  // Replace placeholders (use global replace for repeated occurrences)
  let newHtml = html
    .split("{{CSP}}").join(csp)
    .split("{{SCRIPT_URI}}").join(scriptUri.toString());

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
