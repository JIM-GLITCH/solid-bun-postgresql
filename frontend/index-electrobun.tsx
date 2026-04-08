/**
 * Electrobun 应用入口：使用 ElectrobunTransport 与主进程 RPC 通信
 */
import { Electroview } from "electrobun/view";
import type { AppRPCType } from "../shared/src/electrobun-rpc";
import { setTransport } from "./transport";
import { ElectrobunTransport, handleBackendEvent } from "./transport/electrobun-transport";
import { SubscriptionGuardTransport } from "./transport/subscription-guard-transport";
import { getSubscriptionApiBaseFromEnv, isSubscriptionCheckDisabled } from "./subscription/config";
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

window.__electrobunApiRequest = (method, payload) =>
  electroview.rpc.request.api_request({ method, payload });

const innerBun = new ElectrobunTransport();
if (!isSubscriptionCheckDisabled()) {
  setTransport(
    new SubscriptionGuardTransport(innerBun, {
      subscriptionApiBase: getSubscriptionApiBaseFromEnv(),
      getToken: () => Promise.resolve(getBrowserJwt()),
    })
  );
} else {
  setTransport(innerBun);
}

const root = document.getElementById("root");
if (root) {
  render(() => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ), root);
}
