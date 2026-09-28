/**
 * Electrobun 应用入口：使用 tRPC 与主进程 RPC 通信
 */
import { Electroview } from "electrobun/view";
import type { AppRPCType } from "../shared/src/electrobun-rpc";
import { getBrowserJwt } from "./subscription/browser-token";
import { render } from "solid-js/web";
import App from "./app";
import { DialogProvider } from "./dialog-context";
import { createTrpcClient } from "./trpc/client";

const rpc = Electroview.defineRPC<AppRPCType>({
  handlers: {
    messages: {
      backend_event: (payload) => {
        // 处理后端事件，后续可以通过 tRPC 订阅实现
        console.log('[Electrobun] Backend event:', payload);
      },
    },
  },
});
const electroview = new Electroview({ rpc });

window.__electrobunApiRequest = (method, payload) =>
  electroview.rpc.request.api_request({ method, payload, licenseJwt: getBrowserJwt() });

// 初始化 tRPC client 为 Electrobun 环境
createTrpcClient({
  environment: 'electrobun',
  httpOptions: {
    baseUrl: '',
    getBearerToken: getBrowserJwt,
  },
});

const root = document.getElementById("root");
if (root) {
  render(() => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ), root);
}
