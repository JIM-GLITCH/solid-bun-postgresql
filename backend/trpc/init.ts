/**
 * tRPC 初始化
 * 创建 tRPC 实例，配置中间件与错误格式
 */

import { initTRPC } from '@trpc/server';
import type { Context } from './context';
import { SubscriptionRequiredError } from '../subscription-license';

const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const subscriptionRequired =
      error.cause instanceof SubscriptionRequiredError ||
      (error.cause instanceof Error && error.cause.name === 'SubscriptionRequiredError');
    return {
      ...shape,
      data: {
        ...shape.data,
        // 供前端 tRPC 错误映射转为 SubscriptionRequiredError
        subscriptionRequired: subscriptionRequired || undefined,
      },
    };
  },
});

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
