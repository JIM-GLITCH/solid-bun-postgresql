/**
 * AI 助手用的 schema 上下文采集（三方言实现）。
 *
 * 从 `api-core.ts` 移入连接层：这三段是**纯连接侧工作**（只依赖池/连接做元数据查询），
 * 业务侧只需拿到 { context, injected }。移入后 `api-core.ts` 不再引用任何连接句柄。
 */

import type { Pool as MysqlPool } from "mysql2/promise";
import type { Pool } from "pg";
import type { ConnectionPool as MssqlConnectionPool } from "mssql";

export interface SchemaContext {
  context: string;
  injected: string[];
}

export async function buildPostgresSchemaContext(pool: Pool, schema?: string): Promise<SchemaContext> {
  const schemas = schema
    ? [schema]
    : (
      await pool.query(
        `SELECT schema_name
         FROM information_schema.schemata
         WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'
         ORDER BY schema_name
         LIMIT 2`
      )
    ).rows.map((r: any) => r.schema_name as string);

  const chunks: string[] = [];
  const injected: string[] = [];
  for (const s of schemas) {
    const tablesRes = await pool.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name
       LIMIT 6`,
      [s]
    );
    for (const t of tablesRes.rows as Array<{ table_name: string }>) {
      const colsRes = await pool.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position
         LIMIT 12`,
        [s, t.table_name]
      );
      const cols = colsRes.rows.map((c: any) => `${c.column_name}:${c.data_type}`).join(", ");
      const tableRef = `${s}.${t.table_name}`;
      chunks.push(`${tableRef}(${cols})`);
      injected.push(tableRef);
    }
  }
  return { context: chunks.join("\n"), injected };
}

export async function buildMysqlSchemaContext(pool: MysqlPool, schema?: string): Promise<SchemaContext> {
  const schemas = schema
    ? [schema]
    : (
        (
          await pool.query(
            `SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA
             WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')
             ORDER BY SCHEMA_NAME LIMIT 2`
          )
        )[0] as Array<Record<string, unknown>>
      ).map((r) => String(r.schema_name ?? r.SCHEMA_NAME ?? "")).filter(Boolean);

  const chunks: string[] = [];
  const injected: string[] = [];
  for (const s of schemas) {
    const [tableRows] = await pool.query(
      `SELECT TABLE_NAME AS table_name FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME LIMIT 6`,
      [s]
    );
    for (const tr of (tableRows as Array<Record<string, unknown>>) ?? []) {
      const tname = String(tr.table_name ?? tr.TABLE_NAME ?? "");
      if (!tname) continue;
      const [colRows] = await pool.query(
        `SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY ORDINAL_POSITION LIMIT 12`,
        [s, tname]
      );
      const cols = ((colRows as Array<Record<string, unknown>>) ?? [])
        .map((c) => {
          const cn = String(c.column_name ?? c.COLUMN_NAME ?? "");
          const dt = String(c.data_type ?? c.DATA_TYPE ?? "");
          return `${cn}:${dt}`;
        })
        .filter((x) => x !== ":");
      const tableRef = `${s}.${tname}`;
      chunks.push(`${tableRef}(${cols.join(", ")})`);
      injected.push(tableRef);
    }
  }
  return { context: chunks.join("\n"), injected };
}

/** SQL Server：由连接层策略（`db-handlers/strategies/sqlserver-strategy-effect.ts`）注入实现，避免反向依赖 */
export type MssqlSchemaContextBuilder = (
  pool: MssqlConnectionPool,
  schema?: string
) => Promise<SchemaContext>;
