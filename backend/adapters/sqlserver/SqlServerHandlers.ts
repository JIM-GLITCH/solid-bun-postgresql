import { MethodNotFoundError } from "../../core/errors"
import { Effect } from "effect"
import { SessionStore, provideConnectionId } from "../../services/SessionStore"
import { ConnectDbRequest } from "../../../shared/src"
import { handleSqlServerConnect, handleSqlServerDisconnect, handleSqlServerCapabilities } from "./handlers/connection.handler";
import { handleSqlServerQuery, handleSqlServerQueryStream, handleSqlServerCancel } from "./handlers/query.handler";
import { handleSqlServerSchemas, handleSqlServerTables, handleSqlServerColumns } from "./handlers/schema.handler";
import { handleSqlServerSessionMonitor, handleSqlServerSessionControl } from "./handlers/session.handler";
import { handleSqlServerExplain, handleSqlServerExplainText, handleSqlServerPartitionInfo } from "./handlers/misc.handler";

export interface SqlServerHandlerContext {
  sendSSEMessage?: (connectionId: string, message: any) => void;
}

/** 从请求载荷中取出 connectionId（部分方法如 db/capabilities 没有该字段） */
const connectionIdOf = (payload: unknown): string => (payload as any)?.connectionId ?? "";

export const makeSqlServerHandlers = (ctx: SqlServerHandlerContext = {}) => ({
  handleRequest: (method: string, payload: unknown): Effect.Effect<unknown, Error, SessionStore> =>
    Effect.gen(function* () {
      switch (method) {
        case "db/connect":
          return yield* handleSqlServerConnect(payload as ConnectDbRequest);

        case "db/disconnect":
          return yield* handleSqlServerDisconnect();

        case "db/capabilities":
          return yield* handleSqlServerCapabilities((payload as any).dbType);

        case "db/query":
          return yield* handleSqlServerQuery((payload as any).statements ?? (payload as any).query);

        case "db/query-stream":
          return yield* handleSqlServerQueryStream(
            (payload as any).statements ?? (payload as any).query,
            (payload as any).batchSize ?? 100,
          );

        case "db/cancel-query":
          return yield* handleSqlServerCancel();

        case "db/schemas":
          return yield* handleSqlServerSchemas();

        case "db/tables":
          return yield* handleSqlServerTables((payload as any).schema);

        case "db/columns":
          return yield* handleSqlServerColumns(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/explain":
          return yield* handleSqlServerExplain((payload as any).query);

        case "db/explain-text":
          return yield* handleSqlServerExplainText((payload as any).query);

        case "db/partition-info":
          return yield* handleSqlServerPartitionInfo(
            (payload as any).schema,
            (payload as any).table,
          );

        case "db/session-monitor":
          return yield* handleSqlServerSessionMonitor((payload as any).limit ?? 20);

        case "db/session-control":
          return yield* handleSqlServerSessionControl(
            (payload as any).pid,
            (payload as any).action,
          );

        default:
          return yield* Effect.fail(new MethodNotFoundError({
            context: { timestamp: Date.now(), operation: "handleRequest" },
            method,
          }));
      }
    }).pipe(provideConnectionId(connectionIdOf(payload))),
});

export type SqlServerHandlers = ReturnType<typeof makeSqlServerHandlers>;
