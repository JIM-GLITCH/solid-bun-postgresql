/**
 * SSH 隧道 + PostgreSQL 连接测试
 */
import { createSshTunnel } from "../backend/ssh-tunnel";
import { Client } from "pg";

const REMOTE_ADDR = "postgres";
const REMOTE_PORT = 5432;

async function main() {
  const tunnel = await createSshTunnel({
    host: REMOTE_ADDR,
    port: String(REMOTE_PORT),
    database: "mydb",
    username: "postgres",
    password: "secret",
    sshEnabled: true,
    sshHost: "localhost",
    sshPort: "5022",
    sshUsername: "root",
    sshPassword: "root",
  });

  console.log("[1] Tunnel created, localPort:", tunnel.localPort);

  const client = new Client({
    host: "127.0.0.1",
    port: tunnel.localPort,
    user: "postgres",
    password: "secret",
    database: "mydb",
    connectionTimeoutMillis: 30000,
  });

  try {
    await client.connect();
    console.log("[2] Connected to PostgreSQL");
    const res = await client.query("SELECT 1 as ok");
    console.log("Query result:", res.rows[0]);
    await client.end();
  } catch (err: any) {
    console.error("[2] PostgreSQL 连接失败:", err?.message ?? err);
  } finally {
    await tunnel.close();
  }
}
main();
