/**
 * VSCode Webview 入口：使用 VsCodeTransport 与 Extension Host 通信，再渲染与 standalone 相同的前端
 */
import { render } from "solid-js/web";
import { setTransport } from "./transport";
import { VsCodeTransport } from "./transport/vscode-transport";
import App from "./app";

setTransport(new VsCodeTransport());

const root = document.getElementById("root");
if (root) {
  render(() => <App />, root);
}
