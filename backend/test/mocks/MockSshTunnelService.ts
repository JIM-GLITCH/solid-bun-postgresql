/**
 * Mock SshTunnelService for testing
 * 匹配真实的 SshTunnelService 接口：createTunnel 返回 TunnelResult（含 Scope 生命周期），
 * closeTunnel 以本地端口为键。
 */

import { Effect, Layer, Scope } from "effect"
import { SshTunnelService } from "../../services/SshTunnelService"
import type { TunnelResult } from "../../services/SshTunnelService"
import type { SshTunnelError } from "../../core/errors"
import type { ConnectParams } from "../../adapters/shared/types"

class MockSshTunnelService implements SshTunnelService {
  private tunnels = new Map<number, { params: ConnectParams }>()

  createTunnel = (
    params: ConnectParams,
  ): Effect.Effect<TunnelResult, SshTunnelError, Scope.Scope> => {
    const self = this
    return Effect.acquireRelease(
      Effect.sync(() => {
        const localPort = 15000 + Math.floor(Math.random() * 1000)
        self.tunnels.set(localPort, { params })
        return {
          localPort,
          close: () =>
            Effect.sync(() => {
              self.tunnels.delete(localPort)
            }),
        } satisfies TunnelResult
      }),
      (result) =>
        Effect.sync(() => {
          self.tunnels.delete(result.localPort)
        }),
    )
  }

  closeTunnel = (localPort: number): Effect.Effect<void, never> => {
    const self = this
    return Effect.sync(() => {
      self.tunnels.delete(localPort)
    })
  }
}

export const MockSshTunnelServiceLayer = Layer.succeed(
  SshTunnelService,
  new MockSshTunnelService(),
)
