/**
 * Electrobun 应用入口：使用 ElectrobunTransport 与主进程 RPC 通信
 */
import { Electroview } from "electrobun/view";
import type { AppRPCType } from "../shared/src/electrobun-rpc";
import { setTransport } from "./transport";
import { ElectrobunTransport, handleBackendEvent } from "./transport/electrobun-transport";
import type { PostMessageClientMsg } from "./transport/post-message-client-transport";
import { getBrowserJwt } from "./subscription/browser-token";
import { render } from "solid-js/web";
import App from "./app";
import { DialogProvider } from "./dialog-context";

const rpc = Electroview.defineRPC<AppRPCType>({
  handlers: {
    messages: {
      backend_event: (payload) => handleBackendEvent(payload),
    },
  },
});
const electroview = new Electroview({ rpc });
const rpcApi = electroview.rpc!;

(window as Window & {
  __electrobunApiRequest?: (method: string, payload: Record<string, unknown>) => Promise<unknown>;
}).__electrobunApiRequest = (method, payload) =>
  rpcApi.request.api_request({ method, payload, licenseJwt: getBrowserJwt() });

setTransport(
  new ElectrobunTransport({
    // jsonrpc 会话消息经 api_request("rpc-transport") 上行，下行由 backend_event.rpcMsg 承载
    post: (m: PostMessageClientMsg) =>
      rpcApi.request.api_request({
        method: "rpc-transport",
        payload: m as unknown as Record<string, unknown>,
        licenseJwt: getBrowserJwt(),
      }),
  })
);

const root = document.getElementById("root");
if (root) {
  render(() => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ), root);
}
