/**
 * 后端 API 处理器 - Web 实现：HTTP + SSE
 * 用于 standalone (Node + Hono) 构建
 */

import type { ApiMethod, ApiRequestPayload, SSEMessage } from "../shared/src";
import { handleApiRequest, getSession, subscribeSessionEvents } from "./api-core";

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
  { path: "/api/db/connect", method: "db/connect", useSucess: true, status200: true },
  { path: "/api/db/disconnect", method: "db/disconnect" },
  { path: "/api/db/query", method: "db/query", useSucess: true },
  { path: "/api/db/capabilities", method: "db/capabilities" },
  { path: "/api/db/query-stream", method: "db/query-stream" },
  { path: "/api/db/query-stream-more", method: "db/query-stream-more" },
  { path: "/api/db/save-changes", method: "db/save-changes" },
  { path: "/api/db/cancel-query", method: "db/cancel-query" },
  { path: "/api/db/query-readonly", method: "db/query-readonly" },
  { path: "/api/db/explain", method: "db/explain" },
  { path: "/api/db/schemas", method: "db/schemas" },
  { path: "/api/db/tables", method: "db/tables" },
  { path: "/api/db/columns", method: "db/columns" },
  { path: "/api/db/indexes", method: "db/indexes" },
  { path: "/api/db/primary-keys", method: "db/primary-keys" },
  { path: "/api/db/unique-constraints", method: "db/unique-constraints" },
  { path: "/api/db/foreign-keys", method: "db/foreign-keys" },
  { path: "/api/db/data-types", method: "db/data-types" },
  { path: "/api/db/execute-ddl", method: "db/execute-ddl" },
  { path: "/api/db/table-ddl", method: "db/table-ddl" },
  { path: "/api/db/function-ddl", method: "db/function-ddl" },
  { path: "/api/db/schema-dump", method: "db/schema-dump" },
  { path: "/api/db/database-dump", method: "db/database-dump" },
  { path: "/api/db/import-rows", method: "db/import-rows" },
  { path: "/api/db/table-comment", method: "db/table-comment" },
  { path: "/api/db/check-constraints", method: "db/check-constraints" },
  { path: "/api/db/partition-info", method: "db/partition-info" },
  { path: "/api/db/explain-text", method: "db/explain-text" },
  { path: "/api/db/pg-stat-overview", method: "db/pg-stat-overview" },
  { path: "/api/db/manage-backend", method: "db/manage-backend" },
  { path: "/api/db/installed-extensions", method: "db/installed-extensions" },
  { path: "/api/ai/config/get", method: "ai/config/get" },
  { path: "/api/ai/config/set", method: "ai/config/set" },
  { path: "/api/ai/key/delete", method: "ai/key/delete" },
  { path: "/api/ai/test-connection", method: "ai/test-connection" },
  { path: "/api/ai/sql-edit", method: "ai/sql-edit" },
  { path: "/api/ai/prompt-build", method: "ai/prompt-build" },
  { path: "/api/ai/prompt-build-diff", method: "ai/prompt-build-diff" },
  // backward-compat aliases (older/cached frontend typo or underscore variant)
  { path: "/api/db/pg_stat-overview", method: "db/pg-stat-overview" },
  { path: "/api/db/pg_stat-overciew", method: "db/pg-stat-overview" },
  { path: "/api/db/pg-stat-overciew", method: "db/pg-stat-overview" },
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
            // 不在此断开 DB：SSE 可能因网络/代理短暂断开，断会话会导致误杀。释放连接由前端 pagehide → db/disconnect。
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
