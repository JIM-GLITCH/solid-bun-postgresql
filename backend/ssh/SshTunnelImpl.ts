/**
 * SSH Tunnel Effect 实现
 *
 * 用 Effect.acquireRelease 包装现有 ssh-tunnel.ts 的 ssh2 逻辑，
 * 确保隧道资源（server + conn）在 Scope 释放时被正确关闭。
 */

import { Effect, Layer, Scope } from "effect"
import { Client } from "ssh2"
import { createServer } from "net"
import { SshTunnelError, makeErrorContext } from "../core/errors"
import { sanitizeHost } from "../core/sanitize"
import { SshTunnelService, type TunnelResult } from "../services/SshTunnelService"
import type { ConnectParams } from "../adapters/shared/types"

/**
 * 使用 Effect.acquireRelease 包装 SSH 隧道创建，确保资源正确释放。
 *
 * - Acquire: 建立 SSH 连接并监听本地端口
 * - Release: 关闭 TCP server 和 SSH 连接
 */
export const createSshTunnelEffect = (
  params: ConnectParams
): Effect.Effect<TunnelResult, SshTunnelError, Scope.Scope> =>
  Effect.acquireRelease(
    // ── Acquire ──────────────────────────────────────────────────────────────
    Effect.callback<TunnelResult, SshTunnelError>((resume) => {
      const { sshHost, sshPort, sshUsername, sshPassword, sshPrivateKey, host, port } = params

      // 必要参数校验
      if (!sshHost || !sshUsername) {
        resume(
          Effect.fail(
            new SshTunnelError({
              context: makeErrorContext("ssh.validate"),
              sshHost: sanitizeHost(sshHost),
              sshPort: sshPort ?? 22,
              phase: "connect",
            })
          )
        )
        return
      }

      if (!sshPrivateKey && !sshPassword) {
        resume(
          Effect.fail(
            new SshTunnelError({
              context: makeErrorContext("ssh.auth"),
              sshHost: sanitizeHost(sshHost),
              sshPort: sshPort ?? 22,
              phase: "auth",
            })
          )
        )
        return
      }

      const conn = new Client()
      const remoteAddr = (host ?? "localhost").trim()
      const remotePort = port ?? 5432

      // TCP server：每个入站连接通过 SSH forwardOut 转发
      const server = createServer((sock) => {
        conn.forwardOut("", 0, remoteAddr, remotePort, (err, stream) => {
          if (err) {
            sock.destroy()
            return
          }
          sock.pipe(stream).pipe(sock)
          stream.on("close", () => sock.destroy())
          sock.on("close", () => stream.end())
        })
      })

      server.on("listening", () => {
        const localPort = (server.address() as { port: number }).port
        // 返回 TunnelResult；close() 在 Release 阶段调用
        resume(
          Effect.succeed({
            localPort,
            close: () =>
              Effect.callback<void, never>((res) => {
                server.close(() => {
                  conn.end()
                  res(Effect.void)
                })
              }),
          })
        )
      })

      server.on("error", (_err) => {
        conn.end()
        resume(
          Effect.fail(
            new SshTunnelError({
              context: makeErrorContext("ssh.forward"),
              sshHost: sanitizeHost(sshHost),
              sshPort: sshPort ?? 22,
              phase: "forward",
            })
          )
        )
      })

      conn.on("ready", () => {
        server.listen(0, "127.0.0.1")
      })

      conn.on("error", (err) => {
        server.close()
        const msg = err?.message ?? ""
        const phase = /auth|Authentication/i.test(msg)
          ? ("auth" as const)
          : ("connect" as const)
        resume(
          Effect.fail(
            new SshTunnelError({
              context: makeErrorContext("ssh.connect"),
              sshHost: sanitizeHost(sshHost),
              sshPort: sshPort ?? 22,
              phase,
            })
          )
        )
      })

      // SSH 连接配置
      const sshConfig: Record<string, unknown> = {
        host: sshHost,
        port: sshPort ?? 22,
        username: sshUsername,
        readyTimeout: 30000,
      }

      if (process.env.NODE_ENV !== "production") {
        sshConfig.debug = (s: string) => console.log("[SSH]", s)
      }

      if (sshPrivateKey) {
        sshConfig.privateKey = String(sshPrivateKey).trim().replace(/\r\n/g, "\n")
      } else {
        sshConfig.password = sshPassword
      }

      conn.connect(sshConfig)
    }),
    // ── Release ───────────────────────────────────────────────────────────────
    (result) => result.close()
  )

/**
 * SshTunnelService 的生产实现 Layer。
 *
 * - createTunnel: 通过 createSshTunnelEffect 建立隧道，生命周期由 Scope 管理
 * - closeTunnel:  隧道关闭由 Scope/acquireRelease 负责，此处为空操作
 */
export const SshTunnelServiceLive: Layer.Layer<SshTunnelService> = Layer.succeed(
  SshTunnelService,
  SshTunnelService.of({
    createTunnel: (params) => createSshTunnelEffect(params),
    closeTunnel: (_localPort) => Effect.void,
  })
)
