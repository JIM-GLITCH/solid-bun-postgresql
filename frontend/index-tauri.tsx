/**
 * Tauri 应用入口：同一套 UI，通过 TauriTransport 与 sidecar 后端 pipe 通信
 */
import { setTransport } from "./transport";
import { TauriTransport } from "./transport/tauri-transport";
import { render } from "solid-js/web";
import App from "./app";
import { Route, HashRouter } from "@solidjs/router";
import Postgres from "./postgres";
import QueryInterface from "./query-interface";

setTransport(new TauriTransport());

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
