import type { PostgresLoginParams } from "../shared/src";
import { Client, Pool } from "pg";

export async function connectPostgres(params: PostgresLoginParams) {
    const client = new Client({
        host: params.host,
        port: Number(params.port),
        database: params.database,
        user: params.username,
        password: params.password,
    });
    await client.connect();
    return client;
}

export function createPostgresPool(params: PostgresLoginParams) {
    return new Pool({
        host: params.host,
        port: Number(params.port),
        database: params.database,
        user: params.username,
        password: params.password,
        max: 3,
        idleTimeoutMillis: 30000,
    });
}
