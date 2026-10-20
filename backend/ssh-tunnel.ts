/**
 * SSH 隧道：本地端口转发，用于通过跳板机连接远程 PostgreSQL
 * 使用 ssh2 原生库，无 ssh2-promise/@heroku/socksv5，便于打包
 * 多跳：ssh2 支持 forwardOut + sock，可扩展
 */

import { Client } from "ssh2";
import { createServer } from "net";
import type { PostgresLoginParams } from "../shared/src";

export interface SshTunnelResult {
  localPort: number;
  close: () => Promise<void>;
}

export function createSshTunnel(params: PostgresLoginParams): Promise<SshTunnelResult> {
  const { host: pgHost, port: pgPort, sshHost, sshPort, sshUsername, sshPassword, sshPrivateKey } = params;
  if (!sshHost || !sshUsername) {
    return Promise.reject(new Error("SSH 隧道需要 sshHost 和 sshUsername"));
  }
  const remotePort = Number(pgPort ?? 5432);
  const sshPortNum = Number(sshPort ?? 22);
  const remoteAddr = (pgHost ?? "localhost").trim();
  if (!remoteAddr) {
    return Promise.reject(new Error("SSH 隧道需要数据库 host（跳板机可访问的地址，如 localhost 或内网 IP）"));
  }

  const sshConfig: Record<string, unknown> = {
    host: sshHost,
    port: sshPortNum,
    username: sshUsername,
    readyTimeout: params.connectionTimeoutSec && params.connectionTimeoutSec > 0
      ? params.connectionTimeoutSec * 1000
      : 30000,
  };
  // 开发或 PKG_DEBUG=1 时输出 SSH 调试信息，便于排查 pkg 打包后连接异常
  if (process.env.NODE_ENV !== "production" || process.env.PKG_DEBUG === "1") {
    sshConfig.debug = (s: string) => console.log("[SSH]", s);
  }
  if (sshPrivateKey) {
    sshConfig.privateKey = (sshPrivateKey as string).trim().replace(/\r\n/g, "\n");
  } else if (sshPassword) {
    sshConfig.password = sshPassword;
  } else {
    return Promise.reject(new Error("SSH 认证需要 sshPassword 或 sshPrivateKey"));
  }
  // 端口校验：Number("abc") 得 NaN，晚暴露不如早失败
  if (!Number.isInteger(remotePort) || remotePort <= 0 || remotePort > 65535) {
    return Promise.reject(new Error(`SSH 隧道的目标数据库端口无效: ${String(pgPort ?? "")}`));
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const server = createServer((sock) => {
      conn.forwardOut("", 0, remoteAddr, remotePort, (err, stream) => {
        if (err) {
          sock.destroy();
          return;
        }
        // 双向管道都必须处理 error：ssh2 channel 出错时未监听的 'error' 事件会直接崩溃进程
        sock.on("error", () => sock.destroy());
        stream.on("error", () => {
          sock.destroy();
          stream.destroy();
        });
        sock.pipe(stream).pipe(sock);
        stream.on("close", () => sock.destroy());
        sock.on("close", () => stream.end());
      });
    });

    /** 关闭隧道：先断开全部已建立的转发 socket 再停监听，并有超时兜底防止永久挂起 */
    const close = (): Promise<void> =>
      new Promise<void>((done) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          done();
        };
        // Node 18.2+：closeAllConnections 会销毁 keepalive 等空闲转发 socket，
        // 否则 server.close 的回调可能永不触发 → closeTunnel 永久 pending → 会话无法释放
        (server as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
        server.close(() => {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
          finish();
        });
        // 兜底：5s 内未能优雅关闭也强制结束，避免调用方（releaseSession）永久挂起
        setTimeout(() => {
          try {
            conn.end();
          } catch {
            /* ignore */
          }
          finish();
        }, 5000).unref?.();
      });

    server.on("listening", () => {
      const localPort = (server.address() as { port: number }).port;
      resolve({
        localPort,
        close,
      });
    });

    server.on("error", (err) => {
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      const msg = err?.message ?? String(err);
      if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(msg)) {
        reject(new Error(`SSH 隧道建立失败: ${msg}（请检查跳板机地址、端口及数据库 host）`));
      } else {
        reject(err);
      }
    });

    conn.on("ready", () => {
      server.listen(0, "127.0.0.1");
    });

    conn.on("error", (err) => {
      server.close();
      try {
        conn.end();
      } catch {
        /* ignore */
      }
      const msg = err?.message ?? String(err);
      if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(msg)) {
        reject(new Error(`SSH 隧道建立失败: ${msg}（请检查跳板机地址、端口及数据库 host）`));
      } else {
        reject(err);
      }
    });

    // ready 之后 SSH 连接意外关闭：停掉本地监听，避免隧道静默死亡后句柄泄漏
    conn.on("close", () => {
      server.close();
    });

    conn.connect(sshConfig);
  });
}
