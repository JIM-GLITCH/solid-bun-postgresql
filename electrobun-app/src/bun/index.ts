/**
 * Electrobun 主进程：进程内承载 jsonrpc RPC 栈（buildRpcStack），
 * 经 BrowserView RPC 的 api_request("rpc-transport") 与渲染进程通信。
 * 无 Rust 依赖，前后端均为 TypeScript。
 */
import { BrowserWindow, BrowserView } from "electrobun/bun";
import type { AppRPCType } from "../../../shared/src/electrobun-rpc";
import { assertSubscriptionLicensed } from "../../../backend/subscription-license";
import { buildRpcStack } from "../../../backend/rpc-server";
import {
  PostMessageServerTransport,
  type PostMessageClientMsg,
} from "../../../backend/transport/post-message-server-transport";

/** 当前主窗口的 webview，用于推送 backend_event */
let mainWebview: { rpc: { send: { backend_event: (p: unknown) => void } } } | null = null;

/** 最近一次 api_request 携带的订阅 JWT（供 subscription/assert 注入 accessToken） */
let lastLicenseJwt: string | null = null;

const serverTransport = new PostMessageServerTransport(
  (msg) => mainWebview?.rpc.send.backend_event({ rpcMsg: msg }),
  {
    transformRequest: (msg) => {
      const m = msg as { method?: string; params?: Record<string, unknown> };
      if (m.method === "subscription/assert") {
        return {
          ...m,
          params: { ...(m.params ?? {}), accessToken: lastLicenseJwt },
        } as unknown as typeof msg;
      }
      return msg;
    },
  },
);
buildRpcStack(serverTransport);

const appRPC = BrowserView.defineRPC<AppRPCType>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      api_request: async ({ method, payload, licenseJwt }) => {
        // 与旧行为一致：所有请求先过订阅校验（钩子保留在宿主层）
        await assertSubscriptionLicensed(licenseJwt ?? null);
        if (method === "rpc-transport") {
          lastLicenseJwt = licenseJwt ?? null;
          return serverTransport.handleClientMessage(payload as unknown as PostMessageClientMsg);
        }
        throw new Error(`不支持的 api_request 方法：${method}`);
      },
    },
    messages: {},
  },
});

const win = new BrowserWindow({
  title: "Front Table",
  url: "views://app/index.html",
  rpc: appRPC,
});

mainWebview = win.webview as unknown as typeof mainWebview;
