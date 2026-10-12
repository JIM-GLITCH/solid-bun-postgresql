/**
 * MySQL / MariaDB 连接工厂：把 `MysqlSessionConnection` 的句柄包装成 `DbConnector`。
 *
 * 业务 handler 只看到 `DbConnector`，不再读写 session 上的
 * `userUsedClient` / `backGroundPool` / `mysqlRowStream` / `mysqlRunningThreadId` / `mysqlCurrentDatabase`。
 *
 * 轨道 B（会话专用连接）：MySQL 的 `userUsedClient` 是**从池里借走不还**的一条 `PoolConnection`，
 * 承担 db/query 与游标流式；元数据走 `backGroundPool`。两者必须可并行（见设计文档 §5.4/§5.5）。
 */

import type { Connection as MysqlCallbackConnection, FieldPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import type { Readable } from "node:stream";
import { getSqlSegments, type DatabaseCapabilities, type SSEMessage } from "../../shared/src";
import { calculateMysqlColumnEditable } from "../mysql-column-editable";
import type { MysqlSessionConnection } from "../session-connection";
import type { BorrowedClient, DbConnector, QueryResult, QuerySpec, SessionInfo, StreamBatch, StreamPlan } from "./contract";
import { buildMysqlSchemaContext } from "./schema-context";

/** 与 api-core 的 getStatements 同源 */
function splitStatements(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

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

/** 会话内销毁进行中的行流（与 sessions.ts 的 teardownMysqlStreaming 同义，此处避免反向依赖） */
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
  /** 判定「会话专用连接已死」 */
  isDeadError: (e: unknown) => boolean;
  /** 重建会话专用连接（连接层实现） */
  recreateUserClient: () => Promise<void>;
}

export function createMysqlConnector(
  session: MysqlSessionConnection,
  deps: MysqlConnectorDeps
): DbConnector {
  /** 仅在请求显式带了 defaultSchema 时执行 USE，避免每次查询都多一轮 USE */
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

  /**
   * array 行模式：mysql2 promise API 对**从池借出的连接**支持 `rowsAsArray`
   * （注意：promise 池对象本身没有 `.connection`，必须从借出的 `PoolConnection` 上取）。
   *
   * 实测返回形态有两种，必须正确区分，否则会把字段元数据当成数据行：
   *  - 元组 `[rows, fields]`（常见）→ 取 `[0]` 为行
   *  - 对象 `{ rows, fields }` → 取 `rows`
   */
  const arrayRowsFrom = async (
    conn: { query: (opts: { sql: string; rowsAsArray: true }) => Promise<unknown> },
    text: string
  ): Promise<QueryResult<unknown[]>> => {
    const res = (await conn.query({ sql: text, rowsAsArray: true })) as unknown;

    if (Array.isArray(res)) {
      const a = res as unknown[];
      const first = a[0];
      const maybeFields = a[1];
      // 元组形态：第一个元素是行矩阵，第二个元素是字段数组
      if (Array.isArray(first) && (maybeFields === undefined || Array.isArray(maybeFields))) {
        const rows = first as unknown[][];
        return { rows, rowCount: rows.length, fields: maybeFields as FieldPacket[] | undefined };
      }
      // 裸行矩阵
      return { rows: a as unknown[][], rowCount: a.length };
    }

    const obj = res as { rows?: unknown[][]; fields?: FieldPacket[] } | undefined;
    const rows = Array.isArray(obj?.rows) ? (obj!.rows as unknown[][]) : [];
    return { rows, rowCount: rows.length, fields: obj?.fields };
  };

  const queryRowsAsArray = async (text: string): Promise<QueryResult<unknown[]>> => {
    const conn = await session.backGroundPool.getConnection();
    try {
      return await arrayRowsFrom(conn as unknown as { query: (o: { sql: string; rowsAsArray: true }) => Promise<unknown> }, text);
    } finally {
      conn.release();
    }
  };

  const connector: DbConnector = {
    connectionId: deps.connectionId,
    dbKind: session.dbKind,
    capabilities: deps.capabilities,

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

    async queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      const text = typeof spec === "string" ? spec : spec.text;
      const values = typeof spec === "string" ? params : spec.values;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await session.userUsedClient.query(text, values as any[] | undefined);
          return toResult<Row>(res);
        } catch (e) {
          if (attempt === 0 && deps.isDeadError(e)) {
            lastErr = e;
            await deps.recreateUserClient();
            continue;
          }
          throw e;
        }
      }
      throw lastErr;
    },

    async queryWithDefaultSchema<Row = any>(text: string, defaultSchema?: string): Promise<QueryResult<Row>> {
      const conn = session.userUsedClient;
      await ensureDefaultDatabase(defaultSchema);
      // 会话专用连接上同样返回 [rows, fields] 元组（db/query 依赖数组行）
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

    async stream(plan: StreamPlan): Promise<StreamBatch> {
      const statements = plan.statements?.length ? plan.statements : splitStatements(plan.sql ?? "");
      if (statements.length === 0) return { rows: [], hasMore: false, columns: [] };
      const bs = Math.max(1, plan.batchSize);

      teardownRowStream(session);
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
        teardownRowStream(session);
        throw e;
      }
    },

    async streamMore({ batchSize, defaultSchema }): Promise<StreamBatch> {
      const bs = Math.max(1, batchSize);
      const stream = session.mysqlRowStream;
      if (!stream || stream.destroyed) {
        return { rows: [], hasMore: false };
      }
      try {
        await ensureDefaultDatabase(defaultSchema);
        const { rows, done } = await mysqlStreamNextBatch(stream, bs);
        if (done) {
          teardownRowStream(session);
        }
        return { rows, hasMore: !done };
      } catch (e) {
        teardownRowStream(session);
        throw e;
      }
    },

    async teardownStream(): Promise<void> {
      teardownRowStream(session);
    },

    async dispose(): Promise<void> {
      teardownRowStream(session);
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

    sessionInfo(): SessionInfo {
      return { connectionId: deps.connectionId, dbKind: session.dbKind, currentDatabase: session.mysqlCurrentDatabase };
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

    // Phase 2 用 PubSub 实现；当前传输层仍直接订阅 sessions 的事件推送
    watch(): AsyncIterable<SSEMessage> {
      return (async function* () {})();
    },
  };

  return connector;
}
