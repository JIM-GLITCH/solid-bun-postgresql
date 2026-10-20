/**
 * Electrobun 主进程：直接集成 tRPC `appRouter`，通过 RPC 与渲染进程通信
 * 无 Rust 依赖，前后端均为 TypeScript
 *
 * 分发方式与 VSCode 扩展的 `backend/vscode-messenger-bridge.ts` 一致：
 * 前端经 `api_request` 传来的方法名（`shared/src/api-methods.ts` 的 ApiMethod，
 * 形如 `"db/query"`）映射为 tRPC procedure path（`"db.query"`），
 * 由 `appRouter.createCaller` 求值——业务实现的唯一真源就是 appRouter。
 *
 * `subscribe-events` / `unsubscribe-events` 是 electrobun 专属的 RPC 消息
 * （按 sessionId 转发 SSE 事件），不是 tRPC procedure，保持原有实现。
 */
import { BrowserWindow, BrowserView } from "electrobun/bun";
import type { AppRPCType } from "../../../shared/src/electrobun-rpc";
import { appRouter } from "../../../backend/trpc";
import { getSession, subscribeSessionEvents } from "../../../backend/api-core";

/** 当前主窗口的 webview，用于推送 backend_event */
let mainWebview: { rpc: { send: { backend_event: (p: unknown) => void } } } | null = null;

/** sessionId -> 取消订阅函数 */
const eventUnsubscribes = new Map<string, () => void>();

/** 所有 db/* 入参都自带 connectionId / dbType，context 无需额外信息（与 VSCode 侧 getContext: () => ({}) 一致） */
const caller = appRouter.createCaller(() => ({}));

/** ApiMethod（"db/query"）→ tRPC procedure path（"db.query"） */
function toProcedurePath(method: string): string {
  return method.replaceAll("/", ".");
}

/** 沿 caller 代理逐级取值（与 vscode-messenger-bridge 的 resolveProcedure 同构） */
function resolveProcedure(path: string): (input: unknown) => Promise<unknown> {
  let node: any = caller;
  for (const segment of path.split(".")) node = node?.[segment];
  if (typeof node !== "function") throw new Error(`未知 API 方法: ${path}`);
  return node as (input: unknown) => Promise<unknown>;
}

const appRPC = BrowserView.defineRPC<AppRPCType>({
  maxRequestTime: 30000,
  handlers: {
    requests: {
      api_request: async ({ method, payload }) => {
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
        return resolveProcedure(toProcedurePath(method))(payload);
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
