/**
 * MySQL / MariaDB Strategy
 * MySQL 和 MariaDB 特定的 SQL 模板和逻辑
 */

import { Effect } from "effect";
import type { Connection as MysqlCallbackConnection, FieldPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { Readable } from "node:stream";
import type { DatabaseCapabilities } from "../../../shared/src";
import { calculateMysqlColumnEditable } from "../../mysql-column-editable";
import type { MysqlSessionConnection } from "../../session-connection";
import { createConnector, withDeadRetry, type ConnectorStrategy } from "../../db/connector";
import type { BorrowedClient, DbConnector, QueryResult, QuerySpec, StreamBatch } from "../../db/contract";
import { buildMysqlSchemaContext } from "../../db/schema-context";
import { quoteQualifiedTable, type Strategy } from "../db-service-effect";

// ── 会话监控 helper（原 mysql-db-handlers.ts 内部实现，按 DbConnector 契约移植） ──

/** mysql2 对 information_schema 等结果集列名常为大写，统一成小写键供前端（与 PG 小写列名一致） */
function mysqlRowLowerKeys(row: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    o[k.toLowerCase()] = v;
  }
  return o;
}

type MysqlSlowSource = "mysql_processlist" | "mysql_events_statements";

/** MySQL 8 performance_schema.data_lock_waits，失败则回退 information_schema.innodb_lock_waits（5.7 等） */
async function mysqlStatLockWaits(
  connector: DbConnector,
  lim: number
): Promise<
  Array<{
    waiting_pid: number;
    waiting_user: string;
    waiting_query: string;
    blocking_pid: number;
    blocking_user: string;
    blocking_query: string;
    wait_event_type: string | null;
    wait_event: string | null;
  }>
> {
  const out: Array<{
    waiting_pid: number;
    waiting_user: string;
    waiting_query: string;
    blocking_pid: number;
    blocking_user: string;
    blocking_query: string;
    wait_event_type: string | null;
    wait_event: string | null;
  }> = [];
  try {
    const res = await connector.query(
      `SELECT DISTINCT
         pl_w.ID AS waiting_pid,
         pl_w.USER AS waiting_user,
         LEFT(COALESCE(pl_w.INFO, ''), 240) AS waiting_query,
         pl_b.ID AS blocking_pid,
         pl_b.USER AS blocking_user,
         LEFT(COALESCE(pl_b.INFO, ''), 240) AS blocking_query,
         'lock' AS wait_event_type,
         'data_lock_waits' AS wait_event
       FROM performance_schema.data_lock_waits dlw
       INNER JOIN performance_schema.threads tw ON tw.THREAD_ID = dlw.REQUESTING_THREAD_ID
       INNER JOIN performance_schema.threads tb ON tb.THREAD_ID = dlw.BLOCKING_THREAD_ID
       LEFT JOIN information_schema.PROCESSLIST pl_w ON pl_w.ID = tw.PROCESSLIST_ID
       LEFT JOIN information_schema.PROCESSLIST pl_b ON pl_b.ID = tb.PROCESSLIST_ID
       WHERE pl_w.ID IS NOT NULL AND pl_b.ID IS NOT NULL
       LIMIT ?`,
      [lim]
    );
    for (const raw of res.rows as Record<string, unknown>[]) {
      const r = mysqlRowLowerKeys(raw);
      out.push({
        waiting_pid: Number(r.waiting_pid ?? 0),
        waiting_user: String(r.waiting_user ?? ""),
        waiting_query: String(r.waiting_query ?? ""),
        blocking_pid: Number(r.blocking_pid ?? 0),
        blocking_user: String(r.blocking_user ?? ""),
        blocking_query: String(r.blocking_query ?? ""),
        wait_event_type: r.wait_event_type != null ? String(r.wait_event_type) : null,
        wait_event: r.wait_event != null ? String(r.wait_event) : null,
      });
    }
    if (out.length > 0) return out;
  } catch {
    /* performance_schema 未开、权限不足或版本无此表 */
  }
  try {
    const res = await connector.query(
      `SELECT
         r.trx_mysql_thread_id AS waiting_pid,
         LEFT(COALESCE(r.trx_query, ''), 240) AS waiting_query,
         b.trx_mysql_thread_id AS blocking_pid,
         LEFT(COALESCE(b.trx_query, ''), 240) AS blocking_query
       FROM information_schema.innodb_lock_waits w
       INNER JOIN information_schema.innodb_trx r ON r.trx_id = w.requesting_trx_id
       INNER JOIN information_schema.innodb_trx b ON b.trx_id = w.blocking_trx_id
       LIMIT ?`,
      [lim]
    );
    for (const raw of res.rows as Record<string, unknown>[]) {
      const r = mysqlRowLowerKeys(raw);
      out.push({
        waiting_pid: Number(r.waiting_pid ?? 0),
        waiting_user: "",
        waiting_query: String(r.waiting_query ?? ""),
        blocking_pid: Number(r.blocking_pid ?? 0),
        blocking_user: "",
        blocking_query: String(r.blocking_query ?? ""),
        wait_event_type: "innodb",
        wait_event: "innodb_lock_waits",
      });
    }
  } catch {
    /* MySQL 8.0.13+ 已移除 innodb_lock_waits 等 */
  }
  return out;
}

