/**
 * tRPC HTTP 适配器
 * 将 tRPC router 集成到 Hono HTTP 服务器中（Web 环境）
 *
 * 使用标准 fetchRequestHandler（与 VSCode messenger 路径 backend/api-handlers-vscode.ts 一致）。
 * 默认运行时为 Web 文件加密 AppRuntime（见 backend/trpc/server.ts 的 setTrpcRuntime）。
 */

import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './server';

/**
 * Hono 中间件：处理 /api/trpc 请求
 */
export function trpcMiddleware() {
  return (c: any) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: () => ({}),
    });
}
