/**
 * Effect-based LicenseService implementation
 * Provides license validation and feature checking
 */

import { Effect, Layer, Ref } from "effect"
import { LicenseService, type LicenseInfo } from "./LicenseService"
import { SubscriptionRequiredError, makeErrorContext } from "../core/errors"

interface AccountInfo {
  account: string
  plan: string
  expiresAt: number
  features: string[]
}

const isSubscriptionDisabled = (): boolean => {
  for (const raw of [process.env.SUBSCRIPTION_OFF, process.env.DBPLAYER_SUBSCRIPTION_OFF]) {
    const v = (raw ?? "").trim().toLowerCase()
    if (v === "1" || v === "true" || v === "yes") return true
  }
  return false
}

const parseJwtToken = (token: string): AccountInfo | null => {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null

    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf-8")
    ) as Record<string, unknown>

    // Check expiration
    if (payload.exp && typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
      return null
    }

    return {
      account: String(payload.account || payload.email || "unknown"),
      plan: String(payload.plan || "basic"),
      expiresAt: payload.exp && typeof payload.exp === "number" ? payload.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000,
      features: Array.isArray(payload.features) ? (payload.features as string[]) : []
    }
  } catch {
    return null
  }
}

class LicenseServiceImpl implements LicenseService {
  private readonly cachedToken: Ref.Ref<string | null>
  private readonly cachedInfo: Ref.Ref<LicenseInfo | null>

  constructor() {
    this.cachedToken = Effect.runSync(Ref.make(null as string | null))
    this.cachedInfo = Effect.runSync(Ref.make(null as LicenseInfo | null))
  }

  /** 更新缓存的 token（由 SubscriptionService 调用） */
  setToken = (token: string | null): Effect.Effect<void, never> => {
    const self = this
    return Effect.gen(function* () {
      yield* Ref.set(self.cachedToken, token)
      if (token) {
        const info = parseJwtToken(token)
        yield* Ref.set(self.cachedInfo, info ? {
          valid: true,
          features: info.features,
          expiresAt: info.expiresAt
        } : null)
      } else {
        yield* Ref.set(self.cachedInfo, null)
      }
    })
  }

  validate = (): Effect.Effect<LicenseInfo, never> => {
    const self = this
    return Effect.gen(function* () {
      // 如果订阅检查被禁用，返回企业版许可
      if (isSubscriptionDisabled()) {
        return {
          valid: true,
          features: ["all"],
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000
        } satisfies LicenseInfo
      }

      // 返回缓存的许可信息
      const cached = yield* Ref.get(self.cachedInfo)
      if (cached) return cached

      // 无缓存时返回无效许可
      return {
        valid: false,
        features: []
      } satisfies LicenseInfo
    })
  }

  checkFeature = (feature: string): Effect.Effect<boolean, never> => {
    const self = this
    return Effect.gen(function* () {
      if (isSubscriptionDisabled()) return true

      const license = yield* self.validate()
      if (!license.valid) return false

      return license.features.includes(feature) || license.features.includes("all")
    })
  }

  assertFeature = (feature: string): Effect.Effect<void, SubscriptionRequiredError> => {
    const self = this
    return Effect.gen(function* () {
      const allowed = yield* self.checkFeature(feature)
      if (!allowed) {
        return yield* Effect.fail(
          new SubscriptionRequiredError({
            context: makeErrorContext("assertFeature"),
            feature
          })
        )
      }
    })
  }
}

export const LicenseServiceLive = Layer.succeed(
  LicenseService,
  new LicenseServiceImpl()
)

export type { AccountInfo }