/** 优先 performance_schema.events_statements_summary_by_digest，否则 PROCESSLIST 热门会话 */
async function mysqlFetchSlowQueries(
  connector: DbConnector,
  lim: number
): Promise<{ rows: Array<Record<string, unknown>>; source: MysqlSlowSource }> {
  try {
    const res = await connector.query(
      `SELECT
         DIGEST_TEXT AS query,
         COUNT_STAR AS calls,
         ROUND(SUM_TIMER_WAIT / 1000000, 3) AS total_exec_time,
         ROUND(SUM_TIMER_WAIT / NULLIF(COUNT_STAR, 0) / 1000000, 3) AS mean_exec_time,
         SUM_ROWS_SENT AS stmt_rows
       FROM performance_schema.events_statements_summary_by_digest
       WHERE DIGEST_TEXT IS NOT NULL AND LENGTH(TRIM(DIGEST_TEXT)) > 0
       ORDER BY SUM_TIMER_WAIT DESC
       LIMIT ?`,
      [lim]
    );
    const arr = res.rows as Record<string, unknown>[];
    if (arr.length > 0) {
      return {
        source: "mysql_events_statements",
        rows: arr.map((raw) => {
          const r = mysqlRowLowerKeys(raw);
          return {
            query: String(r.query ?? "").slice(0, 240),
            calls: Number(r.calls ?? 0),
            total_exec_time: Number(r.total_exec_time ?? 0),
            mean_exec_time: r.mean_exec_time != null && !Number.isNaN(Number(r.mean_exec_time)) ? Number(r.mean_exec_time) : null,
            rows: Number(r.stmt_rows ?? 0),
          };
        }),
      };
    }
  } catch {
    /* consumer 未启用或无权限 */
  }

  const res = await connector.query(
    `SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
     FROM information_schema.PROCESSLIST
     ORDER BY TIME DESC
     LIMIT ?`,
    [lim]
  );
  return {
    source: "mysql_processlist",
    rows: (res.rows as Record<string, unknown>[]).map((raw) => {
      const r = mysqlRowLowerKeys(raw);
      const id = Number(r.id ?? 0);
      return {
        id,
        connection_id: id,
        user: String(r.user ?? ""),
        host: String(r.host ?? ""),
        db: r.db != null ? String(r.db) : "",
        command: String(r.command ?? ""),
        time_seconds: Number(r.time ?? 0),
        state: String(r.state ?? ""),
        query: String(r.info ?? "").slice(0, 240),
        total_exec_time: Number(r.time ?? 0) * 1000,
      };
    }),
  };
}

