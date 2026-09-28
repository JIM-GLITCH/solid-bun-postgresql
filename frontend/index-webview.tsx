/**
 * VSCode Webview 入口：完全使用 tRPC，在 link 层直接使用 postMessage
 */
import { render } from "solid-js/web";
import { createTrpcClient } from "./trpc/client";
import App from "./app";
import { DialogProvider } from "./dialog-context";
import { initWebviewThemeListener } from "./theme-sync";

// 初始化 tRPC client（VSCode 环境，使用直接 postMessage link）
createTrpcClient({
  environment: 'vscode',
});

// start listening for theme messages from extension
initWebviewThemeListener();

const root = document.getElementById("root");
if (root) {
  render(() => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ), root);
}
