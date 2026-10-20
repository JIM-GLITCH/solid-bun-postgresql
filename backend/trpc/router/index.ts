/**
 * tRPC 主 Router
 * 整合所有子 router
 */

import { t } from '../init';
import { connectionsRouter } from './connections';
import { dbRouter } from './db';
import { queryHistoryRouter } from './query-history';
import { aiRouter } from './ai';
import { hostRouter } from './host';

/**
 * 应用主 Router —— 前端唯一的调用面。
 *
 * `host` 是「宿主能力」router：服务端默认不可用，由宿主（VS Code 扩展）在
 * `createWebviewRpcBridge` 里用 procedure override 实现真实能力。
 */
export const appRouter = t.router({
  connections: connectionsRouter,
  db: dbRouter,
  queryHistory: queryHistoryRouter,
  ai: aiRouter,
  host: hostRouter,
});

/**
 * 导出 Router 类型，供前端使用
 */
export type AppRouter = typeof appRouter;
