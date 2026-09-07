import { MethodNotFoundError } from "../../core/errors"
import { Effect } from "effect"
import { SessionStore, provideConnectionId } from "../../services/SessionStore"
import { ConnectDbRequest } from "../../../shared/src"
import { handleMysqlConnect, handleMysqlDisconnect, handleMysqlCapabilities } from "./handlers/connection.handler";
import { handleMysqlQuery, handleMysqlQueryStream, handleMysqlCancel } from "./handlers/query.handler";
import { handleMysqlSchemas, handleMysqlTables, handleMysqlColumns } from "./handlers/schema.handler";

export interface MysqlHandlerContext {
  sendSSEMessage?: (connectionId: string, message: any) => void;
}

/** 从请求载荷中取出 connectionId（部分方法如 db/capabilities 没有该字段） */
const connectionIdOf = (payload: unknown): string => (payload as any)?.connectionId ?? "";

export const makeMysqlHandlers = (ctx: MysqlHandlerContext = {}) => ({
  handleRequest: (method: string, payload: unknown): Effect.Effect<unknown, Error, SessionStore> =>
    Effect.gen(function* () {
      switch (method) {
        case "db/connect":
          return yield* handleMysqlConnect(payload as ConnectDbRequest);

        case "db/disconnect":
          return yield* handleMysqlDisconnect();

        case "db/capabilities":
          return yield* handleMysqlCapabilities((payload as any).dbType);

        case "db/query":
          return yield* handleMysqlQuery((payload as any).statements ?? (payload as any).query);

        case "db/query-stream":
          return yield* handleMysqlQueryStream(
            (payload as any).statements ?? (payload as any).query,
            (payload as any).batchSize ?? 100,
          );

        case "db/cancel-query":
          return yield* handleMysqlCancel();

        case "db/schemas":
          return yield* handleMysqlSchemas();

        case "db/tables":
          return yield* handleMysqlTables((payload as any).schema);

        case "db/columns":
          return yield* handleMysqlColumns(
            (payload as any).schema,
            (payload as any).table,
          );

        default:
          return yield* Effect.fail(new MethodNotFoundError({
            context: { timestamp: Date.now(), operation: "handleRequest" },
            method,
          }));
      }
    }).pipe(provideConnectionId(connectionIdOf(payload))),
});

export type MysqlHandlers = ReturnType<typeof makeMysqlHandlers>;
