/**
 * DB Handlers
 * 所有数据库操作的实现
 * 简化版本：直接传递 context 和 strategy，不使用 Effect 的复杂类型系统
 */
import { Effect } from "effect";
import { postgresStrategy } from "./strategies/postgres-strategy-effect";
import { mysqlStrategy } from "./strategies/mysql-strategy-effect";
import { sqlserverStrategy } from "./strategies/sqlserver-strategy-effect";
import { getSqlSegments } from "../../shared/src";
import { getSession, sendSSEMessage, disconnectConnection, assertSessionDbType, capabilitiesForKind, sessionConnectorOf } from "../db/sessions";
import type { SessionConnection } from "../session-connection";
import type { DbConnector, QuerySpec } from "../db/contract";
import type { DbKind, SSEMessage, ConnectDbRequest } from "../../shared/src";
import { connectSession } from "../db/sessions";
import { CurrentConnectionId, CurrentDbType, type Strategy } from "./db-service-effect";

// ========== 策略工厂 ==========
export const getStrategy = (dbType: string): Strategy => {
  if (dbType === "postgres") return postgresStrategy;
  if (dbType === "mysql" || dbType === "mariadb") return mysqlStrategy;
  if (dbType === "sqlserver") return sqlserverStrategy;
  throw new Error(`不支持的数据库类型: ${dbType}`);
};



// ========== 辅助函数 ==========
function getStatementsFromSql(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg: { start: number; end: number }) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

/**
 * 当前连接的请求级环境：一次性解析「会话 + 连接器 + 方言策略」，
 * 并派生两个绑定能力（`query` / `notify`）。
 *
 * - `connectionId` / 客户端声明的 `dbType` 由 router 以 Context 提供
 *   （唯一 provide 点是 `trpc/router/db.ts` 的 `runDbHandler`）；
 * - 策略按**服务端真源** `session.dbKind` 选择，客户端声明的 dbType 仅做一致性校验；
 * - 连接不存在 → 类型化失败（`Effect.fail`），而非同步抛错变成 defect；
 * - `query`：绑定的查询 Effect 构造器（自带 Error 映射，省去每处 tryPromise 包裹）；
 * - `notify`：绑定的 SSE 通知器（闭包绑定 connectionId，handler 不再手递）。
 *
 * 解构按需取用：流式 / 事务 / 取消等能力仍走 `connector` 原对象。
 */
export const currentConnection = Effect.gen(function* () {
  const connectionId = yield* CurrentConnectionId;
  const declaredDbType = yield* CurrentDbType;

  const session = getSession(connectionId);
  if (!session) return yield* Effect.fail(new Error("未找到数据库连接，请先连接数据库"));

  const connector = sessionConnectorOf(connectionId);
  if (!connector) return yield* Effect.fail(new Error("未找到数据库连接，请先连接数据库"));

  assertSessionDbType(session, declaredDbType);

  return {
    connectionId,
    session,
    connector,
    dbKind: session.dbKind,
    strategy: getStrategy(session.dbKind),
    /** 绑定的查询 Effect 构造器：自带 Error 映射，错误通道即 `Error` */
    query: <Row = any>(spec: string | QuerySpec, params?: readonly unknown[]) =>
      Effect.tryPromise({
        try: () => connector.query<Row>(spec, params),
        catch: (e) => (e instanceof Error ? e : new Error(String(e))),
      }),
    /** 绑定的 SSE 通知器：闭包绑定 connectionId */
    notify: (msg: SSEMessage) => sendSSEMessage(connectionId, msg),
  };
});

// ========== Handler 函数 ==========



export const dbConnect = (params: ConnectDbRequest) =>
  Effect.gen(function* () {
    // 策略按请求方言解析（mysql / mariadb 同族，见 getStrategy）；
    // 连接尚未建立、没有会话，不走 currentConnection
    getStrategy(params.dbType);
    // 必须显式 catch：裸 tryPromise 会把驱动错误包成 UnknownException，
    // 前端只能看到 "An error occurred in Effect.tryPromise"（见 formatUnknownError）。
    return yield* Effect.tryPromise({
      try: () => connectSession(params),
      catch: (e) => (e instanceof Error ? e : new Error(String(e))),
    });
  });

export const dbDisconnect = () =>
  Effect.gen(function* () {
    // currentConnection 内已完成：存在性检查 + 方言一致性校验
    const { connectionId } = yield* currentConnection;
    yield* Effect.tryPromise(() => disconnectConnection(connectionId));
    return { success: true };
  });

