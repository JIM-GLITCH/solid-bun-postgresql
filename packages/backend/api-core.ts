/**
 * 后端 API 核心：纯业务逻辑，与传输方式无关
 * 供 api-handlers-http 和 api-handlers-vscode 共同调用
 */

import type { PostgresLoginParams } from "@project/shared";
import { connectPostgres, createPostgresPool } from "./connect-postgres";
import { calculateColumnEditable } from "./column-editable";
import { Client, Pool } from "pg";
import Cursor from "pg-cursor";
import type { ApiMethod, ApiRequestPayload } from "@project/shared";

export interface SSEMessage {
  type: "NOTICE" | "ERROR" | "INFO" | "WARNING" | "QUERY" | "NOTIFICATION";
  message: string;
  timestamp: number;
  detail?: string;
}

export interface SessionConnection {
  userUsedClient: Client;
  backGroundPool: Pool;
  runningQueryPid?: number;
  eventPushers: Set<(msg: SSEMessage) => void>;
  cursor?: {
    instance: Cursor;
    columns?: any[];
    isDone: boolean;
  };
}

const sessionMap = new Map<string, SessionConnection>();

export function sendSSEMessage(sessionId: string, message: SSEMessage) {
  const session = sessionMap.get(sessionId);
  if (!session) return;

  for (const push of session.eventPushers) {
    try {
      push(message);
    } catch (e) {
      session.eventPushers.delete(push);
    }
  }
}

export function getSession(sessionId: string): SessionConnection | undefined {
  return sessionMap.get(sessionId);
}

/** 订阅 session 的事件推送，返回取消订阅函数 */
export function subscribeSessionEvents(
  sessionId: string,
  push: (msg: SSEMessage) => void
): () => void {
  const session = sessionMap.get(sessionId);
  if (!session) throw new Error("未找到数据库连接，请先连接数据库");

  session.eventPushers.add(push);
  return () => session.eventPushers.delete(push);
}

