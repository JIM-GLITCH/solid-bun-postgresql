// 前端 Webview 与 Extension Host 通过 vscode-messenger（TypeFox）通信，
// 通道上只跑 tRPC：
// - Webview 侧：tRPC link（`trpc-vscode-link`），业务与宿主能力（`host.*`）都是 tRPC 调用
// - 扩展侧：createWebviewRpcBridge 按 procedure path 分派——业务走 appRouter，
//   宿主专属的 path（`host.*`）由 procedureOverrides 就地实现
import * as vscode from "vscode";
import { Messenger, type MessengerDiagnostic } from "vscode-messenger";
import type { WebviewIdMessageParticipant } from "vscode-messenger-common";
import { createWebviewRpcBridge, type WebviewRpcBridge } from "../../backend/vscode-messenger-bridge.js";
import { setAiKeyResolver } from "../../backend/api-core.js";
import { getDesktopOAuthContext } from "./desktop-host";

let currentPanel: vscode.WebviewPanel | null = null;
let currentReceiver: WebviewIdMessageParticipant | null = null;
let messenger: Messenger | null = null;

const AI_SECRET_PREFIX = "dbplayer_ai_key_";

export function activate(context: vscode.ExtensionContext): MessengerDiagnostic {
  setAiKeyResolver(async (keyRef) => context.secrets.get(`${AI_SECRET_PREFIX}${keyRef}`));

  messenger = new Messenger();

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
 */
function createProcedureOverrides(context: vscode.ExtensionContext) {
  return {
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

async function openDbPlayerWebview(context: vscode.ExtensionContext) {
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

  // Webview 侧只调 tRPC：业务 path 走 appRouter，宿主专属 path 由 overrides 覆盖
  const receiver = messenger!.registerWebviewPanel(panel);
  const bridge: WebviewRpcBridge = createWebviewRpcBridge({
    messenger: messenger!,
    receiver,
    getContext: () => ({}),
    procedureOverrides: {
      ...createProcedureOverrides(context),
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
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // 使用 webview.cspSource 即可，不要把具体 script URI 塞进 script-src（会被判定为无效 source）
    // 移除 'unsafe-eval'（Vite/Solid 生产构建不依赖 eval，保留它基本抵消 script-src 防护）；
    // 'unsafe-inline' 仅用于注入的桌面端启动脚本（hostScript），属必要项
    "script-src 'unsafe-inline' " + webview.cspSource,
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