export const dbCapabilities = () =>
  Effect.gen(function* () {
    const { session } = yield* currentConnection;
    return { capabilities: capabilitiesForKind(session.dbKind) };
  }).pipe(Effect.catch((e) => Effect.fail(e as Error)));

export const dbSchemas = () =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.schemas);
    return { schemas: result.rows.map((r: any) => r.schema_name ?? r.SCHEMA_NAME ?? "") };
  });

export const dbTables = (params: { schema: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.tables, [params.schema]);
    const tableName = (r: any) => String(r.table_name ?? r.TABLE_NAME ?? "");
    const tableType = (r: any) => String(r.table_type ?? r.TABLE_TYPE ?? "");
    return {
      tables: result.rows.filter((r: any) => tableType(r) === 'BASE TABLE').map((r: any) => tableName(r)),
      views: result.rows.filter((r: any) => tableType(r) === 'VIEW').map((r: any) => tableName(r)),
      functions: [] as Array<{ oid: number; schema: string; name: string; args: string }>,
    };
  });

export const dbColumns = (params: { schema: string; table: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.columns, [params.schema, params.table]);
    return { columns: result.rows };
  });

export const dbQueryStream = (params: {
  query?: string;
  statements?: string[];
  batchSize?: number;
  defaultSchema?: string;
}) =>
  Effect.gen(function* () {
    const { connector } = yield* currentConnection;

    const { query, statements: payloadStatements, batchSize = 100, defaultSchema } = params;

    const statements = payloadStatements?.length
      ? payloadStatements
      : getStatementsFromSql(query ?? "");

    if (statements.length === 0) {
      return { rows: [], columns: [], hasMore: false };
    }

    const result = yield* Effect.tryPromise(() =>
      connector.stream({
        statements,
        batchSize: Math.max(1, batchSize ?? 100),
        defaultSchema,
      })
    );

    return result;
  });

export const dbQueryStreamMore = (params: {
  batchSize?: number;
  defaultSchema?: string;
}) =>
  Effect.gen(function* () {
    const { connector } = yield* currentConnection;
    const result = yield* Effect.tryPromise(() =>
      connector.streamMore({
        batchSize: Math.max(1, params.batchSize ?? 100),
        defaultSchema: params.defaultSchema,
      })
    );
    return result;
  });

export const dbQuery = (params: {
  query: string;
  defaultSchema?: string;
}) =>
  Effect.gen(function* () {
    const { query, notify } = yield* currentConnection;

    yield* Effect.sync(() =>
      notify({ type: "QUERY", message: `执行查询: ${params.query.slice(0, 100)}...`, timestamp: Date.now() })
    );

    const result = yield* query(params.query);

    yield* Effect.sync(() =>
      notify({ type: "INFO", message: `${result.command || ""} 完成: ${result.rowCount ?? 0} 行`, timestamp: Date.now() })
    );

    return { result: result.rows, columns: [] }; // columns 需要根据数据库类型计算
  });

export const dbCancelQuery = () =>
  Effect.gen(function* () {
    const { connector } = yield* currentConnection;
    const res = yield* Effect.tryPromise(() => connector.cancelCurrentQuery());
    if (!res.cancelled && res.message === "没有正在执行的查询") {
      return { success: false, error: "没有正在执行的查询" };
    }
    return { success: true, cancelled: res.cancelled, message: res.message };
  });

export const dbSaveChanges = (params: { sql: string }) =>
  Effect.gen(function* () {
    const { query, notify } = yield* currentConnection;

    const result = yield* query(params.sql);

    yield* Effect.sync(() =>
      notify({
        type: "INFO",
        message: `保存成功: ${result.rowCount ?? 0} 行受影响`,
        timestamp: Date.now(),
      })
    );

    return { success: true, rowCount: result.rowCount };
  });

