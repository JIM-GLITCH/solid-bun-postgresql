/**
 * SQL Server Strategy
 * SQL Server 特定的 SQL 模板和逻辑
 */

import sql from "mssql";
import { Effect } from "effect";
import type { DatabaseCapabilities } from "../../../shared/src";
import type { SqlServerSessionConnection } from "../../session-connection";
import { teardownSqlServerRowStream } from "../../sqlserver-mssql-query";
import {
  drainSqlServerStreamBatch,
  startSqlServerStreamingQuery,
  type SqlServerStreamingQueryHandle,
} from "../../sqlserver-mssql-stream";
import {
  sqlServerSessionControl as sqlServerSessionControlImpl,
  sqlServerFetchSessionMonitor,
  sqlServerFetchExplainTextLines,
  sqlServerGetOwnSpid,
  buildSqlServerSchemaContext,
} from "../../sqlserver-support";
import { createConnector, type ConnectorStrategy } from "../../db/connector";
import type { DbConnector, QueryResult, QuerySpec, StreamBatch } from "../../db/contract";
import type { Strategy } from "../db-service-effect";

export const sqlserverStrategy: Strategy = {
  dbType: 'sqlserver' as const,
  
  quoteIdentifier: (id) => `[${id.replace(/\]/g, ']]')}]`,
  buildPlaceholder: (index) => `@param${index}`,
  
  metadataQueries: {
    schemas: `SELECT SCHEMA_NAME AS schema_name
              FROM INFORMATION_SCHEMA.SCHEMATA
              WHERE SCHEMA_NAME NOT IN (
                N'guest', N'INFORMATION_SCHEMA', N'sys', N'db_owner', N'db_accessadmin',
                N'db_backupoperator', N'db_datareader', N'db_datawriter', N'db_ddladmin',
                N'db_denydatareader', N'db_denydatawriter', N'db_securityadmin'
              )
              ORDER BY SCHEMA_NAME`,
    
    tables: `SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
             FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA = @sch
             ORDER BY TABLE_TYPE, TABLE_NAME`,
    
    columns: `SELECT column_name, data_type, is_nullable, column_default,
               character_maximum_length, numeric_precision, numeric_scale
               FROM information_schema.COLUMNS 
               WHERE TABLE_SCHEMA = @sch AND TABLE_NAME = @tbl 
               ORDER BY ORDINAL_POSITION`,
    
    indexes: `SELECT i.name AS index_name, i.type_desc AS index_type,
               i.is_unique AS is_unique, i.is_primary_key AS is_primary,
               c.name AS column_name, ic.key_ordinal
               FROM sys.indexes i
               INNER JOIN sys.tables t ON i.object_id = t.object_id
               INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
               INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
               INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
               WHERE s.name = @sch AND t.name = @tbl AND i.type > 0
               ORDER BY i.name, ic.key_ordinal`,
    
    primaryKeys: `SELECT kc.name AS constraint_name, c.name AS column_name, ic.key_ordinal
                  FROM sys.key_constraints kc
                  INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
                  INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                  INNER JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
                  INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
                  WHERE kc.type = N'PK' AND s.name = @sch AND t.name = @tbl
                  ORDER BY ic.key_ordinal`,
    
    foreignKeys: `SELECT fk.name AS constraint_name,
                  scol.name AS source_column,
                  ref_s.name AS target_schema,
                  ref_t.name AS target_table,
                  rcol.name AS target_column,
                  fk.delete_referential_action_desc AS delete_rule,
                  fk.update_referential_action_desc AS update_rule
                  FROM sys.foreign_keys fk
                  INNER JOIN sys.tables st ON fk.parent_object_id = st.object_id
                  INNER JOIN sys.schemas ss ON st.schema_id = ss.schema_id
                  INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
                  INNER JOIN sys.columns scol ON fkc.parent_object_id = scol.object_id AND fkc.parent_column_id = scol.column_id
                  INNER JOIN sys.tables ref_t ON fk.referenced_object_id = ref_t.object_id
                  INNER JOIN sys.schemas ref_s ON ref_t.schema_id = ref_s.schema_id
                  INNER JOIN sys.columns rcol ON fkc.referenced_object_id = rcol.object_id AND fkc.referenced_column_id = rcol.column_id
                  WHERE ss.name = @sch AND st.name = @tbl`,
    
    uniqueConstraints: `SELECT tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type,
                         kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ordinal_position
                         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
                         INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
                           ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
                           AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                           AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                           AND tc.TABLE_NAME = kcu.TABLE_NAME
                         WHERE tc.TABLE_SCHEMA = @sch AND tc.TABLE_NAME = @tbl
                           AND tc.CONSTRAINT_TYPE IN (N'UNIQUE', N'PRIMARY KEY')
                         ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`,
    
    checkConstraints: `SELECT cc.name AS name, cc.definition AS expression
                       FROM sys.check_constraints cc
                       INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
                       INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                       WHERE s.name = @sch AND t.name = @tbl`,
    
    dataTypes: `SELECT name FROM sys.types WHERE is_user_defined = 0 AND name NOT IN (N'sysname') ORDER BY name`,
    
    tableComment: `SELECT CAST(ep.value AS NVARCHAR(MAX)) AS comment
                   FROM sys.tables t
                   INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
                   LEFT JOIN sys.extended_properties ep
                     ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.class = 1 AND ep.name = N'MS_Description'
                   WHERE s.name = @sch AND t.name = @tbl`,
  },
  
  buildInsertSQL: (params) => ({
    sql: `INSERT INTO ${sqlserverStrategy.quoteIdentifier(params.table)} (${params.columns.map(c => sqlserverStrategy.quoteIdentifier(c)).join(', ')}) VALUES (${params.columns.map((_, i) => sqlserverStrategy.buildPlaceholder(i)).join(', ')})`,
    values: params.values
  }),
  
  parseExplainResult: (result) => Effect.gen(function* () {
    // SQL Server EXPLAIN 解析 (SHOWPLAN_XML)
    const row = result.rows[0];
    const xml = row?.Plan ?? row?.plan ?? "";
    if (xml && typeof xml === "string") {
      return { plan: [{ Plan: xml, Format: "mssql-showplan-xml" }] };
    }
    return { plan: [] };
  }),
  
  specialHandlers: {
    // SQL Server 特有 handler
  },
  
  sessionMonitor: (connector, limit) =>
    Effect.tryPromise(() => sqlServerFetchSessionMonitor(mssqlPoolOf(connector), limit)),

  sessionControl: (connector, pid, action) =>
    Effect.gen(function* () {
      const pool = mssqlPoolOf(connector);
      const self = yield* Effect.tryPromise(() => sqlServerGetOwnSpid(pool));
      if (pid === self) return yield* Effect.fail(new Error("不允许操作当前监控连接自身会话"));
      // Strategy 接口的 action 为 string，这里收窄成 sqlserver-support 要求的字面量联合
      const kind = action === "terminate" ? "terminate" : "cancel";
      return yield* Effect.tryPromise(() => sqlServerSessionControlImpl(pool, pid, kind));
    }),

  explainText: (connector, query) =>
    Effect.tryPromise(() => sqlServerFetchExplainTextLines(mssqlPoolOf(connector), query)),
};

