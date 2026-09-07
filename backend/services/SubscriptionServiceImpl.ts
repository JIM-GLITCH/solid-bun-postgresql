import { Effect, Layer } from "effect"
import { SubscriptionRequiredError, makeErrorContext } from "../core/errors"
import type { AccountInfo, SubscriptionStatus } from "./SubscriptionService"
import { SubscriptionService } from "./SubscriptionService"
import { getStoredSubscriptionToken } from "../subscription-token-store"

const isSubscriptionCheckDisabled = (): boolean => {
  for (const raw of [process.env.SUBSCRIPTION_OFF, process.env.DBPLAYER_SUBSCRIPTION_OFF]) {
    const v = (raw ?? "").trim().toLowerCase()
    if (v === "1" || v === "true" || v === "yes") return true
  }
  return false
}

const getSubscriptionApiBase = (): string => {
  const v = (process.env.SUBSCRIPTION_API_URL ?? "").trim()
  return (v || "https://api.dbplayer.top").replace(/\/$/, "")
}

const parseJwtAccount = (token: string): AccountInfo => {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return { userId: "unknown", loggedIn: false }
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf-8")) as Record<string, unknown>
    return {
      userId: String(payload.sub ?? payload.account ?? payload.email ?? "unknown"),
      email: payload.email ? String(payload.email) : undefined,
      plan: payload.plan ? String(payload.plan) : undefined,
      expiresAt: payload.exp && typeof payload.exp === "number" ? payload.exp * 1000 : undefined,
      loggedIn: true,
    }
  } catch {
    return { userId: "unknown", loggedIn: false }
  }
}

const makeSubscriptionError = (feature: string): SubscriptionRequiredError =>
  new SubscriptionRequiredError({
    context: makeErrorContext("subscription"),
    feature,
  })

const verifyRemote = (apiBase: string, token: string): Effect.Effect<boolean, SubscriptionRequiredError> =>
  Effect.gen(function* () {
    const base = apiBase.replace(/\/$/, "")
    const res = yield* Effect.tryPromise({
      try: () =>
        fetch(`${base}/api/verify-license`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      catch: () => makeSubscriptionError("verifyRemote"),
    })
    if (!res.ok) return false
    const data = yield* Effect.tryPromise({
      try: () => res.json(),
      catch: () => makeSubscriptionError("verifyRemote"),
    })
    return (data as { valid?: boolean }).valid === true
  })

class SubscriptionServiceImpl implements SubscriptionService {
  validateToken = (token: string | null): Effect.Effect<SubscriptionStatus, SubscriptionRequiredError> =>
    Effect.gen(function* () {
      if (isSubscriptionCheckDisabled()) return "active" as SubscriptionStatus
      const stored = typeof token === "string" ? token : getStoredSubscriptionToken()
      if (!stored) return "none" as SubscriptionStatus
      try {
        const apiBase = getSubscriptionApiBase()
        const valid = yield* verifyRemote(apiBase, stored).pipe(
          Effect.catch(() => Effect.succeed(false))
        )
        if (!valid) {
          // fallback to local exp check only
          const acc = parseJwtAccount(stored)
          if (acc.expiresAt && acc.expiresAt < Date.now()) return "expired" as SubscriptionStatus
          return acc.loggedIn ? "active" as SubscriptionStatus : "none" as SubscriptionStatus
        }
        return "active" as SubscriptionStatus
      } catch {
        return "none" as SubscriptionStatus
      }
    })

  getAccount = (token: string | null): Effect.Effect<AccountInfo, SubscriptionRequiredError> =>
    Effect.gen(function* () {
      if (isSubscriptionCheckDisabled()) {
        return {
          userId: "self-hosted",
          email: "self-hosted@localhost",
          plan: "enterprise",
          loggedIn: true,
        } satisfies AccountInfo
      }
      const stored = typeof token === "string" ? token : getStoredSubscriptionToken()
      if (!stored) return { userId: "anonymous", loggedIn: false } satisfies AccountInfo
      return parseJwtAccount(stored)
    })

  assertFeature = (
    feature: "visual-query-builder" | "table-designer",
    token?: string | null
  ): Effect.Effect<void, SubscriptionRequiredError> => {
    const self = this
    return Effect.gen(function* () {
      if (isSubscriptionCheckDisabled()) return
      const status = yield* self.validateToken(token ?? null)
      if (status !== "active") {
        return yield* Effect.fail(makeSubscriptionError(feature))
      }
    })
  }
}

export const SubscriptionServiceLive: Layer.Layer<SubscriptionService> = Layer.succeed(
  SubscriptionService,
  new SubscriptionServiceImpl()
)

export type { AccountInfo }
