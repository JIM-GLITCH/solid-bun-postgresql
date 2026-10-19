/**
 * PostgreSQL Strategy
 * PostgreSQL 特定的 SQL 模板和逻辑
 */

import Cursor from "pg-cursor";
import { Effect } from "effect";
import type { DatabaseCapabilities } from "../../../shared/src";
import { calculateColumnEditable } from "../../column-editable";
import type { PostgresSessionConnection } from "../../session-connection";
import { createConnector, withDeadRetry, type ConnectorStrategy } from "../../db/connector";
import type { BorrowedClient, DbConnector, QueryResult, QuerySpec, StreamBatch } from "../../db/contract";
import { buildPostgresSchemaContext } from "../../db/schema-context";
import type { Strategy } from "../db-service-effect";

export const postgresStrategy: Strategy = {
  dbType: 'postgres' as const,
  
  quoteIdentifier: (id) => `"${id.replace(/"/g, '""')}"`,
  buildPlaceholder: (index) => `$${index}`,
  
  metadataQueries: {
    schemas: `SELECT schema_name FROM information_schema.schemata 
               WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' 
               ORDER BY schema_name`,
    
    tables: `SELECT table_name, table_type FROM information_schema.tables 
             WHERE table_schema = $1 ORDER BY table_type, table_name`,
    
    columns: `SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
               FROM information_schema.columns 
               WHERE table_schema = $1 AND table_name = $2 
               ORDER BY ordinal_position`,
    
    indexes: `SELECT i.relname AS index_name, am.amname AS index_type,
               ix.indisunique AS is_unique, ix.indisprimary AS is_primary,
               array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
               FROM pg_index ix
               JOIN pg_class c ON c.oid = ix.indrelid
               JOIN pg_class i ON i.oid = ix.indexrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_am am ON am.oid = i.relam
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(ix.indkey)
               WHERE n.nspname = $1 AND c.relname = $2
               GROUP BY i.relname, am.amname, ix.indisunique, ix.indisprimary
               ORDER BY i.relname`,
    
    primaryKeys: `SELECT kcu.column_name FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu 
                    ON tc.constraint_name = kcu.constraint_name 
                    AND tc.table_schema = kcu.table_schema
                  WHERE tc.constraint_type = 'PRIMARY KEY' 
                    AND tc.table_schema = $1 AND tc.table_name = $2 
                  ORDER BY kcu.ordinal_position`,
    
    foreignKeys: `SELECT tc.constraint_name, kcu.column_name AS source_column,
                  ccu.table_schema AS target_schema, ccu.table_name AS target_table, 
                  ccu.column_name AS target_column, rc.delete_rule, rc.update_rule
                  FROM information_schema.table_constraints tc
                  JOIN information_schema.key_column_usage kcu 
                    ON tc.constraint_name = kcu.constraint_name 
                    AND tc.table_schema = kcu.table_schema
                  JOIN information_schema.constraint_column_usage ccu 
                    ON ccu.constraint_name = tc.constraint_name 
                    AND ccu.table_schema = tc.table_schema
                  JOIN information_schema.referential_constraints rc 
                    ON rc.constraint_name = tc.constraint_name 
                    AND rc.constraint_schema = tc.table_schema
                  WHERE tc.constraint_type = 'FOREIGN KEY' 
                    AND tc.table_schema = $1 AND tc.table_name = $2`,
    
    uniqueConstraints: `SELECT tc.constraint_name, tc.constraint_type,
                         array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
                         FROM information_schema.table_constraints tc
                         JOIN information_schema.key_column_usage kcu
                           ON tc.constraint_name = kcu.constraint_name 
                           AND tc.table_schema = kcu.table_schema 
                           AND tc.table_name = kcu.table_name
                         WHERE tc.table_schema = $1 AND tc.table_name = $2 
                           AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
                         GROUP BY tc.constraint_name, tc.constraint_type`,
    
    checkConstraints: `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS expression
                       FROM pg_constraint con
                       JOIN pg_class c ON c.oid = con.conrelid
                       JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE con.contype = 'c' AND n.nspname = $1 AND c.relname = $2
                         AND con.conname NOT LIKE '%_not_null'`,
    
    dataTypes: `SELECT DISTINCT pg_catalog.format_type(t.oid, NULL) AS name
                FROM pg_type t
                JOIN pg_namespace n ON t.typnamespace = n.oid
                WHERE n.nspname = 'pg_catalog'
                  AND t.typtype IN ('b', 'e', 'r', 'm')
                  AND t.typisdefined
                  AND t.typname !~ '^_'
                ORDER BY 1`,
    
    tableComment: `SELECT obj_description(c.oid, 'pg_class') AS comment
                   FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE n.nspname = $1 AND c.relname = $2`,
  },
  
  buildInsertSQL: (params) => ({
    sql: `INSERT INTO ${postgresStrategy.quoteIdentifier(params.table)} (${params.columns.map(c => postgresStrategy.quoteIdentifier(c)).join(', ')}) VALUES (${params.columns.map((_, i) => postgresStrategy.buildPlaceholder(i + 1)).join(', ')})`,
    values: params.values
  }),
  
  parseExplainResult: (result) => Effect.try(() => {
    const row = result.rows[0];
    const jsonVal = row ? (row as any)["QUERY PLAN"] ?? (row as any).query_plan ?? null : null;
    const plan = typeof jsonVal === "string" ? JSON.parse(jsonVal) : jsonVal;
    return { plan };
  }),
  
  // PostgreSQL 特有 handler（简化版，完整实现需要更多代码）
  specialHandlers: {
    // 'db/function-ddl': 完整实现
    // 'db/schema-dump': 完整实现
    // 'db/database-dump': 完整实现
  },
  
  sessionMonitor: (connector, limit) =>
    Effect.tryPromise(async () => {
      const lim = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 5), 200) : 20;
      return connector.withPoolClient(async (client) => {
        // 监控查询必须“快失败”，避免 UI 卡住；不用事务，避免某一步失败后进入 aborted 状态
        await client.query("SET statement_timeout = '2500ms'");
        await client.query("SET lock_timeout = '800ms'");

        try {
          const connRes = await client.query(
            `SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE state = 'active')::int AS active,
               COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
               COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting
             FROM pg_stat_activity
             WHERE datname = current_database()`
          );

          const lockRes = await client.query(
            `SELECT
               a.pid AS waiting_pid,
               a.usename AS waiting_user,
               LEFT(COALESCE(a.query, ''), 240) AS waiting_query,
               b.pid AS blocking_pid,
               b.usename AS blocking_user,
               LEFT(COALESCE(b.query, ''), 240) AS blocking_query,
               a.wait_event_type,
               a.wait_event
             FROM pg_stat_activity a
             JOIN pg_locks la ON la.pid = a.pid AND NOT la.granted
             JOIN pg_locks lb ON lb.locktype = la.locktype
                            AND (lb.database = la.database OR (lb.database IS NULL AND la.database IS NULL))
                            AND (lb.relation = la.relation OR (lb.relation IS NULL AND la.relation IS NULL))
                            AND (lb.page = la.page OR (lb.page IS NULL AND la.page IS NULL))
                            AND (lb.tuple = la.tuple OR (lb.tuple IS NULL AND la.tuple IS NULL))
                            AND (lb.virtualxid = la.virtualxid OR (lb.virtualxid IS NULL AND la.virtualxid IS NULL))
                            AND (lb.transactionid = la.transactionid OR (lb.transactionid IS NULL AND la.transactionid IS NULL))
                            AND (lb.classid = la.classid OR (lb.classid IS NULL AND la.classid IS NULL))
                            AND (lb.objid = la.objid OR (lb.objid IS NULL AND la.objid IS NULL))
                            AND (lb.objsubid = la.objsubid OR (lb.objsubid IS NULL AND la.objsubid IS NULL))
                             AND lb.pid <> la.pid
             JOIN pg_stat_activity b ON b.pid = lb.pid
             WHERE a.datname = current_database()
             ORDER BY a.query_start NULLS LAST
             LIMIT $1`,
            [lim]
          );

          let slowQueries: Array<Record<string, unknown>> = [];
          let slowQuerySource: "pg_stat_statements" | "pg_stat_activity" = "pg_stat_statements";
          try {
            const slowRes = await client.query(
              `SELECT
                 LEFT(query, 240) AS query,
                 calls,
                 ROUND(total_exec_time::numeric, 3)::float8 AS total_exec_time,
                 ROUND(mean_exec_time::numeric, 3)::float8 AS mean_exec_time,
                 rows::bigint AS rows
               FROM pg_stat_statements
               WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
               ORDER BY total_exec_time DESC
               LIMIT $1`,
              [lim]
            );
            slowQueries = slowRes.rows as Array<Record<string, unknown>>;
          } catch {
            slowQuerySource = "pg_stat_activity";
            const fallbackRes = await client.query(
              `SELECT
                 LEFT(COALESCE(query, ''), 240) AS query,
                 EXTRACT(EPOCH FROM (now() - query_start)) * 1000 AS total_exec_time,
                 state,
                 wait_event_type,
                 wait_event
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND state = 'active'
                 AND query IS NOT NULL
               ORDER BY query_start ASC NULLS LAST
               LIMIT $1`,
              [lim]
            );
            slowQueries = fallbackRes.rows as Array<Record<string, unknown>>;
          }

          return {
            connectionStats: connRes.rows[0] ?? { total: 0, active: 0, idle: 0, waiting: 0 },
            lockWaits: lockRes.rows,
            slowQueries,
            slowQuerySource,
            collectedAt: Date.now(),
          };
        } finally {
          try { await client.query("RESET statement_timeout"); } catch { /* ignore */ }
          try { await client.query("RESET lock_timeout"); } catch { /* ignore */ }
        }
      });
    }),

  sessionControl: (connector, pid, action) =>
    Effect.gen(function* () {
      if (!Number.isInteger(pid) || pid <= 0) return yield* Effect.fail(new Error("pid 非法"));
      // sessionThreadId 即用户会话的 backend pid（契约约定其供「不允许结束自己」判断）
      const self = connector.sessionThreadId?.() ?? 0;
      if (pid === self) return yield* Effect.fail(new Error("不允许操作当前监控会话自身 pid"));
      const fn = action === "terminate" ? "pg_terminate_backend" : "pg_cancel_backend";
      const rs = yield* Effect.tryPromise(() =>
        connector.query(`SELECT ${fn}($1) AS ok`, [pid])
      );
      return Boolean(rs.rows[0]?.ok);
    }),

  explainText: (connector, query) =>
    Effect.tryPromise(async () => {
      const result = await connector.query(`EXPLAIN (VERBOSE, COSTS ON, FORMAT TEXT) ${query}`);
      return result.rows.map((row) => {
        const r = row as Record<string, unknown>;
        const v = r["QUERY PLAN"] ?? r["query_plan"] ?? Object.values(r)[0];
        return typeof v === "string" ? v : String(v ?? "");
      });
    }),
};

