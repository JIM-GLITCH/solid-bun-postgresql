/**
 * MySQL / MariaDB：共用 mysql2 与同一套 db/* 实现（MariaDB 协议兼容 MySQL）。
 */
import type { Readable } from "node:stream";
import type { Connection as MysqlCallbackConnection, FieldPacket } from "mysql2";
import type { Pool, PoolConnection } from "mysql2/promise";
import type {
  ConnectDbRequest,
  DbKind,
  DatabaseCapabilities,
  PostgresLoginParams,
  SSEMessage,
} from "../shared/src";
import { getSqlSegments, isMysqlFamily } from "../shared/src";
import { createMysqlPool, getMysqlDbConfig } from "./connect-mysql";
import { calculateMysqlColumnEditable } from "./mysql-column-editable";
import type { MysqlSessionConnection, SessionConnection } from "./session-connection";

function mysqlSession(getSWithDb: (cid: string) => SessionConnection, cid: string): MysqlSessionConnection {
  const s = getSWithDb(cid);
  if (!isMysqlFamily(s.dbKind)) throw new Error("内部错误：期望 MySQL/MariaDB 会话");
  return s as MysqlSessionConnection;
}

function getStatementsFromSql(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

function mysqlBacktickIdent(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}

/** 在指定连接上 USE 默认库，解决未在 DSN 填 database 时「No database selected」 */
async function ensureMysqlDefaultDatabase(
  session: MysqlSessionConnection,
  conn: PoolConnection,
  overrideSchema?: string | null
): Promise<void> {
  const o = overrideSchema != null ? String(overrideSchema).trim() : "";
  const dbName = o || session.mysqlCurrentDatabase;
  if (!dbName) return;
  await conn.query(`USE ${mysqlBacktickIdent(dbName)}`);
  session.mysqlCurrentDatabase = dbName;
}

function toRowArray(raw: unknown): unknown[][] {
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray((raw as unknown[])[0])) {
    return raw as unknown[][];
  }
  return [];
}