/** 处理 API 请求，返回纯数据（可 JSON 序列化） */
export async function handleApiRequest<M extends ApiMethod>(
  method: M,
  payload: ApiRequestPayload[M] & { sessionId: string }
): Promise<unknown> {
  const { sessionId } = payload;
  const getS = () => {
    const s = getSession(sessionId);
    if (!s) throw new Error("未找到数据库连接，请先连接数据库");
    return s;
  };

  switch (method) {
    case "connect-postgres": {
      const params = payload as PostgresLoginParams & { sessionId: string };
      const { sessionId: sid, ...connectParams } = params;

      const existingSession = sessionMap.get(sid);
      if (existingSession) {
        await existingSession.userUsedClient.end().catch(() => {});
        await existingSession.backGroundPool.end().catch(() => {});
        sessionMap.delete(sid);
      }

      const client = await connectPostgres(connectParams);
      const adminPool = createPostgresPool(connectParams);

      client.on("error", (err) => {
        sendSSEMessage(sid, { type: "ERROR", message: err.message || String(err), timestamp: Date.now() });
      });
      client.on("notice", (msg: any) => {
        const severity = (msg.severity || "NOTICE").toUpperCase();
        sendSSEMessage(sid, {
          type: severity as SSEMessage["type"],
          message: msg.message || String(msg),
          timestamp: Date.now(),
          detail: msg.detail || msg.hint || undefined,
        });
      });
      client.on("notification", (msg: any) => {
        sendSSEMessage(sid, {
          type: "NOTIFICATION",
          message: `[${msg.channel}] ${msg.payload || "(无内容)"}`,
          timestamp: Date.now(),
        });
      });
      client.on("end", () => {
        sendSSEMessage(sid, { type: "WARNING", message: "数据库连接已断开", timestamp: Date.now() });
      });

      sessionMap.set(sid, { userUsedClient: client, backGroundPool: adminPool, eventPushers: new Set() });
      return { sucess: true };
    }

    case "postgres/query-stream": {
      const { query, batchSize = 100 } = payload as { sessionId: string; query: string; batchSize?: number };
      const session = getS();
      const { userUsedClient: client, backGroundPool: adminPool } = session;

      if (session.cursor) {
        await new Promise<void>((r) => session.cursor!.instance.close(() => r()));
        session.cursor = undefined;
      }

      if ((client as any).processID) {
        session.runningQueryPid = (client as any).processID;
      }

      const cursor = client.query(new Cursor(query, [], { rowMode: "array" }));
      const rows = await new Promise<any[]>((resolve, reject) => {
        cursor.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      });

      const fields = (cursor as any)._result?.fields;
      const columnsInfo = fields ? await calculateColumnEditable(adminPool, fields, query) : [];
      const isDone = rows.length < batchSize;

      if (isDone) {
        await new Promise<void>((r) => cursor.close(() => r()));
        session.runningQueryPid = undefined;
      } else {
        session.cursor = { instance: cursor, columns: columnsInfo, isDone: false };
      }

      return { rows, columns: columnsInfo, hasMore: !isDone };
    }

    case "postgres/query-stream-more": {
      const { batchSize = 100 } = payload as { sessionId: string; batchSize?: number };
      const session = getS();

      if (!session.cursor || session.cursor.isDone) return { rows: [], hasMore: false };

      const { cursor } = session;
      const rows = await new Promise<any[]>((resolve, reject) => {
        cursor.instance.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      });
      const isDone = rows.length < batchSize;

      if (isDone) {
        await new Promise<void>((r) => cursor.instance.close(() => r()));
        session.cursor = undefined;
        session.runningQueryPid = undefined;
      } else {
        cursor.isDone = false;
      }

      return { rows, hasMore: !isDone };
    }

    case "postgres/save-changes": {
      const { sql } = payload as { sessionId: string; sql: string };
      const session = getS();
      const result = await session.backGroundPool.query(sql);
      sendSSEMessage(sessionId, {
        type: "INFO",
        message: `保存成功: ${result.rowCount ?? 0} 行受影响`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: result.rowCount };
    }

    case "postgres/cancel-query": {
      const session = getS();
      const pid = session.runningQueryPid;
      if (!pid) throw new Error("没有正在执行的查询");
      const result = await session.backGroundPool.query(`SELECT pg_cancel_backend($1)`, [pid]);
      const cancelled = result.rows[0]?.pg_cancel_backend;
      return { success: true, cancelled, message: cancelled ? "查询取消请求已发送" : "查询可能已完成或无法取消" };
    }

    case "postgres/query-readonly": {
      const { query, limit = 1000 } = payload as { sessionId: string; query: string; limit?: number };
      const session = getS();
      const limitedQuery = query.trim().toLowerCase().includes("limit") ? query : `${query} LIMIT ${limit}`;
      const result = await session.backGroundPool.query({ text: limitedQuery, rowMode: "array" });
      const columns = result.fields.map((f) => ({ name: f.name, tableID: f.tableID, columnID: f.columnID, isEditable: false }));
      return { rows: result.rows, columns, hasMore: false };
    }

    case "postgres/schemas": {
      const session = getS();
      const result = await session.backGroundPool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name`
      );
      return { schemas: result.rows.map((r) => r.schema_name) };
    }

    case "postgres/tables": {
      const { schema } = payload as { sessionId: string; schema: string };
      const session = getS();
      const result = await session.backGroundPool.query(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`,
        [schema]
      );
      return {
        tables: result.rows.filter((r) => r.table_type === "BASE TABLE").map((r) => r.table_name),
        views: result.rows.filter((r) => r.table_type === "VIEW").map((r) => r.table_name),
      };
    }

    case "postgres/columns": {
      const { schema, table } = payload as { sessionId: string; schema: string; table: string };
      const session = getS();
      const result = await session.backGroundPool.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table]
      );
      return { columns: result.rows };
    }

    case "postgres/indexes": {
      const { schema, table } = payload as { sessionId: string; schema: string; table: string };
      const session = getS();
      const result = await session.backGroundPool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
        [schema, table]
      );
      return { indexes: result.rows };
    }

    case "postgres/foreign-keys": {
      const { schema, table } = payload as { sessionId: string; schema: string; table: string };
      const session = getS();
      const outgoingResult = await session.backGroundPool.query(
        `SELECT tc.constraint_name, tc.table_schema AS source_schema, tc.table_name AS source_table,
         kcu.column_name AS source_column, ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      );
      const incomingResult = await session.backGroundPool.query(
        `SELECT tc.constraint_name, tc.table_schema AS source_schema, tc.table_name AS source_table,
         kcu.column_name AS source_column, ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_schema = $1 AND ccu.table_name = $2`,
        [schema, table]
      );
      return { outgoing: outgoingResult.rows, incoming: incomingResult.rows };
    }

    case "postgres/query": {
      const { query } = payload as { sessionId: string; query: string };
      const session = getS();
      const client = session.userUsedClient;

      if ((client as any).processID) session.runningQueryPid = (client as any).processID;

      try {
        sendSSEMessage(sessionId, { type: "QUERY", message: `执行查询: ${query.slice(0, 100)}...`, timestamp: Date.now() });
        const result = await client.query({ text: query, rowMode: "array" });
        session.runningQueryPid = undefined;
        sendSSEMessage(sessionId, {
          type: "INFO",
          message: `${result.command || ""} 完成: ${result.rowCount ?? 0} 行`,
          timestamp: Date.now(),
        });
        const columnsInfo = await calculateColumnEditable(client, result.fields);
        return { result: result.rows, columns: columnsInfo };
      } catch (e: any) {
        session.runningQueryPid = undefined;
        sendSSEMessage(sessionId, { type: "ERROR", message: `查询错误: ${e.message}`, timestamp: Date.now(), detail: e.detail || e.hint });
        throw e;
      }
    }

    default:
      throw new Error(`未知 API 方法: ${method}`);
  }
}
