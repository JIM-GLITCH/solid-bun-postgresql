/**
 * VSCode Webview 入口：使用 VsCodeTransport 与 Extension Host 通信，再渲染与 standalone 相同的前端
 */
import { render } from "solid-js/web";
import { setTransport } from "./transport";
import { VsCodeTransport } from "./transport/vscode-transport";
import App from "./app";
import { DialogProvider } from "./dialog-context";
import { initWebviewThemeListener } from "./theme-sync";

setTransport(new VsCodeTransport());

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