function splitGroupConcat(cols: unknown): string[] {
  if (cols == null) return [];
  if (Array.isArray(cols)) return cols.map(String);
  const s = String(cols).trim();
  if (!s) return [];
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

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
  pool: Pool,
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
    const [rows] = await pool.query(
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
    for (const raw of rows as Record<string, unknown>[]) {
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
    const [rows] = await pool.query(
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
    for (const raw of rows as Record<string, unknown>[]) {
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
  pool: Pool,
  lim: number
): Promise<{ rows: Array<Record<string, unknown>>; source: MysqlSlowSource }> {
  try {
    const [digests] = await pool.query(
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
    const arr = digests as Record<string, unknown>[];
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

  const [plist] = await pool.query(
    `SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO
     FROM information_schema.PROCESSLIST
     ORDER BY TIME DESC
     LIMIT ?`,
    [lim]
  );
  return {
    source: "mysql_processlist",
    rows: (plist as Record<string, unknown>[]).map((raw) => {
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

function mysqlCallbackConnection(promiseConn: PoolConnection): MysqlCallbackConnection {
  return (promiseConn as unknown as { connection: MysqlCallbackConnection }).connection;
}

/** 断开前或新建流式查询前：销毁进行中的行流，避免连接卡在半读状态 */
export function teardownMysqlStreaming(session: MysqlSessionConnection): void {
  const s = session.mysqlRowStream;
  if (s && !s.destroyed) {
    s.destroy();
  }
  session.mysqlRowStream = undefined;
  session.mysqlRunningThreadId = undefined;
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
        resolve({
          rows,
          fieldPackets: fieldsPackets,
          hasMore: true,
        });
      }
    };

    const onEnd = () => {
      cleanup();
      resolve({
        rows,
        fieldPackets: fieldsPackets,
        hasMore: false,
      });
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

export interface MysqlDbHandlerContext {
  connectionMap: Map<string, SessionConnection>;
  getConnId: () => string;
  getS: (cid: string) => SessionConnection;
  getSWithDb: (cid: string) => SessionConnection;
  sendSSEMessage: (cid: string, msg: SSEMessage) => void;
  disconnectConnection: (cid: string) => Promise<void>;
  assertSessionDbType: (session: SessionConnection, dbType: DbKind | undefined) => void;
  capabilitiesForKind: (kind: DbKind) => DatabaseCapabilities;
  startMysqlUserClientKeepalive: (cid: string) => void;
  stopUserClientKeepalive: (session: SessionConnection) => void;
}

export async function handleMysqlDbRequest(
  method: string,
  payload: unknown,
  ctx: MysqlDbHandlerContext
): Promise<unknown> {
  const {
    connectionMap,
    getConnId,
    getS,
    getSWithDb,
    sendSSEMessage,
    disconnectConnection,
    assertSessionDbType,
    capabilitiesForKind,
    startMysqlUserClientKeepalive,
    stopUserClientKeepalive,
  } = ctx;

  const unsupported = () => {
    throw new Error(`当前 MySQL/MariaDB 连接尚不支持该操作（${method}），请使用 PostgreSQL 或等待后续版本。`);
  };

  switch (method) {
    case "db/connect": {
      const params = payload as ConnectDbRequest;
      if (params.dbType !== "mysql" && params.dbType !== "mariadb") {
        throw new Error("内部错误：db/connect 此分支须 dbType=mysql|mariadb");
      }
      const { connectionId: cid, dbType, ...connectParams } = params;
      const mysqlFamilyKind: "mysql" | "mariadb" = dbType;
      const loginParams: PostgresLoginParams = { ...connectParams, password: connectParams.password ?? "" };

      const existing = connectionMap.get(cid);
      if (existing) {
        connectionMap.delete(cid);
        stopUserClientKeepalive(existing);
        if (existing.dbKind === "postgres") {
          await existing.userUsedClient.end().catch(() => {});
        } else {
          try {
            existing.userUsedClient.release();
          } catch {
            /* ignore */
          }
        }
        await existing.backGroundPool.end().catch(() => {});
        await existing.closeTunnel?.().catch(() => {});
      }

      const db = await getMysqlDbConfig(loginParams);
      const pool = createMysqlPool(db);
      const userConn = await pool.getConnection();
      const initialDb = String(loginParams.database ?? "").trim();

      connectionMap.set(cid, {
        dbKind: mysqlFamilyKind,
        userUsedClient: userConn,
        backGroundPool: pool,
        dbForReconnect: db,
        eventPushers: new Set(),
        closeTunnel: db.closeTunnel,
        ...(initialDb ? { mysqlCurrentDatabase: initialDb } : {}),
      });
      startMysqlUserClientKeepalive(cid);
      return { success: true, connectionId: cid, dbType: mysqlFamilyKind };
    }

    case "db/disconnect": {
      const { connectionId: cid, dbType } = payload as { connectionId: string; dbType: DbKind };
      assertSessionDbType(getS(cid), dbType);
      await disconnectConnection(cid);
      return { success: true };
    }

    case "db/capabilities": {
      const { connectionId, dbType } = payload as { connectionId: string; dbType: DbKind };
      const session = getS(connectionId);
      assertSessionDbType(session, dbType);
      return { capabilities: capabilitiesForKind(session.dbKind) };
    }

    case "db/query-readonly": {
      const cid = getConnId();
      const { query, limit = 1000, defaultSchema } = payload as {
        connectionId: string;
        query: string;
        limit?: number;
        defaultSchema?: string;
      };
      const session = mysqlSession(getSWithDb, cid);
      const q = query.trim();
      const lowered = q.toLowerCase();
      const limitedQuery = /\blimit\b/i.test(lowered) ? q : `${q} LIMIT ${limit}`;

      const poolConn = await session.backGroundPool.getConnection();
      try {
        await ensureMysqlDefaultDatabase(session, poolConn, defaultSchema);
        const [rows, fields] = await poolConn.query({ sql: limitedQuery, rowsAsArray: true });
        const fp = fields as FieldPacket[] | undefined;
        const columns =
          fp?.length && fp.length > 0
            ? await calculateMysqlColumnEditable(session.backGroundPool, fp, session.mysqlCurrentDatabase)
            : [];
        return { rows: rows as unknown[][], columns, hasMore: false };
      } finally {
        poolConn.release();
      }
    }

    case "db/query-stream": {
      const cid = getConnId();
      const { query, statements: payloadStatements, batchSize = 100, defaultSchema } = payload as {
        connectionId: string;
        query?: string;
        statements?: string[];
        batchSize?: number;
        defaultSchema?: string;
      };
      const statements = payloadStatements?.length ? payloadStatements : getStatementsFromSql(query ?? "");
      if (statements.length === 0) {
        return { rows: [], columns: [], hasMore: false };
      }

      const bs = Math.max(1, batchSize ?? 100);
      const session = mysqlSession(getSWithDb, cid);
      teardownMysqlStreaming(session);

      const conn = session.userUsedClient;
      session.mysqlRunningThreadId = conn.threadId;

      let rowStream: Readable | undefined;
      try {
        await ensureMysqlDefaultDatabase(session, conn, defaultSchema);
        for (let i = 0; i < statements.length - 1; i++) {
          await conn.query(statements[i]);
        }
        const lastStatement = statements[statements.length - 1];
        const rawConn = mysqlCallbackConnection(conn);
        const cmd = rawConn.query({ sql: lastStatement, rowsAsArray: true });
        rowStream = cmd.stream({ highWaterMark: Math.max(2, bs) }) as Readable;

        const { rows, fieldPackets, hasMore } = await mysqlStreamFirstBatch(rowStream, bs);

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
        teardownMysqlStreaming(session);
        throw e;
      }
    }

    case "db/query-stream-more": {
      const cid = getConnId();
      const { batchSize = 100, defaultSchema } = payload as {
        connectionId: string;
        batchSize?: number;
        defaultSchema?: string;
      };
      const bs = Math.max(1, batchSize ?? 100);
      const session = mysqlSession(getSWithDb, cid);
      const stream = session.mysqlRowStream;
      if (!stream || stream.destroyed) {
        return { rows: [], hasMore: false };
      }
      try {
        await ensureMysqlDefaultDatabase(session, session.userUsedClient, defaultSchema);
        const { rows, done } = await mysqlStreamNextBatch(stream, bs);
        if (done) {
          teardownMysqlStreaming(session);
        }
        return { rows, hasMore: !done };
      } catch (e) {
        teardownMysqlStreaming(session);
        throw e;
      }
    }

    case "db/schemas": {
      const cid = getConnId();
      const session = mysqlSession(getSWithDb, cid);
      const excludeLower = new Set(["information_schema", "mysql", "performance_schema", "sys"]);
      const [rows] = await session.backGroundPool.query<Array<Record<string, unknown>>>("SHOW DATABASES");
      const schemas = (rows ?? [])
        .map((r) => {
          const v =
            r.Database ??
            r.database ??
            (typeof r === "object" && r !== null ? Object.values(r)[0] : undefined);
          return v != null ? String(v) : "";
        })
        .filter((name) => name.length > 0 && !excludeLower.has(name.toLowerCase()));
      return { schemas };
    }

    case "db/tables": {
      const cid = getConnId();
      const { schema } = payload as { connectionId: string; schema: string };
      const session = mysqlSession(getSWithDb, cid);
      const [resultRows] = await session.backGroundPool.query<Array<Record<string, unknown>>>(
        `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE, TABLE_NAME`,
        [schema]
      );
      const tableName = (r: Record<string, unknown>) => String(r.table_name ?? r.TABLE_NAME ?? "");
      const tableType = (r: Record<string, unknown>) => String(r.table_type ?? r.TABLE_TYPE ?? "");
      return {
        tables: resultRows.filter((r) => tableType(r) === "BASE TABLE").map((r) => tableName(r)),
        views: resultRows.filter((r) => tableType(r) === "VIEW").map((r) => tableName(r)),
        functions: [] as Array<{ oid: number; schema: string; name: string; args: string }>,
      };
    }

    case "db/columns": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const [cols] = await session.backGroundPool.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length,
         numeric_precision, numeric_scale, column_comment, extra AS identity_generation
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [schema, table]
      );
      const columns = (cols as Record<string, unknown>[]).map((r) => {
        const l = mysqlRowLowerKeys(r);
        return {
          column_name: l.column_name ?? null,
          data_type: l.data_type ?? null,
          is_nullable: l.is_nullable ?? null,
          column_default: l.column_default ?? null,
          character_maximum_length: l.character_maximum_length ?? null,
          numeric_precision: l.numeric_precision ?? null,
          numeric_scale: l.numeric_scale ?? null,
          column_comment: l.column_comment ?? null,
          identity_generation: l.identity_generation ?? null,
        };
      });
      return { columns };
    }

    case "db/save-changes": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const session = mysqlSession(getSWithDb, cid);
      const [res] = await session.backGroundPool.query(sql);
      const affected =
        res && typeof res === "object" && "affectedRows" in res
          ? Number((res as import("mysql2").ResultSetHeader).affectedRows ?? 0)
          : 0;
      sendSSEMessage(cid, {
        type: "INFO",
        message: `保存成功: ${affected} 行受影响`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: affected };
    }

    case "db/import-rows": {
      const cid = getConnId();
      const {
        schema,
        table,
        columns: colNames,
        rows,
        conflictColumns,
        onConflict,
        onError = "rollback",
      } = payload as {
        connectionId: string;
        schema: string;
        table: string;
        columns: string[];
        rows: unknown[][];
        conflictColumns?: string[];
        onConflict?: "nothing" | "update";
        onError?: "rollback" | "discard";
      };
      if (!colNames?.length || !Array.isArray(rows)) {
        throw new Error("缺少 columns 或 rows");
      }
      const session = mysqlSession(getSWithDb, cid);
      const pool = session.backGroundPool;
      const qn = (s: string) => mysqlBacktickIdent(s);
      const qualified = `${qn(schema)}.${qn(table)}`;
      const colList = colNames.map(qn).join(", ");
      const BATCH = 100;

      const buildInsert = (chunk: unknown[][]) => {
        const placeholders = chunk.map(() => "(" + colNames.map(() => "?").join(", ") + ")").join(", ");
        const flat = chunk.flatMap((row) => colNames.map((_, i) => row[i] ?? null));
        let ins = `INSERT INTO ${qualified} (${colList}) VALUES ${placeholders}`;
        if (conflictColumns?.length && onConflict === "nothing") {
          ins = ins.replace(/^INSERT/, "INSERT IGNORE");
        } else if (conflictColumns?.length && onConflict === "update") {
          const upd = colNames.map((c) => `${qn(c)}=VALUES(${qn(c)})`).join(", ");
          ins += ` ON DUPLICATE KEY UPDATE ${upd}`;
        }
        return { sql: ins, flat };
      };

      const runOne = async (chunk: unknown[][]) => {
        const { sql: ins, flat } = buildInsert(chunk);
        const [r] = await pool.query(ins, flat);
        if (r && typeof r === "object" && "affectedRows" in r) {
          return Number((r as import("mysql2").ResultSetHeader).affectedRows ?? chunk.length);
        }
        return chunk.length;
      };

      let total = 0;
      if (onError === "rollback") {
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            const { sql: ins, flat } = buildInsert(chunk);
            const [r] = await conn.query(ins, flat);
            total += r && typeof r === "object" && "affectedRows" in r
              ? Number((r as import("mysql2").ResultSetHeader).affectedRows ?? chunk.length)
              : chunk.length;
          }
          await conn.commit();
        } catch (e) {
          await conn.rollback().catch(() => {});
          throw e;
        } finally {
          conn.release();
        }
      } else {
        for (let i = 0; i < rows.length; i += BATCH) {
          const chunk = rows.slice(i, i + BATCH);
          try {
            total += await runOne(chunk);
          } catch {
            for (const row of chunk) {
              try {
                total += await runOne([row]);
              } catch {
                /* skip row */
              }
            }
          }
        }
      }
      sendSSEMessage(cid, {
        type: "INFO",
        message: `导入成功: ${total} 行`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: total };
    }

    case "db/cancel-query": {
      const cid = getConnId();
      const session = mysqlSession(getSWithDb, cid);
      const tid = session.mysqlRunningThreadId;
      if (tid == null) {
        return { success: false, cancelled: false, message: "没有正在执行的查询" };
      }
      try {
        await session.backGroundPool.query(`KILL QUERY ${Number(tid)}`);
        return { success: true, cancelled: true, message: "查询取消请求已发送" };
      } catch {
        return { success: true, cancelled: false, message: "查询可能已完成或无法取消" };
      }
    }

    case "db/explain": {
      const cid = getConnId();
      const { query, defaultSchema } = payload as { connectionId: string; query: string; defaultSchema?: string };
      const session = mysqlSession(getSWithDb, cid);
      const q = query.trim();
      sendSSEMessage(cid, { type: "QUERY", message: "执行 EXPLAIN...", timestamp: Date.now() });
      const poolConn = await session.backGroundPool.getConnection();
      try {
        await ensureMysqlDefaultDatabase(session, poolConn, defaultSchema);
        // MySQL 8.0.18+：EXPLAIN ANALYZE 会真实执行查询（与 PostgreSQL EXPLAIN ANALYZE 一致），输出树形文本
        try {
          const [analyzeRows] = await poolConn.query(`EXPLAIN ANALYZE ${q}`);
          const ar = analyzeRows as Record<string, unknown>[];
          if (ar?.length) {
            const text = ar
              .map((row) =>
                Object.values(row)
                  .map((v) => (v == null ? "" : String(v)))
                  .join("")
              )
              .join("\n")
              .trim();
            if (text) {
              sendSSEMessage(cid, {
                type: "INFO",
                message: "EXPLAIN ANALYZE 完成",
                timestamp: Date.now(),
              });
              return { plan: [{ Plan: text, Format: "mysql-analyze-text" as const }] };
            }
          }
        } catch {
          /* 版本过低或语法不支持 */
        }
        try {
          const [rows] = await poolConn.query(`EXPLAIN FORMAT=JSON ${q}`);
          const row = (rows as Record<string, unknown>[])[0];
          const raw =
            row?.EXPLAIN ??
            row?.explain ??
            Object.values(row ?? {})[0];
          const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
          const plan = Array.isArray(parsed) ? parsed : [parsed];
          sendSSEMessage(cid, { type: "INFO", message: "执行计划获取完成 (FORMAT=JSON)", timestamp: Date.now() });
          return { plan };
        } catch {
          const [lines] = await poolConn.query(`EXPLAIN ${q}`);
          const textPlan = (lines as Record<string, unknown>[]).map((r) =>
            String(Object.values(r).join("\t"))
          );
          sendSSEMessage(cid, { type: "INFO", message: "执行计划获取完成（传统 EXPLAIN 文本）", timestamp: Date.now() });
          return { plan: [{ Plan: textPlan.join("\n"), Format: "text" }] };
        }
      } finally {
        poolConn.release();
      }
    }

    case "db/indexes": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const [statRows] = await session.backGroundPool.query<
        Array<Record<string, unknown>>
      >(
        `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
        [schema, table]
      );
      const byName = new Map<
        string,
        { columns: string[]; nonUnique: number; indexType: string; indexName: string }
      >();
      for (const r of statRows ?? []) {
        const indexName = String(r.INDEX_NAME ?? r.index_name ?? "");
        const col = String(r.COLUMN_NAME ?? r.column_name ?? "");
        const nu = Number(r.NON_UNIQUE ?? r.non_unique ?? 1);
        const idxType = String(r.INDEX_TYPE ?? r.index_type ?? "BTREE");
        if (!byName.has(indexName)) {
          byName.set(indexName, { columns: [], nonUnique: nu, indexType: idxType, indexName });
        }
        byName.get(indexName)!.columns.push(col);
      }
      const indexes = [...byName.values()].map((x) => ({
        indexname: x.indexName,
        index_name: x.indexName,
        index_type: x.indexType,
        is_unique: x.nonUnique === 0,
        is_primary: x.indexName === "PRIMARY",
        columns: x.columns,
      }));
      return { indexes };
    }

    case "db/primary-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const [pk] = await session.backGroundPool.query(
        `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
         ORDER BY ORDINAL_POSITION`,
        [schema, table]
      );
      return {
        columns: (pk as Array<{ COLUMN_NAME?: string; column_name?: string }>).map((r) =>
          String(r.COLUMN_NAME ?? r.column_name ?? "")
        ),
      };
    }

    case "db/unique-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const [ucRows] = await session.backGroundPool.query(
        `SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE,
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
        [schema, table]
      );
      const constraints = (ucRows as Array<Record<string, unknown>>).map((r) => ({
        name: String(r.CONSTRAINT_NAME ?? r.constraint_name ?? ""),
        type: String(r.CONSTRAINT_TYPE ?? r.constraint_type ?? ""),
        columns: splitGroupConcat(r.cols ?? r.COLS),
      }));
      return { constraints };
    }

    case "db/data-types": {
      const cid = getConnId();
      const session = mysqlSession(getSWithDb, cid);
      const [trows] = await session.backGroundPool.query(
        `SELECT DISTINCT DATA_TYPE AS name FROM information_schema.COLUMNS ORDER BY DATA_TYPE`
      );
      const fromDb = (trows as Array<{ name?: string; NAME?: string }>).map((r) =>
        String(r.name ?? r.NAME ?? "")
      ).filter(Boolean);
      const builtins = [
        "tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "numeric",
        "float", "double", "bit", "date", "time", "datetime", "timestamp", "year", "char",
        "varchar", "binary", "varbinary", "blob", "text", "enum", "set", "json", "geometry",
      ];
      return { types: [...new Set([...fromDb, ...builtins])].sort() };
    }

    case "db/execute-ddl": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const session = mysqlSession(getSWithDb, cid);
      try {
        sendSSEMessage(cid, {
          type: "QUERY",
          message: `执行 DDL: ${sql.slice(0, 80)}...`,
          timestamp: Date.now(),
        });
        await session.backGroundPool.query(sql);
        sendSSEMessage(cid, { type: "INFO", message: "DDL 执行成功", timestamp: Date.now() });
        return { success: true };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        sendSSEMessage(cid, { type: "ERROR", message: `DDL 错误: ${msg}`, timestamp: Date.now() });
        throw e;
      }
    }

    case "db/foreign-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const [outgoing] = await session.backGroundPool.query(
        `SELECT kcu.CONSTRAINT_NAME,
         kcu.COLUMN_NAME AS source_column,
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
        [schema, table]
      );
      const [incoming] = await session.backGroundPool.query(
        `SELECT kcu.CONSTRAINT_NAME,
         kcu.TABLE_SCHEMA AS source_schema, kcu.TABLE_NAME AS source_table,
         kcu.COLUMN_NAME AS source_column,
         kcu.REFERENCED_TABLE_SCHEMA AS target_schema,
         kcu.REFERENCED_TABLE_NAME AS target_table,
         kcu.REFERENCED_COLUMN_NAME AS target_column
         FROM information_schema.KEY_COLUMN_USAGE kcu
         WHERE kcu.REFERENCED_TABLE_SCHEMA = ? AND kcu.REFERENCED_TABLE_NAME = ?`,
        [schema, table]
      );
      const mapFkRow = (r: Record<string, unknown>) => {
        const l = mysqlRowLowerKeys(r);
        return {
          constraint_name: l.constraint_name ?? null,
          source_column: l.source_column ?? null,
          target_schema: l.target_schema ?? null,
          target_table: l.target_table ?? null,
          target_column: l.target_column ?? null,
          delete_rule: l.delete_rule ?? null,
          update_rule: l.update_rule ?? null,
          source_schema: l.source_schema ?? null,
          source_table: l.source_table ?? null,
        };
      };
      return {
        outgoing: (outgoing as Record<string, unknown>[]).map((r) => mapFkRow(r)),
        incoming: (incoming as Record<string, unknown>[]).map((r) => mapFkRow(r)),
      };
    }

    case "db/table-ddl": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const pool = session.backGroundPool;
      const db = mysqlBacktickIdent(schema);
      const tb = mysqlBacktickIdent(table);
      const [tblMeta] = await pool.query(
        `SELECT TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [schema, table]
      );
      if (!(tblMeta as unknown[]).length) {
        throw new Error(`表或视图 ${schema}.${table} 不存在`);
      }
      const tt = String((tblMeta as Record<string, unknown>[])[0]?.TABLE_TYPE ?? "BASE TABLE");
      if (tt === "VIEW") {
        const [cr] = await pool.query(`SHOW CREATE VIEW ${db}.${tb}`);
        const row = (cr as Record<string, unknown>[])[0];
        const ddl = String(row?.["Create View"] ?? row?.["create view"] ?? "");
        return { ddl };
      }
      const [cr] = await pool.query(`SHOW CREATE TABLE ${db}.${tb}`);
      const row = (cr as Record<string, unknown>[])[0];
      const ddl = String(row?.["Create Table"] ?? row?.["create table"] ?? "");
      return { ddl };
    }

    case "db/function-ddl": {
      const cid = getConnId();
      const { schema, function: funcName } = payload as { connectionId: string; schema: string; function: string };
      const session = mysqlSession(getSWithDb, cid);
      const pool = session.backGroundPool;
      const [rt] = await pool.query(
        `SELECT ROUTINE_TYPE FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ? LIMIT 1`,
        [schema, funcName]
      );
      if (!(rt as unknown[]).length) {
        throw new Error(`例程 ${schema}.${funcName} 不存在`);
      }
      const typ = String((rt as Record<string, unknown>[])[0]?.ROUTINE_TYPE ?? "FUNCTION").toUpperCase();
      const db = mysqlBacktickIdent(schema);
      const fn = mysqlBacktickIdent(funcName);
      if (typ === "PROCEDURE") {
        const [cr] = await pool.query(`SHOW CREATE PROCEDURE ${db}.${fn}`);
        const row = (cr as Record<string, unknown>[])[0];
        return { ddl: String(row?.["Create Procedure"] ?? "") };
      }
      const [crf] = await pool.query(`SHOW CREATE FUNCTION ${db}.${fn}`);
      const rowf = (crf as Record<string, unknown>[])[0];
      return { ddl: String(rowf?.["Create Function"] ?? "") };
    }

    case "db/schema-dump": {
      const cid = getConnId();
      const { schema, includeData = false } = payload as { connectionId: string; schema: string; includeData?: boolean };
      const session = mysqlSession(getSWithDb, cid);
      const pool = session.backGroundPool;
      sendSSEMessage(cid, {
        type: "QUERY",
        message: `导出库 ${schema}${includeData ? "（含数据）" : ""}...`,
        timestamp: Date.now(),
      });
      const parts: string[] = [`-- MySQL database: ${schema}\n\n`];
      const [objs] = await pool.query(
        `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_TYPE DESC, TABLE_NAME`,
        [schema]
      );
      const escapeVal = (v: unknown): string => {
        if (v === null || v === undefined) return "NULL";
        if (typeof v === "number" && !Number.isNaN(v)) return String(v);
        if (typeof v === "boolean") return v ? "1" : "0";
        if (Buffer.isBuffer(v)) return "0x" + v.toString("hex");
        const s = String(v);
        return "N'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
      };
      for (const o of objs as Array<Record<string, unknown>>) {
        const tname = String(o.TABLE_NAME ?? o.table_name ?? "");
        const ttyp = String(o.TABLE_TYPE ?? o.table_type ?? "");
        const db = mysqlBacktickIdent(schema);
        const tb = mysqlBacktickIdent(tname);
        try {
          if (ttyp === "VIEW") {
            const [cr] = await pool.query(`SHOW CREATE VIEW ${db}.${tb}`);
            const row = (cr as Record<string, unknown>[])[0];
            parts.push(String(row?.["Create View"] ?? "") + ";\n\n");
          } else {
            const [cr] = await pool.query(`SHOW CREATE TABLE ${db}.${tb}`);
            const row = (cr as Record<string, unknown>[])[0];
            parts.push(String(row?.["Create Table"] ?? "") + ";\n\n");
            if (includeData && ttyp === "BASE TABLE") {
              const [dataRows] = await pool.query({ sql: `SELECT * FROM ${db}.${tb}`, rowsAsArray: true });
              const matrix = toRowArray(dataRows);
              if (matrix.length) {
                const [colRes] = await pool.query(
                  `SELECT COLUMN_NAME FROM information_schema.COLUMNS
                   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
                  [schema, tname]
                );
                const cols = (colRes as Array<{ COLUMN_NAME?: string }>).map((c) =>
                  mysqlBacktickIdent(String(c.COLUMN_NAME ?? ""))
                );
                const colList = cols.join(", ");
                const batchSize = 100;
                for (let i = 0; i < matrix.length; i += batchSize) {
                  const batch = matrix.slice(i, i + batchSize);
                  const values = batch.map((row) => "(" + row.map(escapeVal).join(", ") + ")").join(",\n  ");
                  parts.push(`INSERT INTO ${db}.${tb} (${colList}) VALUES\n  ${values};\n\n`);
                }
              }
            }
          }
        } catch {
          parts.push(`-- skip ${tname}\n\n`);
        }
      }
      const [routines] = await pool.query(
        `SELECT ROUTINE_NAME, ROUTINE_TYPE FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ?`,
        [schema]
      );
      for (const r of routines as Array<Record<string, unknown>>) {
        const rn = String(r.ROUTINE_NAME ?? r.routine_name ?? "");
        const rt = String(r.ROUTINE_TYPE ?? r.routine_type ?? "");
        const db = mysqlBacktickIdent(schema);
        const rb = mysqlBacktickIdent(rn);
        try {
          if (rt.toUpperCase() === "PROCEDURE") {
            const [cr] = await pool.query(`SHOW CREATE PROCEDURE ${db}.${rb}`);
            parts.push(String((cr as Record<string, unknown>[])[0]?.["Create Procedure"] ?? "") + ";\n\n");
          } else {
            const [cr] = await pool.query(`SHOW CREATE FUNCTION ${db}.${rb}`);
            parts.push(String((cr as Record<string, unknown>[])[0]?.["Create Function"] ?? "") + ";\n\n");
          }
        } catch {
          parts.push(`-- skip routine ${rn}\n\n`);
        }
      }
      sendSSEMessage(cid, { type: "INFO", message: `库 ${schema} 导出完成`, timestamp: Date.now() });
      return { dump: parts.join("") };
    }

    case "db/database-dump": {
      const cid = getConnId();
      const { includeData = false } = payload as { connectionId: string; includeData?: boolean };
      const session = mysqlSession(getSWithDb, cid);
      const pool = session.backGroundPool;
      sendSSEMessage(cid, {
        type: "QUERY",
        message: `导出实例（多库）${includeData ? "（含数据）" : ""}...`,
        timestamp: Date.now(),
      });
      const exclude = new Set(["information_schema", "mysql", "performance_schema", "sys"]);
      const [dbs] = await pool.query<Array<Record<string, unknown>>>("SHOW DATABASES");
      const names = (dbs ?? [])
        .map((r) => String(r.Database ?? r.database ?? Object.values(r)[0] ?? ""))
        .filter((n) => n && !exclude.has(n.toLowerCase()));
      const parts: string[] = [
        session.dbKind === "mariadb" ? "-- MariaDB multi-database dump\n\n" : "-- MySQL multi-database dump\n\n",
      ];
      for (const dbName of names) {
        const { dump } = (await handleMysqlDbRequest(
          "db/schema-dump",
          { connectionId: cid, dbType: session.dbKind, schema: dbName, includeData },
          ctx
        )) as { dump: string };
        parts.push(dump);
      }
      sendSSEMessage(cid, { type: "INFO", message: "多库导出完成", timestamp: Date.now() });
      return { dump: parts.join("\n") };
    }

    case "db/query": {
      const cid = getConnId();
      const { query, defaultSchema } = payload as { connectionId: string; query: string; defaultSchema?: string };
      const session = mysqlSession(getSWithDb, cid);
      const conn = session.userUsedClient;
      session.mysqlRunningThreadId = conn.threadId;
      try {
        await ensureMysqlDefaultDatabase(session, conn, defaultSchema);
        sendSSEMessage(cid, {
          type: "QUERY",
          message: `执行查询: ${query.slice(0, 100)}...`,
          timestamp: Date.now(),
        });
        const [raw, fields] = await conn.query({ sql: query.trim(), rowsAsArray: true });
        const result = toRowArray(raw);
        const fp = fields as FieldPacket[] | undefined;
        const columns =
          fp?.length && fp.length > 0
            ? await calculateMysqlColumnEditable(session.backGroundPool, fp, session.mysqlCurrentDatabase)
            : [];
        sendSSEMessage(cid, {
          type: "INFO",
          message: `完成: ${result.length} 行`,
          timestamp: Date.now(),
        });
        return { result, columns };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        sendSSEMessage(cid, { type: "ERROR", message: `查询错误: ${msg}`, timestamp: Date.now() });
        throw e;
      } finally {
        session.mysqlRunningThreadId = undefined;
      }
    }

    case "db/table-comment": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const [rows] = await session.backGroundPool.query(
        `SELECT TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [schema, table]
      );
      const c = (rows as Array<{ TABLE_COMMENT?: string; table_comment?: string }>)[0];
      const comment = c?.TABLE_COMMENT ?? c?.table_comment ?? null;
      return { comment: comment && String(comment).trim() ? String(comment) : null };
    }

    case "db/check-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      try {
        const [rows] = await session.backGroundPool.query(
          `SELECT cc.CONSTRAINT_NAME AS name, cc.CHECK_CLAUSE AS expression
           FROM information_schema.CHECK_CONSTRAINTS cc
           JOIN information_schema.TABLE_CONSTRAINTS tc
             ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
            AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
           WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? AND tc.CONSTRAINT_TYPE = 'CHECK'`,
          [schema, table]
        );
        const constraints = (rows as Record<string, unknown>[]).map((r) => {
          const l = mysqlRowLowerKeys(r);
          return {
            name: l.name ?? null,
            expression: l.expression ?? null,
          };
        });
        return { constraints };
      } catch {
        return { constraints: [] };
      }
    }

    case "db/partition-info": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = mysqlSession(getSWithDb, cid);
      const [prows] = await session.backGroundPool.query(
        `SELECT PARTITION_NAME, PARTITION_METHOD, PARTITION_EXPRESSION, SUBPARTITION_METHOD,
                PARTITION_DESCRIPTION
         FROM information_schema.PARTITIONS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND PARTITION_NAME IS NOT NULL
         ORDER BY PARTITION_ORDINAL_POSITION`,
        [schema, table]
      );
      const plist = prows as Array<Record<string, unknown>>;
      if (!plist.length) {
        return { role: "none" as const };
      }
      const row0 = mysqlRowLowerKeys(plist[0] as Record<string, unknown>);
      const method = String(row0.partition_method ?? "");
      const expr = String(row0.partition_expression ?? "");
      return {
        role: "parent" as const,
        strategy: method.toLowerCase() || null,
        partitionKey: expr || null,
        partitions: plist.map((raw) => {
          const r = mysqlRowLowerKeys(raw as Record<string, unknown>);
          const pname = String(r.partition_name ?? "");
          const desc = String(r.partition_description ?? "").trim();
          return {
            schema,
            name: pname,
            qualified: `${schema}.${pname}`,
            bound: desc,
          };
        }),
      };
    }

    case "db/explain-text": {
      const cid = getConnId();
      const { query } = payload as { connectionId: string; query: string };
      const session = mysqlSession(getSWithDb, cid);
      const q = query.trim();
      if (!q) throw new Error("SQL 为空");
      const [rows] = await session.backGroundPool.query(`EXPLAIN ${q}`);
      const lines = (rows as Record<string, unknown>[]).map((row) =>
        Object.entries(row)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" | ")
      );
      return { lines };
    }

    case "db/session-monitor": {
      const cid = getConnId();
      const { limit = 20 } = payload as { connectionId: string; limit?: number };
      const lim = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 5), 200) : 20;
      const session = mysqlSession(getSWithDb, cid);
      try {
        const pool = session.backGroundPool;
        const [statsRows] = await pool.query(
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
        const s0 = mysqlRowLowerKeys((statsRows as Record<string, unknown>[])[0] ?? {});
        const connectionStats = {
          total: Number(s0.total ?? 0),
          active: Number(s0.active ?? 0),
          idle: Number(s0.idle ?? 0),
          waiting: Number(s0.waiting ?? 0),
        };
        const lockWaits = await mysqlStatLockWaits(pool, lim);
        const { rows: slowQueries, source: slowQuerySource } = await mysqlFetchSlowQueries(pool, lim);
        return {
          connectionStats,
          lockWaits,
          slowQueries,
          slowQuerySource,
          collectedAt: Date.now(),
        };
      } catch (e: unknown) {
        throw new Error(`session-monitor: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    case "db/installed-extensions": {
      return {
        extensions: [] as Array<{
          name: string;
          installedVersion: string;
          schema: string;
          relocatable: boolean;
          defaultVersion: string | null;
          description: string | null;
        }>,
      };
    }

    case "db/session-control": {
      const cid = getConnId();
      const { pid, action } = payload as { connectionId: string; pid: number; action: "cancel" | "terminate" };
      const pidInt = Math.floor(Number(pid));
      if (!Number.isFinite(pidInt) || pidInt <= 0) throw new Error("pid 非法");
      const session = mysqlSession(getSWithDb, cid);
      const self = session.userUsedClient.threadId;
      if (pidInt === self) {
        throw new Error("不允许结束当前会话自身线程");
      }
      const sql = action === "terminate" ? `KILL ${pidInt}` : `KILL QUERY ${pidInt}`;
      try {
        await session.backGroundPool.query(sql);
        return { success: true, pid: pidInt, action };
      } catch {
        return { success: false, pid: pidInt, action };
      }
    }

    default:
      unsupported();
  }
}