// ── 连接器装配（SQL Server 方言私有逻辑；公共逻辑见 db/connector.ts） ──

export interface MssqlConnectorDeps {
  connectionId: string;
  capabilities: DatabaseCapabilities;
}

export function createMssqlConnector(
  session: SqlServerSessionConnection,
  deps: MssqlConnectorDeps
): DbConnector {
  const textOf = (spec: string | QuerySpec): string => (typeof spec === "string" ? spec : spec.text);

  const strategy: ConnectorStrategy = {
    dbKind: "sqlserver",

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

    queryAsUser<Row = any>(spec: string | QuerySpec, params?: readonly unknown[]): Promise<QueryResult<Row>> {
      return strategy.query<Row>(spec, params);
    },

    withPoolClient<T>(): Promise<T> {
      throw new Error("SQL Server 不支持 withPoolClient；请使用 connector.nativePool() + sql.Transaction");
    },

    async startStream(plan, statements, batchSize): Promise<StreamBatch> {
      const pool = session.backGroundPool;
      const handle: SqlServerStreamingQueryHandle = await startSqlServerStreamingQuery(pool, {
        preambleBatches: statements.slice(0, -1),
        selectSql: statements[statements.length - 1]!,
        browseSourceSql: statements[statements.length - 1]!,
        batchSize,
      });

      let columns: StreamBatch["columns"];
      if (plan.streamColumnsFor) {
        try {
          columns = await plan.streamColumnsFor(handle);
        } catch (e) {
          await teardownSqlServerRowStream(handle);
          throw e;
        }
      }

      const { rows, hasMore } = await drainSqlServerStreamBatch(handle, batchSize);
      if (hasMore) {
        session.sqlServerRowStream = handle;
      } else {
        await teardownSqlServerRowStream(handle);
      }
      return { rows, hasMore, columns };
    },

    async readStreamBatch({ batchSize }): Promise<StreamBatch> {
      const handle = session.sqlServerRowStream;
      if (!handle) return { rows: [], hasMore: false };
      try {
        const { rows, hasMore } = await drainSqlServerStreamBatch(handle, batchSize);
        if (!hasMore) {
          session.sqlServerRowStream = undefined;
          await teardownSqlServerRowStream(handle);
        }
        return { rows, hasMore };
      } catch (e) {
        session.sqlServerRowStream = undefined;
        await teardownSqlServerRowStream(handle);
        throw e;
      }
    },

    async endStream(): Promise<void> {
      const handle = session.sqlServerRowStream;
      session.sqlServerRowStream = undefined;
      await teardownSqlServerRowStream(handle);
    },

    async dispose(): Promise<void> {
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
        session.sqlServerRowStream = undefined;
        await teardownSqlServerRowStream(stream);
        return { cancelled: true, message: "已请求中断流式查询" };
      }
      const activeRequest = session.sqlServerActiveRequest;
      if (activeRequest) {
        try {
          activeRequest.cancel();
        } catch {
          /* ignore */
        }
        return { cancelled: true, message: "已请求中断查询" };
      }
      return { cancelled: false, message: "没有正在执行的查询" };
    },

    sessionThreadId(): number | undefined {
      return undefined;
    },

    nativePool(): unknown {
      return session.backGroundPool;
    },

    buildSchemaContext(schema?: string) {
      return buildSqlServerSchemaContext(session.backGroundPool, schema);
    },

    setActiveRequest(request: unknown): void {
      session.sqlServerActiveRequest = (request ?? undefined) as never;
    },

    async sessionControl(target: number, action: "cancel" | "terminate"): Promise<boolean> {
      return sqlServerSessionControlImpl(session.backGroundPool, target, action);
    },
  };

  return createConnector({
    connectionId: deps.connectionId,
    dbKind: "sqlserver",
    capabilities: deps.capabilities,
    strategy,
  });
}

export function mssqlPoolOf(connector: DbConnector): sql.ConnectionPool {
  const pool = (connector as DbConnector & { nativePool?: () => unknown }).nativePool?.();
  if (!pool) throw new Error("内部错误：SQL Server 连接器未提供原生池");
  return pool as sql.ConnectionPool;
}
