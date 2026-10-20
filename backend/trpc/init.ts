/**
 * tRPC 初始化
 * 创建 tRPC 实例，配置中间件与错误格式
 */

import { initTRPC } from '@trpc/server';
import type { Context } from './context';

const t = initTRPC.context<Context>().create({});

/**
 * 可选：添加认证中间件
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  // 这里可以添加认证逻辑
  // if (!ctx.session) {
  //   throw new TRPCError({ code: 'UNAUTHORIZED' });
  // }
  return next();
});

export { t };
