/**
 * Subscription Router
 * 订阅校验 / 账号信息 / 账号登录态
 */

import { t } from '../init';
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { TRPCError } from '@trpc/server';
import { handleApiRequest } from '../../api-core';
import {
  assertSubscriptionLicensed,
  parseSubscriptionAccessToken,
} from '../../subscription-license';

/** 账号状态（与 `shared/src` 的 `AccountStateMessage` 一致） */
export type SubscriptionAccount = {
  loggedIn: boolean;
  user?: { id?: number; email?: string | null };
};

/** 宿主专属动作：服务端不认识这两件事（只有扩展宿主能打开外部登录页 / 清扩展侧凭据） */
function unsupported(action: string): never {
  throw new TRPCError({
    code: 'METHOD_NOT_SUPPORTED',
    message: `当前环境不支持该动作：${action}`,
  });
}

export const subscriptionRouter = t.router({
  /**
   * 进入付费功能前做一次显式 assert（令牌来源：HttpOnly Cookie（Web）或 Authorization: Bearer）。
   * VSCode 下由 extension host 用 `procedureOverrides` 覆盖（改用扩展侧凭据校验）。
   */
  assert: t.procedure
    .input(z.object({ feature: z.enum(['visual-query-builder', 'table-designer']) }))
    .mutation(async ({ input, ctx }) => {
      await assertSubscriptionLicensed(ctx.req ? parseSubscriptionAccessToken(ctx.req) : null);
      return handleApiRequest('subscription/assert', input);
    }),

  /** 当前账号状态 */
  account: t.procedure.query(
    () => handleApiRequest('subscription/account', {}) as Promise<SubscriptionAccount>
  ),

  /**
   * 打开订阅站登录页（宿主动作：扩展在系统浏览器打开）。
   * 服务端默认「不支持」；VSCode 由 extension host 覆盖。
   */
  openLogin: t.procedure.mutation((): { success: boolean } => unsupported('subscription.openLogin')),

  /**
   * 退出订阅账号并清理宿主侧凭据。
   * 服务端默认「不支持」；VSCode 由 extension host 覆盖。
   */
  logout: t.procedure.mutation((): { success: boolean } => unsupported('subscription.logout')),

  /**
   * 账号登录态推送（宿主登录/退出后主动推送）。
   * 服务端无推送源 → 永不触发的订阅；VSCode 由 extension host 覆盖为真实事件流。
   */
  onAccountState: t.procedure.subscription(() => observable<SubscriptionAccount>(() => {
    /* 服务端不产生账号状态事件 */
  })),
});