export const mysqlStrategy: Strategy = {
  dbType: 'mysql' as const,
  
  quoteIdentifier: (id) => `\`${id.replace(/`/g, '``')}\``,
  buildPlaceholder: (index) => `?`,
  
  metadataQueries: {
    schemas: `SHOW DATABASES`,
    
    tables: `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type 
             FROM information_schema.TABLES 
             WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME`,
    
    columns: `SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
               FROM information_schema.COLUMNS 
               WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? 
               ORDER BY ORDINAL_POSITION`,
    
    indexes: `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
              FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
              ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
    
    primaryKeys: `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
                  ORDER BY ORDINAL_POSITION`,
    
    foreignKeys: `SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME AS source_column,
                  kcu.REFERENCED_TABLE_SCHEMA AS target_schema, 
                  kcu.REFERENCED_TABLE_NAME AS target_table, 
                  kcu.REFERENCED_COLUMN_NAME AS target_column,
                  rc.DELETE_RULE AS delete_rule, rc.UPDATE_RULE AS update_rule
                  FROM information_schema.KEY_COLUMN_USAGE kcu
                  JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
                    ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
                    AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
                  WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ?
                    AND kcu.REFERENCED_TABLE_NAME IS NOT NULL`,
    
    uniqueConstraints: `SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
                         GROUP_CONCAT(kcu.COLUMN_NAME ORDER BY kcu.ORDINAL_POSITION) AS cols
                         FROM information_schema.TABLE_CONSTRAINTS tc
                         JOIN information_schema.KEY_COLUMN_USAGE kcu
                           ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                           AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                           AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                           AND tc.TABLE_NAME = kcu.TABLE_NAME
                         WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ?
                           AND tc.CONSTRAINT_TYPE IN ('UNIQUE','PRIMARY KEY')
                         GROUP BY tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE`,
    
    checkConstraints: `SELECT cc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS expression
                       FROM information_schema.CHECK_CONSTRAINTS cc
                       JOIN information_schema.TABLE_CONSTRAINTS tc
                         ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
                         AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
                       WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? 
                         AND tc.CONSTRAINT_TYPE = 'CHECK'`,
    
    dataTypes: `SELECT DISTINCT DATA_TYPE AS name FROM information_schema.COLUMNS ORDER BY DATA_TYPE`,
    
    tableComment: `SELECT TABLE_COMMENT FROM information_schema.TABLES 
                   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
  },
  
  buildInsertSQL: (params) => {
    const colCount = params.columns.length;
    // 只接受列数完整的行；? 占位符按「行优先」顺序展开，与扁平 values 一一对应
    const rows = params.values.filter((r) => Array.isArray(r) && r.length === colCount);
    const valueGroups = rows.map(() => `(${params.columns.map(() => '?').join(', ')})`);
    return {
      sql: `INSERT INTO ${quoteQualifiedTable(params.table, mysqlStrategy.quoteIdentifier)} (${params.columns.map(c => mysqlStrategy.quoteIdentifier(c)).join(', ')}) VALUES ${valueGroups.join(", ")}`,
      values: rows.flat(),
    };
  },
  
  parseExplainResult: (result) => Effect.gen(function* () {
    // MySQL EXPLAIN 解析
    const row = result.rows[0];
    const raw = row?.EXPLAIN ?? row?.explain ?? Object.values(row ?? {})[0];
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const plan = Array.isArray(parsed) ? parsed : [parsed];
    return { plan };
  }),
  
  specialHandlers: {
    // MySQL 特有 handler
  },
  
  sessionMonitor: (connector, limit) =>
    Effect.tryPromise(async () => {
      const lim = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 5), 200) : 20;
      const statsRes = await connector.query(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN COMMAND != 'Sleep' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN COMMAND = 'Sleep' THEN 1 ELSE 0 END) AS idle,
           SUM(
             CASE
               WHEN STATE IS NOT NULL AND TRIM(STATE) != '' AND (
                 LOWER(STATE) LIKE '%lock%' OR LOWER(STATE) LIKE '%wait%'
               ) THEN 1 ELSE 0 END
           ) AS waiting
         FROM information_schema.PROCESSLIST`
      );
      const s0 = mysqlRowLowerKeys((statsRes.rows as Record<string, unknown>[])[0] ?? {});
      const lockWaits = await mysqlStatLockWaits(connector, lim);
      const { rows: slowQueries, source: slowQuerySource } = await mysqlFetchSlowQueries(connector, lim);
      return {
        connectionStats: {
          total: Number(s0.total ?? 0),
          active: Number(s0.active ?? 0),
          idle: Number(s0.idle ?? 0),
          waiting: Number(s0.waiting ?? 0),
        },
        lockWaits,
        slowQueries,
        slowQuerySource,
        collectedAt: Date.now(),
      };
    }),

  sessionControl: (connector, pid, action) =>
    Effect.gen(function* () {
      const pidInt = Math.floor(Number(pid));
      if (!Number.isFinite(pidInt) || pidInt <= 0) return yield* Effect.fail(new Error("pid 非法"));
      const self = connector.sessionThreadId?.();
      if (pidInt === self) return yield* Effect.fail(new Error("不允许结束当前会话自身线程"));
      const sql = action === "terminate" ? `KILL ${pidInt}` : `KILL QUERY ${pidInt}`;
      // KILL 失败（会话已不存在等）视为未取消，而非错误
      return yield* Effect.tryPromise(() => connector.query(sql)).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false))
      );
    }),

  explainText: (connector, query) =>
    Effect.tryPromise(async () => {
      const { rows } = await connector.query(`EXPLAIN ${query}`);
      return (rows as Record<string, unknown>[]).map((row) =>
        Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" | ")
      );
    }),
};

// ── 连接器装配（MySQL 方言私有逻辑；公共逻辑见 db/connector.ts） ──

function mysqlBacktickIdent(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}

function mysqlCallbackConnection(promiseConn: PoolConnection): MysqlCallbackConnection {
  return (promiseConn as unknown as { connection: MysqlCallbackConnection }).connection;
}

function mysqlStreamFirstBatch(
  stream: Readable,
  batchSize: number
): Promise<{ rows: unknown[][]; fieldPackets: FieldPacket[] | undefined; hasMore: boolean }> {
  return new Promise((resolve, reject) => {
    let fieldsPackets: FieldPacket[] | undefined;
    const rows: unknown[][] = [];

    const onFields = (f: FieldPacket[]) => {
      fieldsPackets = f;
    };

    const cleanup = () => {
      stream.off("fields", onFields);
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    const onData = (row: unknown) => {
      const r = Array.isArray(row) ? (row as unknown[]) : [row];
      rows.push(r);
      if (rows.length >= batchSize) {
        stream.pause();
        cleanup();
        resolve({ rows, fieldPackets: fieldsPackets, hasMore: true });
      }
    };

    const onEnd = () => {
      cleanup();
      resolve({ rows, fieldPackets: fieldsPackets, hasMore: false });
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    stream.on("fields", onFields);
    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
  });
}

function mysqlStreamNextBatch(stream: Readable, batchSize: number): Promise<{ rows: unknown[][]; done: boolean }> {
  return new Promise((resolve, reject) => {
    const rows: unknown[][] = [];

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("end", onEnd);
      stream.off("error", onError);
    };

    const onData = (row: unknown) => {
      const r = Array.isArray(row) ? (row as unknown[]) : [row];
      rows.push(r);
      if (rows.length >= batchSize) {
        stream.pause();
        cleanup();
        resolve({ rows, done: false });
      }
    };

    const onEnd = () => {
      cleanup();
      resolve({ rows, done: true });
    };

    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };

    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onError);
    stream.resume();
  });
}

function teardownRowStream(session: MysqlSessionConnection): void {
  const s = session.mysqlRowStream;
  if (s && !s.destroyed) {
    s.destroy();
  }
  session.mysqlRowStream = undefined;
  session.mysqlRunningThreadId = undefined;
}

export interface MysqlConnectorDeps {
  connectionId: string;
  capabilities: DatabaseCapabilities;
  isDeadError: (e: unknown) => boolean;
  recreateUserClient: () => Promise<void>;
}

export function createMysqlConnector(
  session: MysqlSessionConnection,
  deps: MysqlConnectorDeps
): DbConnector {
  const ensureDefaultDatabase = async (overrideSchema?: string | null): Promise<void> => {
    const o = overrideSchema != null ? String(overrideSchema).trim() : "";
    if (!o) return;
    await session.userUsedClient.query(`USE ${mysqlBacktickIdent(o)}`);
    session.mysqlCurrentDatabase = o;
  };

  const toResult = <Row>(res: unknown): QueryResult<Row> => {
    const [rows, fields] = res as [Row[] | { affectedRows?: number }, FieldPacket[] | undefined];
    if (Array.isArray(rows)) {
      return { rows: rows as Row[], rowCount: rows.length, fields };
    }
    const header = rows as { affectedRows?: number; insertId?: number } | undefined;
    return { rows: [], rowCount: header?.affectedRows, fields, header };
  };

  const arrayRowsFrom = async (
    conn: { query: (opts: { sql: string; rowsAsArray: true }) => Promise<unknown> },
    text: string
  ): Promise<QueryResult<unknown[]>> => {
    const res = (await conn.query({ sql: text, rowsAsArray: true })) as unknown;

    if (Array.isArray(res)) {
      const a = res as unknown[];
      const first = a[0];
      const maybeFields = a[1];
      if (Array.isArray(first) && (maybeFields === undefined || Array.isArray(maybeFields))) {
        const rows = first as unknown[][];
        return { rows, rowCount: rows.length, fields: maybeFields as FieldPacket[] | undefined };
      }
      return { rows: a as unknown[][], rowCount: a.length };
    }

    const obj = res as { rows?: unknown[][]; fields?: FieldPacket[] } | undefined;
    const rows = Array.isArray(obj?.rows) ? (obj!.rows as unknown[][]) : [];
    return { rows, rowCount: rows.length, fields: obj?.fields };
  };

  const queryRowsAsArray = async (text: string): Promise<QueryResult<unknown[]>> => {
    const conn = await session.backGroundPool.getConnection();
    try {
      return await arrayRowsFrom(
        conn as unknown as { query: (o: { sql: string; rowsAsArray: true }) => Promise<unknown> },
        text
      );
    } finally {
      conn.release();
    }
  };

  const strategy: ConnectorStrategy = {
    dbKind: session.dbKind,

    async query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      const wantsArray = typeof spec !== "string" && (spec.rowMode === "array" || spec.rowsAsArray === true);
      if (wantsArray) {
        const text = typeof spec === "string" ? spec : spec.text;
        return (await queryRowsAsArray(text)) as QueryResult<Row>;
      }
      const text = typeof spec === "string" ? spec : spec.text;
      const values = typeof spec === "string" ? params : spec.values;
      const res = await session.backGroundPool.query(text, values as any[] | undefined);
      return toResult<Row>(res);
    },

    queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      const text = typeof spec === "string" ? spec : spec.text;
      const values = typeof spec === "string" ? params : spec.values;
      return withDeadRetry(deps, async () => {
        const res = await session.userUsedClient.query(text, values as any[] | undefined);
        return toResult<Row>(res);
      });
    },

    async queryWithDefaultSchema<Row = any>(text: string, defaultSchema?: string): Promise<QueryResult<Row>> {
      const conn = session.userUsedClient;
      await ensureDefaultDatabase(defaultSchema);
      const res = (await conn.query({ sql: text, rowsAsArray: true } as never)) as unknown;
      const a = res as unknown[];
      const rows = Array.isArray(a) && Array.isArray(a[0]) ? (a[0] as unknown[][]) : [];
      const fields = Array.isArray(a) && a[1] !== undefined ? (a[1] as FieldPacket[]) : undefined;
      return { rows: rows as Row[], rowCount: rows.length, fields };
    },

    async withPoolClient<T>(fn: (client: BorrowedClient) => Promise<T>): Promise<T> {
      const conn = await session.backGroundPool.getConnection();
      try {
        const borrowed: BorrowedClient = {
          nativeId: conn.threadId,
          exec: async (sql: string) => {
            await conn.query(sql);
          },
          beginTransaction: async () => {
            await conn.beginTransaction();
          },
          commit: async () => {
            await conn.commit();
          },
          rollback: async () => {
            await conn.rollback();
          },
          async query<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]) {
            const text = typeof spec === "string" ? spec : spec.text;
            const values = typeof spec === "string" ? params : spec.values;
            const res = await conn.query(text, values as any[] | undefined);
            return toResult<Row>(res);
          },
        };
        return await fn(borrowed);
      } finally {
        conn.release();
      }
    },

    async startStream(plan, statements, batchSize): Promise<StreamBatch> {
      const conn = session.userUsedClient;
      session.mysqlRunningThreadId = conn.threadId;

      let rowStream: Readable | undefined;
      try {
        await ensureDefaultDatabase(plan.defaultSchema);
        for (let i = 0; i < statements.length - 1; i++) {
          await conn.query(statements[i]);
        }
        const lastStatement = statements[statements.length - 1];
        const rawConn = mysqlCallbackConnection(conn);
        const cmd = rawConn.query({ sql: lastStatement, rowsAsArray: true });
        rowStream = cmd.stream({ highWaterMark: Math.max(2, batchSize) }) as Readable;

        const { rows, fieldPackets, hasMore } = await mysqlStreamFirstBatch(rowStream, batchSize);

        const columns =
          fieldPackets?.length && fieldPackets.length > 0
            ? await calculateMysqlColumnEditable(session.backGroundPool, fieldPackets, session.mysqlCurrentDatabase)
            : [];

        if (hasMore) {
          session.mysqlRowStream = rowStream;
        } else {
          session.mysqlRunningThreadId = undefined;
          rowStream = undefined;
        }

        return { rows, columns, hasMore };
      } catch (e) {
        if (rowStream && !rowStream.destroyed) {
          rowStream.destroy();
        }
        teardownRowStream(session);
        throw e;
      }
    },

    async readStreamBatch({ batchSize, defaultSchema }): Promise<StreamBatch> {
      const stream = session.mysqlRowStream;
      if (!stream || stream.destroyed) {
        return { rows: [], hasMore: false };
      }
      try {
        await ensureDefaultDatabase(defaultSchema);
        const { rows, done } = await mysqlStreamNextBatch(stream, batchSize);
        if (done) {
          teardownRowStream(session);
        }
        return { rows, hasMore: !done };
      } catch (e) {
        teardownRowStream(session);
        throw e;
      }
    },

    endStream(): Promise<void> {
      teardownRowStream(session);
      return Promise.resolve();
    },

    async cancelCurrentQuery(): Promise<{ cancelled: boolean; message?: string }> {
      const tid = session.mysqlRunningThreadId;
      if (!tid) return { cancelled: false, message: "没有正在执行的查询" };
      await session.backGroundPool.query(`KILL QUERY ${Number(tid)}`);
      return { cancelled: true, message: "查询取消请求已发送" };
    },

    sessionThreadId(): number | undefined {
      return session.userUsedClient.threadId;
    },

    currentDatabase(): string | undefined {
      return session.mysqlCurrentDatabase;
    },

    async sessionControl(target: number, action: "cancel" | "terminate"): Promise<boolean> {
      const text = action === "terminate" ? `KILL ${target}` : `KILL QUERY ${target}`;
      try {
        await session.backGroundPool.query(text);
        return true;
      } catch {
        return false;
      }
    },

    buildSchemaContext(schema?: string) {
      return buildMysqlSchemaContext(session.backGroundPool, schema);
    },
  };

  return createConnector({
    connectionId: deps.connectionId,
    dbKind: session.dbKind,
    capabilities: deps.capabilities,
    strategy,
  });
}
