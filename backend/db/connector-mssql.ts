/**
 * SQL Server 连接工厂：把 `SqlServerSessionConnection` 的句柄包装成 `DbConnector`。
 *
 * 与 PG/MySQL 的差异（见设计文档 §5.4）：
 * - `userUsedClient === backGroundPool`：SQL Server **只有一个共享池**（`sql.ConnectionPool`），
 *   没有独立的会话专用长连接；并发靠池内多条底层连接。
 * - 取消走 `Request.cancel()`（同一 TCP 上发 attention 包），不需要额外连接。
 * - `sqlserver-support` 的若干 helper 直接吃 `ConnectionPool`，因此连接器额外暴露
 *   `nativePool()`（方法而非属性，契约上仍是能力而非句柄直传）。
 */

import sql from "mssql";
import type { DatabaseCapabilities, SSEMessage } from "../../shared/src";
import type { SqlServerSessionConnection } from "../session-connection";
import { teardownSqlServerRowStream } from "../sqlserver-mssql-query";
import {
  drainSqlServerStreamBatch,
  startSqlServerStreamingQuery,
  type SqlServerStreamingQueryHandle,
} from "../sqlserver-mssql-stream";
import { sqlServerSessionControl as sqlServerSessionControlImpl, buildSqlServerSchemaContext } from "../sqlserver-support";
import type { DbConnector, QueryResult, QuerySpec, SessionInfo, StreamBatch, StreamPlan } from "./contract";

export interface MssqlConnectorDeps {
  connectionId: string;
  capabilities: DatabaseCapabilities;
}

export function createMssqlConnector(
  session: SqlServerSessionConnection,
  deps: MssqlConnectorDeps
): DbConnector {
  const textOf = (spec: string | QuerySpec): string => (typeof spec === "string" ? spec : spec.text);

  const connector: DbConnector = {
    connectionId: deps.connectionId,
    dbKind: "sqlserver",
    capabilities: deps.capabilities,

    async query<Row = any>(spec: string | QuerySpec, _params?: readonly unknown[]): Promise<QueryResult<Row>> {
      const result = await session.backGroundPool.request().query(textOf(spec));
      const rows = (result.recordset ?? []) as Row[];
      return {
        rows,
        recordset: rows,
        rowCount: Array.isArray(result.rowsAffected)
          ? result.rowsAffected.reduce((a: number, b: number) => a + b, 0)
          : undefined,
      };
    },

    /** SQL Server 无独立会话连接：与 query 同为共享池（保持语义显式） */
    async queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      return connector.query<Row>(spec, params);
    },

    async withPoolClient<T>(): Promise<T> {
      // SQL Server 的「借一条连接」由 mssql 池内部完成（request/transaction），
      // 业务侧通过 nativePool() + sql.Transaction 表达事务，故此处不提供伪借用。
      throw new Error("SQL Server 不支持 withPoolClient；请使用 connector.nativePool() + sql.Transaction");
    },

    async stream(plan: StreamPlan): Promise<StreamBatch> {
      const statements = plan.statements?.length
        ? plan.statements
        : (plan.sql ?? "")
            .split(";")
            .map((s) => s.trim())
            .filter(Boolean);
      if (statements.length === 0) return { rows: [], hasMore: false, columns: [] };
      const bs = Math.max(1, plan.batchSize);
      const pool = session.backGroundPool;

      if (session.sqlServerRowStream) {
        await teardownSqlServerRowStream(session.sqlServerRowStream);
        session.sqlServerRowStream = undefined;
      }

      const h: SqlServerStreamingQueryHandle = await startSqlServerStreamingQuery(pool, {
        preambleBatches: statements.slice(0, -1),
        selectSql: statements[statements.length - 1]!,
        browseSourceSql: statements[statements.length - 1]!,
        batchSize: bs,
      });

      // 列可编辑性由业务侧装配（需要 browse 元数据 + TDS 列信息，属业务判定）
      let columns: StreamBatch["columns"];
      if (plan.streamColumnsFor) {
        try {
          columns = await plan.streamColumnsFor(h);
        } catch (e) {
          await teardownSqlServerRowStream(h);
          throw e;
        }
      }

      const { rows, hasMore } = await drainSqlServerStreamBatch(h, bs);
      if (hasMore) {
        session.sqlServerRowStream = h;
      } else {
        await teardownSqlServerRowStream(h);
      }
      return { rows, hasMore, columns };
    },

    async streamMore({ batchSize }): Promise<StreamBatch> {
      const h = session.sqlServerRowStream;
      if (!h) return { rows: [], hasMore: false };
      try {
        const { rows, hasMore } = await drainSqlServerStreamBatch(h, Math.max(1, batchSize));
        if (!hasMore) {
          session.sqlServerRowStream = undefined;
          await teardownSqlServerRowStream(h);
        }
        return { rows, hasMore };
      } catch (e) {
        session.sqlServerRowStream = undefined;
        await teardownSqlServerRowStream(h);
        throw e;
      }
    },

    async teardownStream(): Promise<void> {
      const h = session.sqlServerRowStream;
      session.sqlServerRowStream = undefined;
      await teardownSqlServerRowStream(h);
    },

    async dispose(): Promise<void> {
      await connector.teardownStream();
      session.sqlServerActiveRequest = undefined;
    },

    async cancelCurrentQuery(): Promise<{ cancelled: boolean; message?: string }> {
      const stream = session.sqlServerRowStream;
      if (stream?.mssqlRequest) {
        try {
          stream.mssqlRequest.cancel();
        } catch {
          /* ignore */
        }
        // 流式中断需 teardown 才能把事务与连接归还池
        session.sqlServerRowStream = undefined;
        await teardownSqlServerRowStream(stream);
        return { cancelled: true, message: "已请求中断流式查询" };
      }
      const ar = session.sqlServerActiveRequest;
      if (ar) {
        try {
          ar.cancel();
        } catch {
          /* ignore */
        }
        return { cancelled: true, message: "已请求中断查询" };
      }
      return { cancelled: false, message: "没有正在执行的查询" };
    },

    sessionThreadId(): number | undefined {
      return undefined; // SQL Server 侧由 sqlServerGetOwnSpid 动态查询，不做会话级登记
    },

    sessionInfo(): SessionInfo {
      return { connectionId: deps.connectionId, dbKind: "sqlserver" };
    },

    /** SQL Server 专用：暴露共享池给 `sqlserver-support` 的 helper 与事务编排 */
    nativePool(): unknown {
      return session.backGroundPool;
    },

    buildSchemaContext(schema?: string) {
      return buildSqlServerSchemaContext(session.backGroundPool, schema);
    },

    // Phase 2 用 PubSub 实现；当前传输层仍直接订阅 sessions 的事件推送
    watch(): AsyncIterable<SSEMessage> {
      return (async function* () {})();
    },

    setActiveRequest(request: unknown): void {
      session.sqlServerActiveRequest = (request ?? undefined) as never;
    },

    async sessionControl(target: number, action: "cancel" | "terminate"): Promise<boolean> {
      return sqlServerSessionControlImpl(session.backGroundPool, target, action);
    },
  };

  return connector;
}

/** 仅供 SQL Server 使用：把原生池取回并标注类型（避免业务模块 import mssql 类型） */
export function mssqlPoolOf(connector: DbConnector): sql.ConnectionPool {
  const pool = (connector as DbConnector & { nativePool?: () => unknown }).nativePool?.();
  if (!pool) throw new Error("内部错误：SQL Server 连接器未提供原生池");
  return pool as sql.ConnectionPool;
}
