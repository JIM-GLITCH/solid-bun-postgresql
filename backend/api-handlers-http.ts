/**
 * 后端 API 处理器 - Web 实现：HTTP + SSE
 * 用于 standalone (Node + Hono) 构建
 */

import type { ApiMethod, ApiRequestPayload, HttpRpcMethod, SSEMessage } from "../shared/src";
import { HTTP_API_METHOD_SET } from "../shared/src";
import { handleApiRequest, getSession, subscribeSessionEvents } from "./api-core";

type RouteHandler = (req: Request) => Response | Promise<Response>;

/** 通用 POST 处理器：成功 200 + JSON；失败 500 + `{ error, success: false }`（与 HttpTransport `res.ok` 一致） */
function postApi<M extends ApiMethod>(method: M): RouteHandler {
  return async (req: Request) => {
    try {
      const data = (await req.json()) as ApiRequestPayload[M];
      const result = await handleApiRequest(method, data);
      return Response.json(result);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      return Response.json({ error: err, success: false }, { status: 500 });
    }
  };
}

/** 旧版路径与笔误 → 当前 `ApiMethod` */
const LEGACY_POST_PATH_TO_METHOD: Record<string, ApiMethod> = {
  "/api/db/pg-stat-overview": "db/session-monitor",
  "/api/db/manage-backend": "db/session-control",
  "/api/db/pg_stat-overview": "db/session-monitor",
  "/api/db/pg_stat-overciew": "db/session-monitor",
  "/api/db/pg-stat-overciew": "db/session-monitor",
};

/** `POST /api/${method}`：与前端 `HttpTransport` 一致；未知 RPC 返回 404 */
export async function handleApiPost(req: Request): Promise<Response> {
  const pathname = new URL(req.url).pathname;
  const name =
    LEGACY_POST_PATH_TO_METHOD[pathname] ??
    (pathname.startsWith("/api/") ? pathname.slice("/api/".length) : "");
  if (!name || !HTTP_API_METHOD_SET.has(name as HttpRpcMethod)) {
    return new Response("Not Found", { status: 404 });
  }
  return postApi(name as ApiMethod)(req);
}

/** 创建 HTTP 格式的 API 路由（供 Hono / Bun `routes` 使用；POST 见 `handleApiPost`） */
export function createApiRoutes(): Record<
  string,
  { GET?: (req: unknown) => Response | Promise<Response>; POST?: RouteHandler }
> {
  const routes: Record<string, { GET?: (req: unknown) => Response | Promise<Response>; POST?: RouteHandler }> = {
    "/api/hello": { GET: () => Response.json({ message: "Hello from API" }) },

    "/api/events": {
      GET: (req: unknown) => {
        const url = new URL((req as Request).url);
        const connectionSessionId =
          url.searchParams.get("connectionSessionId")?.trim() ||
          url.searchParams.get("connectionId")?.trim();
        if (!connectionSessionId) {
          return new Response("缺少 connectionSessionId（旧客户端可仍传 connectionId）", { status: 400 });
        }
        const session = getSession(connectionSessionId);
        if (!session) return new Response("未找到数据库连接，请先连接数据库", { status: 400 });


        let cleanup: (() => void) | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const push = (msg: SSEMessage) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`));
              } catch {
                unsubscribe();
              }
            };
            push({ type: "NOTIFICATION", message: "SSE 连接已建立", timestamp: Date.now() });

            let heartbeatInterval: ReturnType<typeof setInterval>;
            const sendHeartbeat = () => {
              try {
                controller.enqueue(encoder.encode(": heartbeat\n\n"));
              } catch {
                clearInterval(heartbeatInterval);
              }
            };
            sendHeartbeat();
            heartbeatInterval = setInterval(sendHeartbeat, 10000);
            const unsubscribe = subscribeSessionEvents(connectionSessionId, push);
            cleanup = () => {
              clearInterval(heartbeatInterval);
              unsubscribe();
            };
          },
          cancel() {
            cleanup?.();
            // 不在此断开 DB：SSE 可能因网络/代理短暂断开，断会话会导致误杀。释放连接由前端 pagehide → db/disconnect。
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        });
      },
    },
  };

  return routes;
}