// ── 连接器装配（PostgreSQL 方言私有逻辑；公共逻辑见 db/connector.ts） ──

export interface PgConnectorDeps {
  connectionId: string;
  capabilities: DatabaseCapabilities;
  isDeadError: (e: unknown) => boolean;
  recreateUserClient: () => Promise<void>;
}

export function createPgConnector(
  session: PostgresSessionConnection,
  deps: PgConnectorDeps
): DbConnector {
  let cursorState: { instance: Cursor; isDone: boolean } | undefined;

  const closeCursor = async (): Promise<void> => {
    const cur = cursorState;
    cursorState = undefined;
    session.runningQueryPid = undefined;
    if (cur) {
      try {
        await new Promise<void>((r) => cur.instance.close(() => r()));
      } catch {
        /* ignore */
      }
    }
  };

  const strategy: ConnectorStrategy = {
    dbKind: "postgres",

    async query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      const res = await session.backGroundPool.query(spec as any, params as any[] | undefined);
      return { rows: res.rows as Row[], rowCount: res.rowCount ?? undefined, fields: res.fields };
    },

    queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      const config: QuerySpec =
        typeof spec === "string" ? { text: spec, values: params as unknown[] | undefined } : spec;
      return withDeadRetry(deps, async () => {
        const client = session.userUsedClient;
        if ((client as any).processID) session.runningQueryPid = (client as any).processID;
        try {
          const res = await client.query(config as any);
          session.runningQueryPid = undefined;
          return {
            rows: res.rows as Row[],
            rowCount: res.rowCount ?? undefined,
            fields: res.fields,
            command: res.command,
          };
        } catch (e) {
          session.runningQueryPid = undefined;
          throw e;
        }
      });
    },

    async withPoolClient<T>(fn: (client: BorrowedClient) => Promise<T>): Promise<T> {
      const client = await session.backGroundPool.connect();
      try {
        const borrowed: BorrowedClient = {
          nativeId: (client as any).processID,
          async query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]) {
            const res = await client.query(spec as any, params as any[] | undefined);
            return { rows: res.rows as Row[], rowCount: res.rowCount ?? undefined, fields: res.fields };
          },
        };
        return await fn(borrowed);
      } finally {
        client.release();
      }
    },

    startStream(_plan, statements, batchSize): Promise<StreamBatch> {
      return withDeadRetry(deps, async () => {
        const client = session.userUsedClient;
        await closeCursor();

        try {
          const pidRes = await client.query("SELECT pg_backend_pid() as pid");
          session.runningQueryPid = parseInt(String(pidRes.rows[0]?.pid ?? 0), 10) || undefined;
        } catch {
          session.runningQueryPid = (client as any).processID;
        }

        for (let i = 0; i < statements.length - 1; i++) {
          await client.query(statements[i]);
        }

        const lastStatement = statements[statements.length - 1];
        const cursor = client.query(new Cursor(lastStatement, [], { rowMode: "array" }));
        const rows = await new Promise<any[]>((resolve, reject) => {
          cursor.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
        });

        const fields = (cursor as any)._result?.fields;
        const columns = fields ? await calculateColumnEditable(session.backGroundPool, fields, lastStatement) : [];
        const isDone = rows.length < batchSize;

        if (isDone) {
          await closeCursor();
        } else {
          cursorState = { instance: cursor, isDone: false };
        }

        return { rows, hasMore: !isDone, columns };
      });
    },

    async readStreamBatch({ batchSize }): Promise<StreamBatch> {
      const cur = cursorState;
      if (!cur || cur.isDone) return { rows: [], hasMore: false };

      let rows: any[];
      try {
        rows = await new Promise<any[]>((resolve, reject) => {
          cur.instance.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
        });
      } catch (e) {
        if (deps.isDeadError(e)) {
          await closeCursor();
          await deps.recreateUserClient();
        }
        throw e;
      }
      const isDone = rows.length < batchSize;
      if (isDone) {
        await closeCursor();
      } else {
        cur.isDone = false;
      }
      return { rows, hasMore: !isDone };
    },

    endStream(): Promise<void> {
      return closeCursor();
    },

    async cancelCurrentQuery(): Promise<{ cancelled: boolean; message?: string }> {
      const pid = session.runningQueryPid;
      if (!pid) return { cancelled: false, message: "没有正在执行的查询" };
      const result = await session.backGroundPool.query(`SELECT pg_cancel_backend($1)`, [pid]);
      const cancelled = Boolean((result.rows[0] as any)?.pg_cancel_backend);
      return { cancelled, message: cancelled ? "查询取消请求已发送" : "查询可能已完成或无法取消" };
    },

    sessionThreadId(): number | undefined {
      return session.runningQueryPid ?? ((session.userUsedClient as any).processID as number | undefined);
    },

    buildSchemaContext(schema?: string) {
      return buildPostgresSchemaContext(session.backGroundPool, schema);
    },
  };

  return createConnector({
    connectionId: deps.connectionId,
    dbKind: "postgres",
    capabilities: deps.capabilities,
    strategy,
  });
}
