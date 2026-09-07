import { Context, Effect, Scope } from "effect"
import type { SshTunnelError } from "../core/errors"
import type { ConnectParams } from "../adapters/shared/types"

export interface TunnelResult {
  readonly localPort: number
  readonly close: () => Effect.Effect<void, never>
}

export interface SshTunnelService {
  createTunnel(params: ConnectParams): Effect.Effect<TunnelResult, SshTunnelError, Scope.Scope>
  closeTunnel(localPort: number): Effect.Effect<void, never>
}

export const SshTunnelService = Context.Service<SshTunnelService>("SshTunnelService")
