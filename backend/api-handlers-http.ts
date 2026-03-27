/**
 * 后端 API 处理器 - Web 实现：HTTP + SSE
 * 用于 standalone (Node + Hono) 构建
 */

import type { ApiMethod, ApiRequestPayload } from "../shared/src";
import {
  handleApiRequest,
  getSession,
  subscribeSessionEvents,
  disconnectConnection,
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
  { path: "/api/connections/update-meta", method: "connections/update-meta" },
  { path: "/api/connections/reorder", method: "connections/reorder" },
  { path: "/api/connections/get-params", method: "connections/get-params" },
  { path: "/api/connections/connect", method: "connections/connect", useSucess: true, status200: true },
  { path: "/api/query-history/add", method: "query-history/add" },
  { path: "/api/query-history/search", method: "query-history/search" },
  { path: "/api/query-history/delete", method: "query-history/delete" },
  { path: "/api/query-history/clear", method: "query-history/clear" },
  { path: "/api/connect-postgres", method: "connect-postgres", useSucess: true, status200: true },
  { path: "/api/disconnect-postgres", method: "disconnect-postgres" },
  { path: "/api/postgres/query-stream", method: "postgres/query-stream" },
  { path: "/api/postgres/query-stream-more", method: "postgres/query-stream-more" },
  { path: "/api/postgres/save-changes", method: "postgres/save-changes" },
  { path: "/api/postgres/cancel-query", method: "postgres/cancel-query" },
  { path: "/api/postgres/query-readonly", method: "postgres/query-readonly" },
  { path: "/api/postgres/explain", method: "postgres/explain" },
  { path: "/api/postgres/schemas", method: "postgres/schemas" },
  { path: "/api/postgres/tables", method: "postgres/tables" },
  { path: "/api/postgres/columns", method: "postgres/columns" },
  { path: "/api/postgres/indexes", method: "postgres/indexes" },
  { path: "/api/postgres/primary-keys", method: "postgres/primary-keys" },
  { path: "/api/postgres/unique-constraints", method: "postgres/unique-constraints" },
  { path: "/api/postgres/foreign-keys", method: "postgres/foreign-keys" },
  { path: "/api/postgres/data-types", method: "postgres/data-types" },
  { path: "/api/postgres/execute-ddl", method: "postgres/execute-ddl" },
  { path: "/api/postgres/table-ddl", method: "postgres/table-ddl" },
  { path: "/api/postgres/function-ddl", method: "postgres/function-ddl" },
  { path: "/api/postgres/schema-dump", method: "postgres/schema-dump" },
  { path: "/api/postgres/database-dump", method: "postgres/database-dump" },
  { path: "/api/postgres/import-rows", method: "postgres/import-rows" },
  { path: "/api/postgres/query", method: "postgres/query", useSucess: true },
  { path: "/api/postgres/table-comment", method: "postgres/table-comment" },
  { path: "/api/postgres/check-constraints", method: "postgres/check-constraints" },
  { path: "/api/postgres/partition-info", method: "postgres/partition-info" },
  { path: "/api/postgres/explain-text", method: "postgres/explain-text" },
  { path: "/api/postgres/pg-stat-overview", method: "postgres/pg-stat-overview" },
  { path: "/api/postgres/manage-backend", method: "postgres/manage-backend" },
  { path: "/api/postgres/installed-extensions", method: "postgres/installed-extensions" },
  // backward-compat aliases (older/cached frontend typo or underscore variant)
  { path: "/api/postgres/pg_stat-overview", method: "postgres/pg-stat-overview" },
  { path: "/api/postgres/pg_stat-overciew", method: "postgres/pg-stat-overview" },
  { path: "/api/postgres/pg-stat-overciew", method: "postgres/pg-stat-overview" },
];

/** 创建 HTTP 格式的 API 路由（供 Hono 使用） */
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
            // 标签页关闭时 SSE 断开，释放 connectionMap 中的资源（pg 连接、SSH 隧道等）
            disconnectConnection(connectionId).catch(() => {});
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
