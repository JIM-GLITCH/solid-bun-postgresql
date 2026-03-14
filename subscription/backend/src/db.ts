/**
 * PostgreSQL 数据库连接
 * 表结构见 schema.sql，需提前执行
 */

import pg from "pg";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://localhost:5432/subscription?user=postgres&password=postgres";

export const pool = new Pool({
  connectionString,
  max: 5,
  idleTimeoutMillis: 30000,
});

export async function query<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<{ rows: T[]; rowCount: number }> {
  const result = await pool.query(text, params);
  return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 };
}

export async function queryOne<T = unknown>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const { rows } = await query<T>(text, params);
  return rows[0] ?? null;
}
