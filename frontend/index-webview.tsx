/**
 * VSCode Webview 入口：使用 VsCodeTransport 与 Extension Host 通信，再渲染与 standalone 相同的前端
 */
import { render } from "solid-js/web";
import { Route, HashRouter } from "@solidjs/router";
import { setTransport } from "./transport";
import { VsCodeTransport } from "./transport/vscode-transport";
import App from "./app";
import Postgres from "./postgres";
import QueryInterface from "./query-interface";

setTransport(new VsCodeTransport());

const root = document.getElementById("root");
if (root) {
  render(
    () => (
      <HashRouter>
        <Route path="/" component={App} />
        <Route path="/postgres" component={Postgres} />
        <Route path="/postgres/query-interface" component={QueryInterface} />
      </HashRouter>
    ),
    root
  );
}
