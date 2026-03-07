/**
 * Electrobun 应用入口：使用 ElectrobunTransport 与主进程 RPC 通信
 */
import { Electroview } from "electrobun/view";
import type { AppRPCType } from "../shared/src/electrobun-rpc";
import { setTransport } from "./transport";
import { ElectrobunTransport, handleBackendEvent } from "./transport/electrobun-transport";
import { render } from "solid-js/web";
import App from "./app";
import { Route, HashRouter } from "@solidjs/router";
import Postgres from "./postgres";
import QueryInterface from "./query-interface";

const rpc = Electroview.defineRPC<AppRPCType>({
  handlers: {
    messages: {
      backend_event: (payload) => handleBackendEvent(payload),
    },
  },
});
const electroview = new Electroview({ rpc });

window.__electrobunApiRequest = (method, payload) =>
  electroview.rpc.request.api_request({ method, payload });

setTransport(new ElectrobunTransport());

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
