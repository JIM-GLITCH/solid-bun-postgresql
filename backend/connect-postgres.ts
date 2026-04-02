import type { PostgresLoginParams } from "../shared/src";
import { Client, Pool, types } from "pg";
import { createSshTunnel } from "./ssh-tunnel";

// 日期时间类型以字符串返回，避免 JS Date 丢失微秒精度
// OID: 1082=date, 1083=time, 1266=timetz, 1114=timestamp, 1184=timestamptz, 1186=interval
// 注：int8、numeric 默认已是字符串，无需注册
const keepString = (v: string) => v;
[1082, 1083, 1266, 1114, 1184, 1186].forEach((oid) => types.setTypeParser(oid, keepString));

const DEFAULT_SSH_CONNECTION_TIMEOUT_MS = 30000;

function getConnectionTimeoutMs(params: PostgresLoginParams): number {
  if (!params.sshEnabled) return 10000;
  const sec = params.connectionTimeoutSec;
  return sec != null && sec > 0 ? sec * 1000 : DEFAULT_SSH_CONNECTION_TIMEOUT_MS;
}

/** pg.Client / pg.Pool 可用的连接配置（隧道模式下 host 为 undefined，与 Antares 一致） */
export interface DbConfig {
  host?: string;
  port: number;
  database: string;
  user: string;
  password: string;
  connectionTimeoutMillis: number;
}

/** getDbConfig 返回结果：统一入口，确保所有连接都使用隧道化后的配置 */
export interface GetDbConfigResult {
  config: DbConfig;
  closeTunnel?: () => Promise<void>;
  /** 是否通过 SSH 隧道，用于 pool max 等 */
  sshEnabled: boolean;
}

/**
 * 获取数据库连接配置（参考 Antares PostgreSQLClient.getDbConfig）
 * 若启用 SSH 隧道则建立隧道，并将 host/port 替换为本地隧道端口，确保所有连接都走隧道
 */
export async function getDbConfig(params: PostgresLoginParams): Promise<GetDbConfigResult> {
  const dbName = String(params.database ?? "").trim();
  const baseConfig: DbConfig = {
    host: params.host ?? "localhost",
    port: Number(params.port ?? 5432),
    // 未填 database 时与 libpq 一致：默认库名为当前用户名
    database: dbName || params.username || "postgres",
    user: params.username,
    password: params.password ?? "",
    connectionTimeoutMillis: getConnectionTimeoutMs(params),
  };

  if (!params.sshEnabled) {
    return { config: baseConfig, sshEnabled: false };
  }

  try {




    const tunnel = await createSshTunnel(params);
    return {
      config: {
        ...baseConfig,
        host: undefined, // 与 Antares 一致，pg 默认用 localhost
        port: tunnel.localPort,
      },
      closeTunnel: tunnel.close,
      sshEnabled: true,
    };
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (/timeout|expired|timed out/i.test(msg)) {
      throw new Error("SSH 隧道连接超时，请检查跳板机地址、端口及网络");
    }
    throw err;
  }
}

export async function connectPostgres(db: GetDbConfigResult) {
  const client = new Client(db.config);
  try {
    await client.connect();
    return client;
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    if (db.sshEnabled && /timeout|expired/i.test(msg)) {
      throw new Error("数据库连接超时，请确认数据库 host 为跳板机可访问的地址（如内网 IP 或 localhost）");
    }
    throw err;
  }
}

export function createPostgresPool(db: GetDbConfigResult) {
  return new Pool({
    ...db.config,
    max: db.sshEnabled ? 2 : 6,
    idleTimeoutMillis: 30000,
  });
}
