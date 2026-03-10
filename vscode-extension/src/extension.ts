// 前端 Webview 使用 frontend 打包的 webview.js，后端使用 backend/api-handlers-vscode，通过 postMessage 通信
import * as vscode from "vscode";
import { createVscodeMessageHandler } from "../../backend/api-handlers-vscode.js";

let currentPanel: vscode.WebviewPanel | null = null;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("db-player.helloWorld", () => {
      openDbPlayerWebview(context).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage("DB Player 启动失败: " + msg);
        console.error("DB Player open error:", err);
      });
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
  webview.onDidReceiveMessage((message: unknown) => {
    const safe = redactPayload(message);
    output.appendLine(`[webview→ext] ${JSON.stringify(safe)}`);
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
