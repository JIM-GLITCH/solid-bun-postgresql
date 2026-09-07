/**
 * subscription/* 路由：功能断言与账户信息。
 * 返回值形状与旧 api-core 保持兼容（{ success: true } / { loggedIn, user? }）。
 */

import { Effect } from "effect"
import { SubscriptionService } from "../../services/SubscriptionService"
import type { SubscriptionRequiredError } from "../../core/errors"
import type { ApiRequestPayload } from "../../../shared/src"

const ALLOWED_FEATURES = new Set(["visual-query-builder", "table-designer"])

export const handleSubscriptionAssert = (
  payload: ApiRequestPayload["subscription/assert"],
): Effect.Effect<any, SubscriptionRequiredError | Error, SubscriptionService> =>
  Effect.gen(function* () {
    const feature = (payload as { feature?: string }).feature
    if (!feature || !ALLOWED_FEATURES.has(feature)) {
      return yield* Effect.fail(new Error("无效的功能标识"))
    }
    const svc = yield* SubscriptionService
    yield* svc.assertFeature(feature as "visual-query-builder" | "table-designer")
    return { success: true }
  })

export const handleSubscriptionAccount = (): Effect.Effect<any, SubscriptionRequiredError, SubscriptionService> =>
  Effect.gen(function* () {
    const svc = yield* SubscriptionService
    const account = yield* svc.getAccount(null)
    if (!account.loggedIn) return { loggedIn: false }
    return { loggedIn: true, user: { id: account.userId, email: account.email ?? null } }
  })