export const dbExplain = (params: { query: string; defaultSchema?: string }) =>
  Effect.gen(function* () {
    const { query, strategy, notify } = yield* currentConnection;

    yield* Effect.sync(() =>
      notify({ type: "QUERY", message: "执行 EXPLAIN ANALYZE...", timestamp: Date.now() })
    );

    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${params.query.trim()}`;
    const result = yield* query(explainSql);
    const plan = yield* strategy.parseExplainResult(result);

    yield* Effect.sync(() =>
      notify({ type: "INFO", message: "执行计划获取完成", timestamp: Date.now() })
    );

    return { plan };
  });

export const dbExplainText = (params: { query: string }) =>
  Effect.gen(function* () {
    const { connector, strategy } = yield* currentConnection;
    const q = params.query.trim();
    if (!q) return yield* Effect.fail(new Error("SQL 为空"));
    if (!strategy.explainText) {
      return yield* Effect.fail(new Error("当前数据库不支持 EXPLAIN 文本计划"));
    }
    const lines = yield* strategy.explainText(connector, q);
    return { lines };
  });

export const dbIndexes = (params: { schema: string; table: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.indexes, [params.schema, params.table]);
    return { indexes: result.rows };
  });

export const dbPrimaryKeys = (params: { schema: string; table: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.primaryKeys, [params.schema, params.table]);
    return { columns: result.rows.map((r: any) => r.column_name ?? r.COLUMN_NAME ?? "") };
  });

export const dbUniqueConstraints = (params: { schema: string; table: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.uniqueConstraints, [params.schema, params.table]);
    return { constraints: result.rows };
  });

export const dbForeignKeys = (params: { schema: string; table: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.foreignKeys, [params.schema, params.table]);
    return { outgoing: result.rows, incoming: [] }; // incoming 需要单独查询
  });

export const dbDataTypes = () =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.dataTypes);
    const types = result.rows.map((r: any) => String(r.name ?? r.NAME ?? "")).filter(Boolean);
    return { types: [...new Set(types)].sort((a, b) => a.localeCompare(b)) };
  });

export const dbTableComment = (params: { schema: string; table: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.tableComment, [params.schema, params.table]);
    return { comment: result.rows[0]?.comment ?? null };
  });

export const dbCheckConstraints = (params: { schema: string; table: string }) =>
  Effect.gen(function* () {
    const { query, strategy } = yield* currentConnection;
    const result = yield* query(strategy.metadataQueries.checkConstraints, [params.schema, params.table]);
    return { constraints: result.rows };
  });

export const dbPartitionInfo = (params: { connectionId: string; schema: string; table: string }) =>
  Effect.gen(function* () {
    // 简化实现，完整实现需要根据数据库类型调用不同的 SQL
    return { role: "none" as const };
  });

export const dbExecuteDdl = (params: { sql: string }) =>
  Effect.gen(function* () {
    const { query, notify } = yield* currentConnection;

    yield* Effect.sync(() =>
      notify({ type: "QUERY", message: `执行 DDL: ${params.sql.slice(0, 80)}...`, timestamp: Date.now() })
    );

    yield* query(params.sql);

    yield* Effect.sync(() =>
      notify({ type: "INFO", message: "DDL 执行成功", timestamp: Date.now() })
    );

    return { success: true };
  });

export const dbTableDdl = (params: { connectionId: string; schema: string; table: string }) =>
  Effect.gen(function* () {
    // 简化实现，完整实现需要根据数据库类型调用不同的逻辑
    return { ddl: "-- DDL 实现待完善" };
  });

export const dbFunctionDdl = (params: { connectionId: string; schema: string; function: string; oid?: number }) =>
  Effect.gen(function* () {
    // 简化实现，完整实现需要根据数据库类型调用不同的逻辑
    return { ddl: "-- Function DDL 实现待完善" };
  });

export const dbSchemaDump = (params: { connectionId: string; schema: string; includeData?: boolean }) =>
  Effect.gen(function* () {
    // 简化实现，完整实现需要根据数据库类型调用不同的逻辑
    return { dump: "-- Schema dump 实现待完善" };
  });

export const dbDatabaseDump = (params: { connectionId: string; includeData?: boolean }) =>
  Effect.gen(function* () {
    // 简化实现，完整实现需要根据数据库类型调用不同的逻辑
    return { dump: "-- Database dump 实现待完善" };
  });

export const dbImportRows = (params: {
  schema: string;
  table: string;
  columns: string[];
  rows: unknown[][];
  conflictColumns?: string[];
  onConflict?: "nothing" | "update";
  onError?: "rollback" | "discard";
}) =>
  Effect.gen(function* () {
    // withPoolClient（事务路径）仍走 connector；逐行插入走绑定的 query
    const { connector, query, strategy, notify } = yield* currentConnection;

    if (!params.columns?.length || !Array.isArray(params.rows)) {
      return yield* Effect.fail(new Error("缺少 columns 或 rows"));
    }

    // 单语句参数上限保护：pg 上限 65535，留余量后按列数动态缩小每批行数
    const MAX_PARAMS_PER_STATEMENT = 60000;
    const BATCH = Math.max(
      1,
      Math.min(100, Math.floor(MAX_PARAMS_PER_STATEMENT / Math.max(1, params.columns.length)))
    );
    let total = 0;
    const failed: Array<{ index: number; error: string }> = [];

    if (params.onError === "rollback") {
      yield* Effect.tryPromise(() =>
        connector.withPoolClient(async (client) => {
          // 方言提供显式事务方法时优先使用（sqlserver 走 sql.Transaction，避免嵌套事务错误）；
          // 否则回退到 BEGIN/COMMIT 语句（pg）
          await (client.beginTransaction ? client.beginTransaction() : client.query("BEGIN"));
          try {
            for (let i = 0; i < params.rows.length; i += BATCH) {
              const chunk = params.rows.slice(i, i + BATCH);
              const { sql, values } = strategy.buildInsertSQL({
                table: `${params.schema}.${params.table}`,
                columns: params.columns,
                values: chunk,
              });
              if (!sql) continue;
              const result = await client.query(sql, values);
              total += result.rowCount ?? chunk.length;
            }
            await (client.commit ? client.commit() : client.query("COMMIT"));
          } catch (e) {
            try {
              await (client.rollback ? client.rollback() : client.query("ROLLBACK"));
            } catch {
              // 回滚失败不掩盖原始导入错误
            }
            throw e;
          }
        })
      );
    } else {
      for (let i = 0; i < params.rows.length; i += BATCH) {
        const chunk = params.rows.slice(i, i + BATCH);
        try {
          const { sql, values } = strategy.buildInsertSQL({
            table: `${params.schema}.${params.table}`,
            columns: params.columns,
            values: chunk,
          });
          if (!sql) continue;
          const result = yield* query(sql, values);
          total += result.rowCount ?? chunk.length;
        } catch {
          // 整批失败 → 逐行降级，并记录失败行供前端展示
          for (let r = 0; r < chunk.length; r++) {
            try {
              const { sql, values } = strategy.buildInsertSQL({
                table: `${params.schema}.${params.table}`,
                columns: params.columns,
                values: [chunk[r]!],
              });
              if (!sql) continue;
              const result = yield* query(sql, values);
              total += result.rowCount ?? 1;
            } catch (e) {
              failed.push({
                index: i + r,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      }
    }

    if (failed.length > 0) {
      yield* Effect.sync(() =>
        notify({
          type: "WARNING",
          message: `导入完成: ${total} 行成功, ${failed.length} 行失败`,
          timestamp: Date.now(),
        })
      );
      return { success: false, rowCount: total, failed };
    }

    yield* Effect.sync(() =>
      notify({ type: "INFO", message: `导入成功: ${total} 行`, timestamp: Date.now() })
    );

    return { success: true, rowCount: total };
  });

export const dbSessionMonitor = (params: { limit?: number }) =>
  Effect.gen(function* () {
    const { connector, strategy } = yield* currentConnection;
    const limit = params.limit ?? 20;

    if (strategy.sessionMonitor) {
      return yield* strategy.sessionMonitor(connector, limit);
    }

    // 默认实现
    return {
      connectionStats: { total: 0, active: 0, idle: 0, waiting: 0 },
      lockWaits: [],
      slowQueries: [],
      slowQuerySource: 'unknown',
      collectedAt: Date.now()
    };
  });

export const dbSessionControl = (params: { pid: number; action: "cancel" | "terminate" }) =>
  Effect.gen(function* () {
    const { connector, strategy } = yield* currentConnection;

    if (strategy.sessionControl) {
      const ok = yield* strategy.sessionControl(connector, params.pid, params.action);
      return { success: ok, pid: params.pid, action: params.action };
    }

    // 默认实现
    return { success: false, pid: params.pid, action: params.action };
  });

export const dbInstalledExtensions = (params: { connectionId: string }) =>
  Effect.gen(function* () {
    // PostgreSQL 特有功能，其他数据库返回空数组
    return {
      extensions: [] as Array<{
        name: string;
        installedVersion: string;
        schema: string;
        relocatable: boolean;
        defaultVersion: string | null;
        description: string | null;
      }>
    };
  });
