/**
 * PostgreSQL 连接工厂：把 `PostgresSessionConnection` 的句柄包装成 `DbConnector`。
 *
 * 业务 handler 只看到 `DbConnector`，不再读写 session 上的
 * `userUsedClient` / `backGroundPool` / `cursor` / `runningQueryPid`。
 *
 * 游标与「执行中 pid」的存活跨 `db/query-stream` ↔ `db/query-stream-more` 两个请求，
 * 因此由本工厂在会话生命周期内持有（Phase 2 会改为 Effect 的 per-connection Scope）。
 */

import Cursor from "pg-cursor";
import { getSqlSegments, type DatabaseCapabilities, type SSEMessage } from "../../shared/src";
import { calculateColumnEditable } from "../column-editable";
import type { PostgresSessionConnection } from "../session-connection";
import type { BorrowedClient, DbConnector, QueryResult, QuerySpec, SessionInfo, StreamBatch, StreamPlan } from "./contract";
import { buildPostgresSchemaContext } from "./schema-context";

/** 与 api-core 的 getStatements 同源：按不在引号/注释内的 ; 拆分，仅不分空行 */
function splitStatements(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

export interface PgConnectorDeps {
  connectionId: string;
  capabilities: DatabaseCapabilities;
  /** 判定「查询专用连接已死」（连接层实现，保持既有正则语义） */
  isDeadError: (e: unknown) => boolean;
  /** 重建查询专用连接（连接层实现） */
  recreateUserClient: () => Promise<void>;
}

export function createPgConnector(
  session: PostgresSessionConnection,
  deps: PgConnectorDeps
): DbConnector {
  /** 跨批次存活的游标 */
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

  const connector: DbConnector = {
    connectionId: deps.connectionId,
    dbKind: "postgres",
    capabilities: deps.capabilities,

    async query<Row = any>(
      spec: string | QuerySpec,
      params?: readonly unknown[]
    ): Promise<QueryResult<Row>> {
      const res = await session.backGroundPool.query(spec as any, params as any[] | undefined);
      return { rows: res.rows as Row[], rowCount: res.rowCount ?? undefined, fields: res.fields };
    },

    async queryAsUser<Row = any>(
      spec: string | QuerySpec,
      params?: readonly unknown[]
    ): Promise<QueryResult<Row>> {
      const config: QuerySpec =
        typeof spec === "string" ? { text: spec, values: params as unknown[] | undefined } : spec;
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
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

    async stream(plan: StreamPlan): Promise<StreamBatch> {
      const statements = plan.statements?.length ? plan.statements : splitStatements(plan.sql ?? "");
      if (statements.length === 0) return { rows: [], hasMore: false, columns: [] };
      const batchSize = plan.batchSize;

      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        const client = session.userUsedClient;
        try {
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
          const columnsInfo = fields ? await calculateColumnEditable(session.backGroundPool, fields, lastStatement) : [];
          const isDone = rows.length < batchSize;

          if (isDone) {
            await closeCursor();
          } else {
            cursorState = { instance: cursor, isDone: false };
          }

          return { rows, hasMore: !isDone, columns: columnsInfo };
        } catch (e) {
          lastErr = e;
          if (attempt === 0 && deps.isDeadError(e)) {
            await deps.recreateUserClient();
            continue;
          }
          throw e;
        }
      }
      throw lastErr;
    },

    async streamMore({ batchSize }): Promise<StreamBatch> {
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

    async teardownStream(): Promise<void> {
      await closeCursor();
    },

    async dispose(): Promise<void> {
      await closeCursor();
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

    sessionInfo(): SessionInfo {
      return { connectionId: deps.connectionId, dbKind: "postgres" };
    },

    buildSchemaContext(schema?: string) {
      return buildPostgresSchemaContext(session.backGroundPool, schema);
    },

    // Phase 2 用 PubSub 实现；当前传输层仍直接订阅 sessions 的事件推送
    watch(): AsyncIterable<SSEMessage> {
      return (async function* () {})();
    },
  };

  return connector;
}
