import type { PostgresLoginParams } from "../shared/src";
import mysql from "mysql2/promise";
import { createSshTunnel } from "./ssh-tunnel";

const DEFAULT_SSH_CONNECTION_TIMEOUT_MS = 30000;

function getConnectionTimeoutMs(params: PostgresLoginParams): number {
  if (!params.sshEnabled) return 10000;
  const sec = params.connectionTimeoutSec;
  return sec != null && sec > 0 ? sec * 1000 : DEFAULT_SSH_CONNECTION_TIMEOUT_MS;
}

/** mysql2 连接池可用配置（隧道模式下 host 可为 undefined，与 PG 一致走本机映射端口） */
export interface MysqlDbConfig {
  host?: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectTimeout?: number;
}

export interface GetMysqlDbConfigResult {
  config: MysqlDbConfig;
  closeTunnel?: () => Promise<void>;
  sshEnabled: boolean;
}

export async function getMysqlDbConfig(params: PostgresLoginParams): Promise<GetMysqlDbConfigResult> {
  const baseConfig: MysqlDbConfig = {
    host: params.host ?? "localhost",
    port: Number(params.port ?? 3306),
    // 留空：只连到实例，不指定默认库（与测试连接等行为一致）
    database: String(params.database ?? "").trim(),
    user: params.username,
    password: params.password ?? "",
    connectTimeout: getConnectionTimeoutMs(params),
  };

  if (!params.sshEnabled) {
    return { config: baseConfig, sshEnabled: false };
  }

  try {
    const tunnel = await createSshTunnel(params);
    return {
      config: {
        ...baseConfig,
        host: undefined,
        port: tunnel.localPort,
      },
      closeTunnel: tunnel.close,
      sshEnabled: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|expired|timed out/i.test(msg)) {
      throw new Error("SSH 隧道连接超时，请检查跳板机地址、端口及网络");
    }
    throw err;
  }
}

export function createMysqlPool(db: GetMysqlDbConfigResult): mysql.Pool {
  return mysql.createPool({
    host: db.config.host,
    port: db.config.port,
    database: db.config.database,
    user: db.config.user,
    password: db.config.password,
    connectTimeout: db.config.connectTimeout,
    waitForConnections: true,
    connectionLimit: db.sshEnabled ? 2 : 6,
    queueLimit: 0,
  });
}
