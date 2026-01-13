// @ts-ignore
import { SQL } from "bun";
import type { PostgresLoginParmas } from "../frontend/postgres";
import { Client } from "pg";
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