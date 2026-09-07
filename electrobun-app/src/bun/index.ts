/**
 * Electrobun 主进程：集成 Effect 重构后的路由（ApiCoreRefactored）+ 运行时单例（AppRuntime），
 * 通过 RPC 与渲染进程通信。无 Rust 依赖，前后端均为 TypeScript。
 */
import { BrowserWindow, BrowserView } from "electrobun/bun";
import type { AppRPCType } from "../../../shared/src/electrobun-rpc";
import { routeApiRequest } from "../../../backend/api/ApiCoreRefactored";
import { subscribeSessionEvents, hasSession } from "../../../backend/api/sse";
import { AppRuntime } from "../../../backend/runtime/app-runtime";
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
          const exists = AppRuntime.runSync(hasSession(sessionId));
          if (!exists) {
            mainWebview?.rpc.send.backend_event({ sessionId, error: "未找到数据库连接" });
            return { ok: true };
          }
          // 订阅为异步（Effect）：先登记占位退订，若在订阅完成前收到
          // unsubscribe-events，则标记 cancelled，待 unsub 返回后立即退订。
          let cancelled = false;
          let realUnsub: (() => void) | undefined;
          eventUnsubscribes.set(sessionId, () => {
            cancelled = true;
            realUnsub?.();
          });
          try {
            const unsub = await AppRuntime.runPromise(
              subscribeSessionEvents(sessionId, (msg) => {
                mainWebview?.rpc.send.backend_event({ sessionId, data: msg });
              })
            );
            if (cancelled) {
              unsub();
              eventUnsubscribes.delete(sessionId);
            } else {
              realUnsub = unsub;
            }
          } catch {
            eventUnsubscribes.delete(sessionId);
          }
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
        return AppRuntime.runPromise(routeApiRequest(method as ApiMethod, payload));
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
