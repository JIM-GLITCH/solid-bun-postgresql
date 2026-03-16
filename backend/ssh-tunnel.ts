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
  if (process.env.NODE_ENV !== "production") {
    sshConfig.debug = (s: string) => console.log("[SSH]", s);
  }
  if (sshPrivateKey) {
    sshConfig.privateKey = (sshPrivateKey as string).trim().replace(/\r\n/g, "\n");
  } else if (sshPassword) {
    sshConfig.password = sshPassword;
  } else {
    return Promise.reject(new Error("SSH 认证需要 sshPassword 或 sshPrivateKey"));
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    const server = createServer((sock) => {
      conn.forwardOut("", 0, remoteAddr, remotePort, (err, stream) => {
        if (err) {
          sock.destroy();
          return;
        }
        sock.pipe(stream).pipe(sock);
        stream.on("close", () => sock.destroy());
        sock.on("close", () => stream.end());
      });
    });

    server.on("listening", () => {
      const localPort = (server.address() as { port: number }).port;
      resolve({
        localPort,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => {
              conn.end();
              done();
            });
          }),
      });
    });

    server.on("error", (err) => {
      conn.end();
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
      const msg = err?.message ?? String(err);
      if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(msg)) {
        reject(new Error(`SSH 隧道建立失败: ${msg}（请检查跳板机地址、端口及数据库 host）`));
      } else {
        reject(err);
      }
    });

    conn.connect(sshConfig);
  });
}
