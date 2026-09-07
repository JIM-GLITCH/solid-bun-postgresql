/**
 * Test Context for Effect-based testing
 * 提供组合好的 mock Layer，供测试用 `Effect.provide(TestLayer)` 注入。
 */

import { Effect, Layer } from "effect"
import { MockSessionStoreLayer } from "./mocks/MockSessionStore"
import { MockSshTunnelServiceLayer } from "./mocks/MockSshTunnelService"
import { MockAiServiceLayer } from "./mocks/MockAiService"
import { MockStorageServicesLayer } from "./mocks/MockStorageServices"
import { SubscriptionService } from "../services/SubscriptionService"
import type { SubscriptionStatus, AccountInfo } from "../services/SubscriptionService"
import { LicenseService } from "../services/LicenseService"
import type { LicenseInfo } from "../services/LicenseService"
import type { SubscriptionRequiredError } from "../core/errors"

// Mock subscription service（匹配 SubscriptionService 接口）
class MockSubscriptionService implements SubscriptionService {
  validateToken = (_token: string | null): Effect.Effect<SubscriptionStatus, SubscriptionRequiredError> =>
    Effect.succeed("active" as SubscriptionStatus)

  getAccount = (_token: string | null): Effect.Effect<AccountInfo, SubscriptionRequiredError> =>
    Effect.succeed({
      userId: "test-user",
      email: "test@example.com",
      plan: "pro",
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
      loggedIn: true,
    } satisfies AccountInfo)

  assertFeature = (
    _feature: "visual-query-builder" | "table-designer",
    _token?: string | null,
  ): Effect.Effect<void, SubscriptionRequiredError> => Effect.void
}

// Mock license service（匹配 LicenseService 接口）
class MockLicenseService implements LicenseService {
  validate = (): Effect.Effect<LicenseInfo, never> =>
    Effect.succeed({
      valid: true,
      features: ["all"],
      expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    } satisfies LicenseInfo)

  checkFeature = (_feature: string): Effect.Effect<boolean, never> => Effect.succeed(true)

  assertFeature = (_feature: string): Effect.Effect<void, SubscriptionRequiredError> => Effect.void
}

export const MockSubscriptionServiceLayer = Layer.succeed(
  SubscriptionService,
  new MockSubscriptionService(),
)

export const MockLicenseServiceLayer = Layer.succeed(LicenseService, new MockLicenseService())

// Combined test layer with all mock services
export const TestLayer = Layer.mergeAll(
  MockSessionStoreLayer,
  MockSshTunnelServiceLayer,
  MockAiServiceLayer,
  MockStorageServicesLayer,
  MockSubscriptionServiceLayer,
  MockLicenseServiceLayer,
)

// Run an effect with test context
export const runTest = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> =>
  effect.pipe(Effect.provide(TestLayer))

// Run an effect with test context and return the result
export const runTestEffect = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(runTest(effect))
