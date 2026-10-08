/**
 * VSCode Webview 入口。
 *
 * 与 Extension Host 的通信只有一条通道：vscode-messenger（TypeFox），
 * 上面只跑 tRPC——业务 procedure 与宿主能力（`host.*`）都是 tRPC 调用，
 * 由扩展宿主在桥里按 path 分派（见 `backend/vscode-messenger-bridge`）。
 * 此处只需把 tRPC client 的传输 link 换成 messenger link。
 */
import { render } from "solid-js/web";
import { createVscodeMessengerLink } from "./trpc-vscode-link";
import { setTrpcTransportLink } from "./trpc-client";
import App from "./app";
import { DialogProvider } from "./dialog-context";
import { initWebviewThemeListener } from "./theme-sync";

setTrpcTransportLink(createVscodeMessengerLink());

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
