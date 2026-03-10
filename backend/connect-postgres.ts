import type { PostgresLoginParams } from "../shared/src";
import { Client, Pool, types } from "pg";

// 日期时间类型以字符串返回，避免 JS Date 丢失微秒精度
// OID: 1082=date, 1083=time, 1266=timetz, 1114=timestamp, 1184=timestamptz, 1186=interval
// 注：int8、numeric 默认已是字符串，无需注册
const keepString = (v: string) => v;
[1082, 1083, 1266, 1114, 1184, 1186].forEach((oid) => types.setTypeParser(oid, keepString));

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
