import type { PostgresLoginParams } from "../shared/src";
import sql from "mssql";
import { createSshTunnel } from "./ssh-tunnel";

const DEFAULT_SSH_CONNECTION_TIMEOUT_MS = 30000;

function getConnectionTimeoutMs(params: PostgresLoginParams): number {
  if (!params.sshEnabled) return 10000;
  const sec = params.connectionTimeoutSec;
  return sec != null && sec > 0 ? sec * 1000 : DEFAULT_SSH_CONNECTION_TIMEOUT_MS;
}

/** node-mssql 连接池配置（隧道模式下 server 为本机、port 为本地映射端口） */
export interface SqlServerPoolConfig {
  server: string;
  port: number;
  user: string;
  password: string;
  database?: string;
  connectionTimeout?: number;
  pool?: { max: number; min: number; idleTimeoutMillis?: number };
  options?: {
    encrypt?: boolean;
    trustServerCertificate?: boolean;
    enableArithAbort?: boolean;
  };
}

export interface GetSqlServerDbConfigResult {
  config: SqlServerPoolConfig;
  closeTunnel?: () => Promise<void>;
  sshEnabled: boolean;
}

export async function getSqlServerDbConfig(params: PostgresLoginParams): Promise<GetSqlServerDbConfigResult> {
  const dbRaw = String(params.database ?? "").trim();
  const maxPool = params.sshEnabled ? 2 : 6;
  const base: SqlServerPoolConfig = {
    server: String(params.host ?? "localhost").trim() || "localhost",
    port: Number(params.port ?? 1433) || 1433,
    user: params.username,
    password: params.password ?? "",
    ...(dbRaw ? { database: dbRaw } : {}),
    connectionTimeout: getConnectionTimeoutMs(params),
    pool: { max: maxPool, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
  };

  if (!params.sshEnabled) {
    return { config: base, sshEnabled: false };
  }

  try {
    const tunnel = await createSshTunnel(params);
    return {
      config: {
        ...base,
        server: "127.0.0.1",
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

export async function openSqlServerPool(res: GetSqlServerDbConfigResult): Promise<InstanceType<typeof sql.ConnectionPool>> {
  const pool = new sql.ConnectionPool(res.config);
  await pool.connect();
  return pool;
}
