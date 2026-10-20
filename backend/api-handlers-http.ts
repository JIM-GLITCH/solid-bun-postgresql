/**
 * Standalone / Web 的**最小** HTTP 端点。
 *
 * 业务 RPC 已全部由 tRPC 承载（`/api/trpc/*`），旧的两条路径已删除：
 * - `POST /api/${method}`（HTTP RPC 分发）
 * - `GET  /api/events`（SSE 事件流，现为 `db.onConnectionEvents` 订阅）
 *
 * 仅保留 tRPC 无法表达的一个场景：页面卸载时的 `keepalive` 断开请求
 * （需要同步发起普通 fetch，见前端 `disconnectPostgresOnPageUnload`）。
 */

import { disconnectConnection } from "./api-core";

export const DB_DISCONNECT_PATH = "/api/db/disconnect";

/**
 * 同源校验：仅接受来自本服务自身的请求（页面卸载 keepalive 的场景 Origin/Host 一致）。
 * connectionId 的 sessionId 段由客户端自选，无此校验时任意站点可冒充断开他人会话。
 */
function isSameOriginRequest(req: Request): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  // 两者都没有（如部分原生客户端）：放行
  if (!origin && !referer) return true;
  let ownHost: string;
  try {
    ownHost = new URL(req.url).host;
  } catch {
    return false;
  }
  const sameHost = (value: string): boolean => {
    try {
      return new URL(value).host === ownHost;
    } catch {
      return false;
    }
  };
  if (origin && sameHost(origin)) return true;
  if (referer && sameHost(referer)) return true;
  return false;
}

/** `POST /api/db/disconnect`：页面卸载时的 keepalive 断开（响应无人消费，失败不重试）。 */
export async function handleDbDisconnectBeacon(req: Request): Promise<Response> {
  try {
    if (!isSameOriginRequest(req)) {
      return new Response("Cross-origin request rejected", { status: 403 });
    }
    const payload = (await req.json()) as { connectionId?: string; dbType?: string };
    if (!payload?.connectionId) {
      return new Response("缺少 connectionId", { status: 400 });
    }
    // 旧实现经 api-core 的 handleApiRequest 分发；该函数已随 HTTP RPC 移除，
    // 直接调用连接层断开入口（api-core 自 db/sessions 再导出）。
    await disconnectConnection(payload.connectionId);
    return Response.json({ success: true });
  } catch (e: unknown) {
    const err = e instanceof Error ? e.message : String(e);
    return Response.json({ success: false, error: err }, { status: 500 });
  }
}
