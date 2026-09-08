/**
 * db/* 路由：按会话的 dbKind（或建连载荷的 dbType）分派到对应 Adapter 的 handlers。
 *
 * 分派规则与旧 api-core.ts 保持一致：
 * - db/connect：看载荷 dbType（mysql/mariadb → MySQL，sqlserver → SQL Server，其余 → PostgreSQL）
 * - 其他 db/*：看 SessionStore 中已登记会话的 dbKind；无会话时默认 PostgreSQL
 *   （如 db/capabilities 可在未建连时调用）
 *
 * 载荷中的 dbType 仅作提示，路由以会话 dbKind 为准，避免前端刷新后
 * 未再登记 dbType（默认 postgres）导致已建立的 MySQL/SQL Server 会话请求失败。
 */

import { Context, Effect } from "effect"
import { makeErrorContext, MethodNotFoundError as MethodNotFoundErr } from "../../core/errors"
import { ConnectDbRequest } from "../../../shared/src";


/**
 * 处理所有 db/* 方法。R 中的 ConnectionId 已由 handlers 内部
 * `provideConnectionId(payload.connectionId)` 消除，仅需外部提供 SessionStore。
 */
export const handleDbRequest = (
  method: string,
  payload: unknown,
) =>
  Effect.gen(function* () {
    const databaseService = yield* DatabaseService
    switch (method) {
      case "db/connect":
        return yield* databaseService.connect(payload as ConnectDbRequest);
      case "db/disconnect":
        return yield* databaseService.disconnect();
      case "db/capabilities":
        return yield* databaseService.getCapabilities((payload as any).dbType);
      case "db/schemas":
        return yield* databaseService.getSchemas();
      case "db/query":
        return yield* databaseService.executeQuery(
          (payload as any).statements ?? (payload as any).query,
        );
      case "db/query-stream":
        return yield* databaseService.executeQueryStream(

          (payload as any).statements ?? (payload as any).query,
          (payload as any).batchSize ?? 100,
        );
      case "db/query-stream-more":
        return yield* databaseService.executeQueryStreamMore((payload as any).batchSize ?? 100);
      case "db/cancel-query":
        return yield* databaseService.cancelQuery();
      case "db/tables":
        return yield* databaseService.getTables((payload as any).schema);
      case "db/columns":
        return yield* databaseService.getColumns(
          (payload as any).schema,
          (payload as any).table,
        );
      case "db/indexes":
        return yield* databaseService.getIndexes(
          (payload as any).schema,
          (payload as any).table,
        );
      case "db/primary-keys":
        return yield* databaseService.getPrimaryKeys(

          (payload as any).schema,
          (payload as any).table,
        );
      case "db/check-constraints":
        return yield* databaseService.getCheckConstraints(
          (payload as any).schema,
          (payload as any).table,
        );
      case "db/unique-constraints":
        return yield* databaseService.getUniqueConstraints(
          (payload as any).schema,
          (payload as any).table,
        );
      case "db/foreign-keys":
        return yield* databaseService.getForeignKeys(
          (payload as any).schema,
          (payload as any).table,
        );
      case "db/execute-ddl":
        return yield* databaseService.executeDdl((payload as any).sql);
      case "db/table-ddl":
        return yield* databaseService.getTableDdl(
          (payload as any).schema,
          (payload as any).table,
        );
      case "function-ddl":
        return yield* databaseService.getFunctionDdl(
          (payload as any).schema,
          (payload as any).functionName,
        );
      case "db/schema-dump":
        return yield* databaseService.getSchemaDump((payload as any).schema);
      case "db/database-dump":
        return yield* databaseService.getDatabaseDump();
      case "db/import-rows":
        return yield* databaseService.importRows(
          (payload as any).schema,
          (payload as any).table,
          (payload as any).columns,
          (payload as any).rows,
          (payload as any).conflictColumns,
          (payload as any).onConflict,
          (payload as any).onError,
        );
      case "db/save-changes":
        return yield* databaseService.saveChanges((payload as any).sql);
      case "db/session-monitor":
        return yield* databaseService.sessionMonitor();
      case "db/session-control":
        return yield* databaseService.sessionControl(
          (payload as any).action,
          (payload as any).targetPid,
        );
      case "db/installed-extensions":
        return yield* databaseService.getInstalledExtensions();
      case "db/explain":
        return yield* databaseService.explain((payload as any).query);
      case "db/explain-text":
        return yield* databaseService.explainText((payload as any).query);
      case "db/partition-info":
        return yield* databaseService.getPartitionInfo(
          (payload as any).schema,
          (payload as any).table,
        );
      case "db/data-types":
        return yield* databaseService.getDataTypes();
      case "db/table-comment":
        return yield* databaseService.getTableComment(
          (payload as any).schema,
          (payload as any).table,
        );
      default:
        throw new MethodNotFoundErr({
          context: makeErrorContext("handleDbRequest"),
          method,
        });
    }
  })
export interface DatabaseService {
  getTableComment(schema: any, table: any): Effect.Effect<any, any, any>;
  connect(arg0: ConnectDbRequest): Effect.Effect<any, any, any>;
  disconnect(): Effect.Effect<any, any, any>;
  getCapabilities(dbType: any): Effect.Effect<any, any, any>;
  getSchemas(): Effect.Effect<any, any, any>;
  executeQuery(arg0: any): Effect.Effect<any, any, any>;
  executeQueryStream(arg0: any, arg1: any): Effect.Effect<any, any, any>;
  executeQueryStreamMore(arg0: any): Effect.Effect<any, any, any>;
  cancelQuery(): Effect.Effect<any, any, any>;
  getTables(schema: any): Effect.Effect<any, any, any>;
  getColumns(schema: any, table: any): Effect.Effect<any, any, any>;
  getIndexes(schema: any, table: any): Effect.Effect<any, any, any>;
  getPrimaryKeys(schema: any, table: any): Effect.Effect<any, any, any>;
  getCheckConstraints(schema: any, table: any): Effect.Effect<any, any, any>;
  getUniqueConstraints(schema: any, table: any): Effect.Effect<any, any, any>;
  getForeignKeys(schema: any, table: any): Effect.Effect<any, any, any>;
  executeDdl(sql: any): Effect.Effect<any, any, any>;
  getTableDdl(schema: any, table: any): Effect.Effect<any, any, any>;
  getFunctionDdl(schema: any, functionName: any): Effect.Effect<any, any, any>;
  getSchemaDump(schema: any): Effect.Effect<any, any, any>;
  getDatabaseDump(): Effect.Effect<any, any, any>;
  importRows(schema: any, table: any, columns: any, rows: any, conflictColumns: any, onConflict: any, onError: any): Effect.Effect<any, any, any>;
  saveChanges(sql: any): Effect.Effect<any, any, any>;
  sessionMonitor(): Effect.Effect<any, any, any>;
  sessionControl(action: any, targetPid: any): Effect.Effect<any, any, any>;
  getInstalledExtensions(): Effect.Effect<any, any, any>;
  explain(query: any): Effect.Effect<any, any, any>;
  explainText(query: any): Effect.Effect<any, any, any>;
  getPartitionInfo(schema: any, table: any): Effect.Effect<any, any, any>;
  getDataTypes(): Effect.Effect<any, any, any>;

}

export const DatabaseService = Context.Service<DatabaseService, DatabaseService>()("DatabaseService")
