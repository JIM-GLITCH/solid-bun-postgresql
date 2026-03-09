// 前端 Webview 使用 frontend 打包的 webview.js，后端使用 backend/api-handlers-vscode，通过 postMessage 通信
import * as vscode from "vscode";
import { createVscodeMessageHandler } from "../../backend/api-handlers-vscode.js";

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
    // Monaco 依赖 Web Worker；允许从 webview 资源和 blob 启动 worker
    "worker-src " + webview.cspSource + " blob:",
    // 允许 Webview 同源 fetch（例如连接存储接口）；避免被 CSP 直接拦截
    "connect-src 'self' " + webview.cspSource,
  ].join("; ");

  let newHtml = html
    .replace("{{CSP}}", csp)
    .replace("{{SCRIPT_URI}}", scriptUri.toString())
    .replace("{{MONACO_BASE_URI}}", monacoBaseUri.toString());

  webview.html = newHtml;
}
