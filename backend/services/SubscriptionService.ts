import { Context, Effect } from "effect"
import type { SubscriptionRequiredError } from "../core/errors"

export type SubscriptionStatus = "active" | "expired" | "none"

export interface AccountInfo {
  userId: string
  email?: string
  plan?: string
  expiresAt?: number
  loggedIn: boolean
}

export interface SubscriptionService {
  validateToken(token: string | null): Effect.Effect<SubscriptionStatus, SubscriptionRequiredError>
  getAccount(token: string | null): Effect.Effect<AccountInfo, SubscriptionRequiredError>
  assertFeature(feature: "visual-query-builder" | "table-designer", token?: string | null): Effect.Effect<void, SubscriptionRequiredError>
}

export const SubscriptionService = Context.Service<SubscriptionService>("SubscriptionService")
