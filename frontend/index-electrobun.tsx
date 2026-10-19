/**
 * Electrobun 应用入口。
 *
 * ⚠️ 迁移中：业务 RPC 已统一到 tRPC。Electrobun 还缺一个基于
 * `Electroview.defineRPC` 的 tRPC link（对应 VSCode 的 `trpc-vscode-link.ts`：
 * 把 `RPC_CALL` / `SUBSCRIBE` 映射到主进程的 `api_request`）。
 * 在该 link 补齐前，Electrobun 端只有主进程 `api_request` 通道，
 * 数据库事件订阅（`db.onConnectionEvents`）与账号态推送尚未接通。
 */
import { Electroview } from "electrobun/view";
import type { AppRPCType } from "../shared/src/electrobun-rpc";
import { getBrowserJwt } from "./subscription/browser-token";
import { render } from "solid-js/web";
import App from "./app";
import { DialogProvider } from "./dialog-context";

declare global {
  interface Window {
    /** 主进程经 electrobun RPC 暴露的 api_request 入口（platform.ts 的 isElectrobun 检测它） */
    __electrobunApiRequest?: (method: string, payload: unknown) => Promise<unknown>;
  }
}

const rpc = Electroview.defineRPC<AppRPCType>({
  handlers: {
    messages: {
      // TODO(electrobun): 接入 tRPC subscription 后由主进程事件驱动
      backend_event: () => {},
    },
  },
});
const electroview = new Electroview({ rpc });

window.__electrobunApiRequest = (method, payload) =>
  electroview.rpc.request.api_request({ method, payload, licenseJwt: getBrowserJwt() });

const root = document.getElementById("root");
if (root) {
  render(() => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ), root);
}
