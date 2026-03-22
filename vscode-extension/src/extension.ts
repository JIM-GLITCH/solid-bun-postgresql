// 前端 Webview 使用 frontend 打包的 webview.js，后端使用 backend/api-handlers-vscode，通过 postMessage 通信
import * as vscode from "vscode";
import { createVscodeMessageHandler } from "../../backend/api-handlers-vscode.js";
import { TokenStorage } from "./token-storage";
import { DbPlayerUriHandler } from "./uri-handler";
import { LicenseValidator } from "./license-validator";
import { ExpiryNotifier } from "./expiry-notifier";

let currentPanel: vscode.WebviewPanel | null = null;

const SUBSCRIPTION_API = process.env.DBPLAYER_SUBSCRIPTION_API ?? "https://your-fc-endpoint.aliyuncs.com";
const SUBSCRIPTION_FRONTEND = process.env.DBPLAYER_SUBSCRIPTION_FRONTEND ?? "https://your-oss-frontend.aliyuncs.com";
const TOKEN_SECRET_KEY = "dbplayer_token";

async function checkSubscription(context: vscode.ExtensionContext): Promise<boolean> {
  const token = await context.secrets.get(TOKEN_SECRET_KEY);
  if (!token) return false;
  try {
    const res = await fetch(`${SUBSCRIPTION_API}/api/verify-license`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as { valid: boolean };
    return data.valid === true;
  } catch {
    return false;
  }
}

function showSubscriptionGate(context: vscode.ExtensionContext): void {
  const panel = vscode.window.createWebviewPanel(
    "dbPlayerSubscribe",
    "DB Player — 订阅",
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const subscribeUrl = SUBSCRIPTION_FRONTEND;
  panel.webview.html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DB Player 订阅</title>
  <style>
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; gap: 16px; }
    h2 { margin: 0; }
    p { margin: 0; opacity: 0.7; }
    a { color: var(--vscode-textLink-foreground); }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 14px; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    input { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 6px 10px; border-radius: 4px; width: 320px; font-size: 13px; }
    .row { display: flex; gap: 8px; }
  </style>
</head>
<body>
  <h2>DB Player 需要有效订阅</h2>
  <p>请前往订阅页面完成订阅，然后将 Token 粘贴到下方。</p>
  <a href="${subscribeUrl}" target="_blank">前往订阅页面</a>
  <div class="row">
    <input id="tokenInput" type="text" placeholder="粘贴 Token..." />
    <button id="saveBtn">保存并验证</button>
  </div>
  <p id="msg" style="color: var(--vscode-errorForeground);"></p>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('saveBtn').addEventListener('click', () => {
      const token = document.getElementById('tokenInput').value.trim();
      if (!token) { document.getElementById('msg').textContent = '请输入 Token'; return; }
      vscode.postMessage({ type: 'saveToken', token });
    });
    window.addEventListener('message', e => {
      if (e.data.type === 'tokenResult') {
        document.getElementById('msg').textContent = e.data.valid ? '' : '无效 Token，请检查后重试';
        document.getElementById('msg').style.color = e.data.valid ? 'var(--vscode-terminal-ansiGreen)' : 'var(--vscode-errorForeground)';
      }
    });
  </script>
</body>
</html>`;

  panel.webview.onDidReceiveMessage(async (msg: { type: string; token?: string }) => {
    if (msg.type === "saveToken" && msg.token) {
      await context.secrets.store(TOKEN_SECRET_KEY, msg.token);
      const valid = await checkSubscription(context);
      panel.webview.postMessage({ type: "tokenResult", valid });
      if (valid) {
        panel.dispose();
        vscode.window.showInformationMessage("订阅验证成功，正在打开 DB Player...");
        openDbPlayerWebview(context).catch(console.error);
      }
    }
  });
}

export function activate(context: vscode.ExtensionContext) {
  const tokenStorage = new TokenStorage(context.secrets);
  const licenseValidator = new LicenseValidator(tokenStorage, SUBSCRIPTION_API);
  const expiryNotifier = new ExpiryNotifier(SUBSCRIPTION_FRONTEND);

  // 注册 URI Handler，支付完成后网页通过 vscode://lilr.db-player/auth?token=JWT 回传 token
  context.subscriptions.push(
    vscode.window.registerUriHandler(
      new DbPlayerUriHandler(tokenStorage, () => licenseValidator.invalidateCache())
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("db-player.helloWorld", () => {
      (async () => {
        const result = await licenseValidator.validate();
        await expiryNotifier.checkAndNotify(result.expiresAt);
        if (!result.valid) {
          showSubscriptionGate(context);
          return;
        }
        openDbPlayerWebview(context).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage("DB Player 启动失败: " + msg);
          console.error("DB Player open error:", err);
        });
      })();
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

async function openDbPlayerWebview(context: vscode.ExtensionContext) {
  const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
  const panel = vscode.window.createWebviewPanel(
    "dbPlayer",
    "DB Player",
    column,
    {
      enableScripts: true,
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
  const baseHandler = createVscodeMessageHandler(webview);
  webview.onDidReceiveMessage(async (message: unknown) => {
    const safe = redactPayload(message);
    output.appendLine(`[webview→ext] ${JSON.stringify(safe)}`);
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
