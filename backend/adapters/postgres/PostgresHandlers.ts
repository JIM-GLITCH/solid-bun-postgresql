import { MethodNotFoundError } from "../../core/errors"
import { Effect } from "effect"
import { SessionStore, provideConnectionId } from "../../services/SessionStore"
import { ConnectDbRequest } from "../../../shared/src"
import { handlePostgresConnect, handlePostgresDisconnect, handlePostgresCapabilities } from "./handlers/connection.handler";
import { handlePostgresQuery, handlePostgresQueryStream, handlePostgresQueryStreamMore, handlePostgresCancel } from "./handlers/query.handler";
import { handlePostgresSchemas, handlePostgresTables, handlePostgresColumns } from "./handlers/schema.handler";
import { handlePostgresIndexes, handlePostgresPrimaryKeys, handlePostgresUniqueConstraints, handlePostgresCheckConstraints, handlePostgresForeignKeys } from "./handlers/metadata.handler";
import { handlePostgresExecuteDdl, handlePostgresTableDdl, handlePostgresFunctionDdl, handlePostgresSchemaDump, handlePostgresDatabaseDump } from "./handlers/ddl.handler";
import { handlePostgresImportRows, handlePostgresSaveChanges } from "./handlers/import.handler";
import { handlePostgresSessionMonitor, handlePostgresSessionControl, handlePostgresInstalledExtensions } from "./handlers/session.handler";
import { handlePostgresExplain, handlePostgresExplainText, handlePostgresPartitionInfo, handlePostgresDataTypes, handlePostgresTableComment } from "./handlers/misc.handler";

export interface PostgresHandlerContext {
  sendSSEMessage?: (connectionId: string, message: any) => void;
}

/** 从请求载荷中取出 connectionId（部分方法如 db/capabilities 没有该字段） */
const connectionIdOf = (payload: unknown): string => (payload as any)?.connectionId ?? "";

export const makePostgresHandlers = (ctx: PostgresHandlerContext = {}) => ({
  handleRequest: (method: string, payload: unknown): Effect.Effect<unknown, Error, SessionStore> =>
    Effect.gen(function* () {
      switch (method) {
        case "db/connect":
          return yield* handlePostgresConnect(payload as ConnectDbRequest);

        case "db/disconnect":
          return yield* handlePostgresDisconnect();

        case "db/capabilities":
          return yield* handlePostgresCapabilities((payload as any).dbType);

        case "db/query":
          return yield* handlePostgresQuery((payload as any).statements ?? (payload as any).query);

        case "db/query-stream":
          return yield* handlePostgresQueryStream(
            (payload as any).statements ?? (payload as any).query,
            (payload as any).batchSize ?? 100,
          );

        case "db/query-stream-more":
          return yield* handlePostgresQueryStreamMore((payload as any).batchSize ?? 100);

        case "db/cancel-query":
          return yield* handlePostgresCancel();

        case "db/schemas":
          return yield* handlePostgresSchemas();

        case "db/tables":
          return yield* handlePostgresTables((payload as any).schema);

        case "db/columns":
          return yield* handlePostgresColumns(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/indexes":
          return yield* handlePostgresIndexes(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/primary-keys":
          return yield* handlePostgresPrimaryKeys(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/unique-constraints":
          return yield* handlePostgresUniqueConstraints(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/check-constraints":
          return yield* handlePostgresCheckConstraints(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/foreign-keys":
          return yield* handlePostgresForeignKeys(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/execute-ddl":
          return yield* handlePostgresExecuteDdl((payload as any).sql);

        case "db/table-ddl":
          return yield* handlePostgresTableDdl(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/function-ddl":
          return yield* handlePostgresFunctionDdl(
            (payload as any).schema,
            (payload as any).functionName,
          );

        case "db/schema-dump":
          return yield* handlePostgresSchemaDump((payload as any).schema);

        case "db/database-dump":
          return yield* handlePostgresDatabaseDump();

        case "db/import-rows":
          return yield* handlePostgresImportRows(
            (payload as any).schema,
            (payload as any).table,
            (payload as any).columns,
            (payload as any).rows,
            (payload as any).conflictColumns,
            (payload as any).onConflict,
            (payload as any).onError,
          );

        case "db/save-changes":
          return yield* handlePostgresSaveChanges((payload as any).sql);

        case "db/session-monitor":
          return yield* handlePostgresSessionMonitor();

        case "db/session-control":
          return yield* handlePostgresSessionControl(
            (payload as any).action,
            (payload as any).targetPid,
          );

        case "db/installed-extensions":
          return yield* handlePostgresInstalledExtensions();

        case "db/explain":
          return yield* handlePostgresExplain(
            (payload as any).query,
          );

        case "db/explain-text":
          return yield* handlePostgresExplainText(
            (payload as any).query,
          );

        case "db/partition-info":
          return yield* handlePostgresPartitionInfo(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/data-types":
          return yield* handlePostgresDataTypes();

        case "db/table-comment":
          return yield* handlePostgresTableComment(
            (payload as any).schema,
            (payload as any).table,
            (payload as any).comment,
          );

        default:
          return yield* Effect.fail(new MethodNotFoundError({
            context: { timestamp: Date.now(), operation: "handleRequest" },
            method,
          }));
      }
    }).pipe(provideConnectionId(connectionIdOf(payload))),
});

export type PostgresHandlers = ReturnType<typeof makePostgresHandlers>;
