import { Context, Effect } from "effect"
import type { SubscriptionRequiredError } from "../core/errors"

export interface LicenseInfo {
  valid: boolean
  features: string[]
  expiresAt?: number
}

export interface LicenseService {
  validate(): Effect.Effect<LicenseInfo, never>
  checkFeature(feature: string): Effect.Effect<boolean, never>
  assertFeature(feature: string): Effect.Effect<void, SubscriptionRequiredError>
}

export const LicenseService = Context.Service<LicenseService>("LicenseService")
