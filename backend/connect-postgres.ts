// @ts-ignore
import { SQL } from "bun";
import type { PostgresLoginParmas } from "../frontend/postgres";
import { Client, Pool } from "pg";

export async function connectPostgres(params: PostgresLoginParmas) {
    // 这里的配置需按需替换为你的 postgres 配置
    const client = new Client({
        host: params.host,
        port: Number(params.port),
        database: params.database,
        user: params.username,
        password: params.password,
    });
    await client.connect();
    return client
}

// 创建连接池，用于管理操作（元数据查询、取消查询等）
export function createPostgresPool(params: PostgresLoginParmas) {
    return new Pool({
        host: params.host,
        port: Number(params.port),
        database: params.database,
        user: params.username,
        password: params.password,
        max: 3,  // 最多 3 个连接
        idleTimeoutMillis: 30000,  // 空闲 30 秒后释放
    });
}