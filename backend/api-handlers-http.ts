/**
 * 后端 API 处理器 - Web 实现：HTTP + SSE
 * 用于 standalone (Bun) 构建
 */

import type { ApiMethod, ApiRequestPayload } from "../shared/src";
import {
  handleApiRequest,
  getSession,
  subscribeSessionEvents,
  type SSEMessage,
} from "./api-core";

type RouteHandler = (req: Request) => Response | Promise<Response>;

/** 通用 POST 处理器：解析 JSON，调用 handleApiRequest，统一错误处理 */
function postApi<M extends ApiMethod>(
  method: M,
  opts?: { useSucess?: boolean; status200?: boolean }
): RouteHandler {
  const { useSucess = false, status200 = false } = opts ?? {};
  return async (req: Request) => {
    try {
      const data = (await req.json()) as ApiRequestPayload[M];
      const result = await handleApiRequest(method, data);
      return Response.json(result);
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : String(e);
      const body = useSucess ? { error: err, sucess: false } : { error: err, success: false };
      return Response.json(body, { status: status200 ? 200 : 500 });
    }
  };
}

/** POST API 路由配置：path -> method，少数需特殊错误格式的单独标注 */
const POST_ROUTES: Array<{ path: string; method: ApiMethod; useSucess?: boolean; status200?: boolean }> = [
  { path: "/api/connections/list", method: "connections/list" },
  { path: "/api/connections/save", method: "connections/save" },
  { path: "/api/connections/delete", method: "connections/delete" },
  { path: "/api/connections/connect", method: "connections/connect", useSucess: true, status200: true },
  { path: "/api/connect-postgres", method: "connect-postgres", useSucess: true, status200: true },
  { path: "/api/disconnect-postgres", method: "disconnect-postgres" },
  { path: "/api/postgres/query-stream", method: "postgres/query-stream" },
  { path: "/api/postgres/query-stream-more", method: "postgres/query-stream-more" },
  { path: "/api/postgres/save-changes", method: "postgres/save-changes" },
  { path: "/api/postgres/cancel-query", method: "postgres/cancel-query" },
  { path: "/api/postgres/query-readonly", method: "postgres/query-readonly" },
  { path: "/api/postgres/schemas", method: "postgres/schemas" },
  { path: "/api/postgres/tables", method: "postgres/tables" },
  { path: "/api/postgres/columns", method: "postgres/columns" },
  { path: "/api/postgres/indexes", method: "postgres/indexes" },
  { path: "/api/postgres/foreign-keys", method: "postgres/foreign-keys" },
  { path: "/api/postgres/data-types", method: "postgres/data-types" },
  { path: "/api/postgres/execute-ddl", method: "postgres/execute-ddl" },
  { path: "/api/postgres/table-ddl", method: "postgres/table-ddl" },
  { path: "/api/postgres/query", method: "postgres/query", useSucess: true },
  { path: "/api/postgres/debug/check", method: "postgres/debug/check" },
  { path: "/api/postgres/debug/functions", method: "postgres/debug/functions" },
  { path: "/api/postgres/debug/start-direct", method: "postgres/debug/start-direct" },
  { path: "/api/postgres/debug/continue", method: "postgres/debug/continue" },
  { path: "/api/postgres/debug/step-into", method: "postgres/debug/step-into" },
  { path: "/api/postgres/debug/step-over", method: "postgres/debug/step-over" },
  { path: "/api/postgres/debug/abort", method: "postgres/debug/abort" },
  { path: "/api/postgres/debug/state", method: "postgres/debug/state" },
  { path: "/api/postgres/debug/set-breakpoint", method: "postgres/debug/set-breakpoint" },
  { path: "/api/postgres/debug/drop-breakpoint", method: "postgres/debug/drop-breakpoint" },
];

/** 创建 HTTP 格式的 API 路由（Bun.serve routes） */
export function createApiRoutes(): Record<
  string,
  { GET?: (req: unknown) => Response | Promise<Response>; POST?: RouteHandler }
> {
  const routes: Record<string, { GET?: (req: unknown) => Response | Promise<Response>; POST?: RouteHandler }> = {
    "/api/hello": { GET: () => Response.json({ message: "Hello from API" }) },

    "/api/events": {
      GET: (req: unknown) => {
        const url = new URL((req as Request).url);
        const connectionId = url.searchParams.get("connectionId");
        if (!connectionId) return new Response("缺少 connectionId", { status: 400 });
        const session = getSession(connectionId);
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
            const unsubscribe = subscribeSessionEvents(connectionId, push);
            cleanup = () => {
              clearInterval(heartbeatInterval);
              unsubscribe();
            };
          },
          cancel() {
            cleanup?.();
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
        });
      },
    },
  };

  for (const { path, method, useSucess, status200 } of POST_ROUTES) {
    routes[path] = { POST: postApi(method, { useSucess, status200 }) };
  }
  return routes;
}
