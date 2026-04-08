/**
 * Electrobun 主进程：直接集成 api-core，通过 RPC 与渲染进程通信
 * 无 Rust 依赖，前后端均为 TypeScript
 */
import { BrowserWindow, BrowserView } from "electrobun/bun";
import type { AppRPCType } from "../../../shared/src/electrobun-rpc";
import { handleApiRequest, getSession, subscribeSessionEvents } from "../../../backend/api-core";
import { assertSubscriptionLicensed } from "../../../backend/subscription-license";
import type { ApiMethod } from "../../../shared/src";

/** 当前主窗口的 webview，用于推送 backend_event */
let mainWebview: { rpc: { send: { backend_event: (p: unknown) => void } } } | null = null;

/** sessionId -> 取消订阅函数 */
const eventUnsubscribes = new Map<string, () => void>();

const appRPC = BrowserView.defineRPC<AppRPCType>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      api_request: async ({ method, payload, licenseJwt }) => {
        await assertSubscriptionLicensed(licenseJwt ?? null);
        if (method === "subscribe-events") {
          const sessionId = (payload as { sessionId?: string })?.sessionId;
          if (!sessionId) throw new Error("subscribe-events requires sessionId");
          if (eventUnsubscribes.has(sessionId)) return { ok: true };
          const session = getSession(sessionId);
          if (!session) {
            mainWebview?.rpc.send.backend_event({ sessionId, error: "未找到数据库连接" });
            return { ok: true };
          }
          const unsub = subscribeSessionEvents(sessionId, (msg) => {
            mainWebview?.rpc.send.backend_event({ sessionId, data: msg });
          });
          eventUnsubscribes.set(sessionId, unsub);
          return { ok: true };
        }
        if (method === "unsubscribe-events") {
          const sessionId = (payload as { sessionId?: string })?.sessionId;
          if (sessionId) {
            const unsub = eventUnsubscribes.get(sessionId);
            if (unsub) {
              unsub();
              eventUnsubscribes.delete(sessionId);
            }
          }
          return { ok: true };
        }
        return handleApiRequest(
          method as ApiMethod,
          payload as Parameters<typeof handleApiRequest>[1]
        );
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
