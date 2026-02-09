/**
 * 后端 API 处理器：session 管理 + 所有 API 路由逻辑
 */

import type { PostgresLoginParams } from "../shared/src";
import { connectPostgres, createPostgresPool } from "./connect-postgres";
import { calculateColumnEditable } from "./column-editable";
import { Client, Pool } from "pg";
import Cursor from "pg-cursor";

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
  sseControllers: Set<ReadableStreamDefaultController<Uint8Array>>;
  cursor?: {
    instance: Cursor;
    columns?: any[];
    isDone: boolean;
  };
}

const sessionMap = new Map<string, SessionConnection>();

function sendSSEMessage(sessionId: string, message: SSEMessage) {
  const session = sessionMap.get(sessionId);
  if (!session) return;

  const data = `data: ${JSON.stringify(message)}\n\n`;
  const encoder = new TextEncoder();
  const encoded = encoder.encode(data);

  for (const controller of session.sseControllers) {
    try {
      controller.enqueue(encoded);
    } catch (e) {
      session.sseControllers.delete(controller);
    }
  }
}

function getSession(sessionId: string): SessionConnection | undefined {
  return sessionMap.get(sessionId);
}

/** 创建所有 API 路由（/api/*） */
export function createApiRoutes(): Record<string, { GET?: (req: any) => Response | Promise<Response>; POST?: (req: any) => Response | Promise<Response> }> {
  return {
    "/api/hello": { GET: () => Response.json({ message: "Hello from API" }) },
    "/api/events": {
      GET: (req: { url: string | URL }) => {
        const url = new URL(req.url);
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) return new Response("缺少 sessionId", { status: 400 });

        const session = sessionMap.get(sessionId);
        if (!session) return new Response("未找到数据库连接，请先连接数据库", { status: 400 });

        let controller: ReadableStreamDefaultController<Uint8Array>;
        let heartbeatInterval: ReturnType<typeof setInterval>;

        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            controller = ctrl;
            session.sseControllers.add(controller);
            console.log(`[${sessionId}] SSE 连接建立，当前连接数: ${session.sseControllers.size}`);

            const welcomeMsg = `data: ${JSON.stringify({ type: "APP", message: "SSE 连接已建立", timestamp: Date.now() })}\n\n`;
            controller.enqueue(new TextEncoder().encode(welcomeMsg));

            const sendHeartbeat = () => {
              try {
                controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
              } catch {
                clearInterval(heartbeatInterval);
              }
            };
            sendHeartbeat();
            heartbeatInterval = setInterval(sendHeartbeat, 10000);
          },
          cancel() {
            clearInterval(heartbeatInterval);
            session.sseControllers.delete(controller);
            console.log(`[${sessionId}] SSE 连接关闭，剩余连接数: ${session.sseControllers.size}`);
          },
        });

        return new Response(stream, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" },
        });
      },
    },
    "/api/connect-postgres": {
      POST: async (req: Request) => {
        const data = (await req.json()) as PostgresLoginParams & { sessionId: string };
        const { sessionId, ...params } = data;
        console.log(`[${sessionId}] 连接请求:`, params);

        if (!sessionId) return Response.json({ error: "缺少 sessionId", sucess: false });

        try {
          const existingSession = sessionMap.get(sessionId);
          if (existingSession) {
            await existingSession.userUsedClient.end().catch(() => {});
            await existingSession.backGroundPool.end().catch(() => {});
            sessionMap.delete(sessionId);
          }

          const client = await connectPostgres(params);
          const adminPool = createPostgresPool(params);

          client.on("error", (err) => {
            console.error(`[${sessionId}] 数据库错误:`, err);
            sendSSEMessage(sessionId, { type: "ERROR", message: err.message || String(err), timestamp: Date.now() });
          });

          client.on("notice", (msg: any) => {
            console.log(`[${sessionId}] 数据库通知:`, msg);
            const severity = (msg.severity || "NOTICE").toUpperCase();
            sendSSEMessage(sessionId, {
              type: severity as SSEMessage["type"],
              message: msg.message || String(msg),
              timestamp: Date.now(),
              detail: msg.detail || msg.hint || undefined,
            });
          });

          client.on("notification", (msg: any) => {
            console.log(`[${sessionId}] NOTIFY 消息:`, msg);
            sendSSEMessage(sessionId, {
              type: "NOTIFICATION",
              message: `[${msg.channel}] ${msg.payload || "(无内容)"}`,
              timestamp: Date.now(),
            });
          });

          client.on("end", () => {
            console.log(`[${sessionId}] 数据库连接已断开`);
            sendSSEMessage(sessionId, {
              type: "WARNING",
              message: "数据库连接已断开",
              timestamp: Date.now(),
            });
          });

          sessionMap.set(sessionId, { userUsedClient: client, backGroundPool: adminPool, sseControllers: new Set() });
          console.log(`[${sessionId}] 连接成功，当前 session 数: ${sessionMap.size}`);
          return Response.json({ sucess: true });
        } catch (e) {
          return Response.json({ error: e, sucess: false });
        }
      },
    },
    "/api/postgres/query": {
      POST: async (req: Request) => {
        const data = (await req.json()) as { query: string; sessionId: string };
        const { query, sessionId } = data;

        if (!sessionId)
          return new Response(JSON.stringify({ error: "缺少 sessionId", sucess: false }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });

        const session = getSession(sessionId);
        if (!session)
          return new Response(JSON.stringify({ error: "未找到数据库连接，请先连接数据库", sucess: false }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });

        const { userUsedClient: client } = session;

        try {
          const pid = (client as any).processID;
          if (pid) {
            session.runningQueryPid = pid;
            console.log(`[${sessionId}] 开始查询, PID: ${pid}`);
          }

          const startTime = Date.now();
          sendSSEMessage(sessionId, {
            type: "QUERY",
            message: `执行查询: ${query.slice(0, 100)}${query.length > 100 ? "..." : ""}`,
            timestamp: startTime,
          });

          const result = await client.query({ text: query, rowMode: "array" });
          const duration = Date.now() - startTime;
          console.log(`[${sessionId}] 查询结果:`, result.rowCount, "行");

          session.runningQueryPid = undefined;

          sendSSEMessage(sessionId, {
            type: "INFO",
            message: `${result.command || ""} 完成: ${result.rowCount ?? 0} 行，耗时 ${duration}ms`,
            timestamp: Date.now(),
          });

          const columnsInfo = await calculateColumnEditable(client, result.fields);
          return Response.json({ result: result.rows, columns: columnsInfo });
        } catch (e: any) {
          session.runningQueryPid = undefined;
          console.log(`[${sessionId}] 查询错误:`, e.message);
          sendSSEMessage(sessionId, {
            type: "ERROR",
            message: `查询错误: ${e.message}`,
            timestamp: Date.now(),
            detail: e.detail || e.hint || undefined,
          });
          return new Response(JSON.stringify({ error: e.message, sucess: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
    "/api/postgres/query-stream": {
      POST: async (req: Request) => {
        const data = (await req.json()) as { query: string; sessionId: string; batchSize?: number };
        const { query, sessionId, batchSize = 100 } = data;

        if (!sessionId) return Response.json({ error: "缺少 sessionId", success: false }, { status: 400 });

        const session = getSession(sessionId);
        if (!session)
          return Response.json({ error: "未找到数据库连接，请先连接数据库", success: false }, { status: 400 });

        const { userUsedClient: client, backGroundPool: adminPool } = session;

        if (session.cursor) {
          await new Promise<void>((resolve) => session.cursor!.instance.close(() => resolve()));
          session.cursor = undefined;
        }

        const pid = (client as any).processID;
        if (pid) {
          session.runningQueryPid = pid;
          console.log(`[${sessionId}] 开始流式查询, PID: ${pid}`);
        }

        let cursor: Cursor | undefined;

        try {
          cursor = client.query(new Cursor(query, [], { rowMode: "array" }));

          const rows = await new Promise<any[]>((resolve, reject) => {
            cursor!.read(batchSize, (err: any, rows: any[]) => (err ? reject(err) : resolve(rows)));
          });

          const fields = (cursor as any)._result?.fields;
          const columnsInfo = fields ? await calculateColumnEditable(adminPool, fields, query) : [];

          const isDone = rows.length < batchSize;

          if (isDone) {
            await new Promise<void>((resolve) => cursor!.close(() => resolve()));
            session.runningQueryPid = undefined;
            console.log(`[${sessionId}] 查询完成，共 ${rows.length} 行`);
          } else {
            session.cursor = { instance: cursor, columns: columnsInfo, isDone: false };
            console.log(`[${sessionId}] 返回前 ${rows.length} 行，cursor 保持打开`);
          }

          return Response.json({ rows, columns: columnsInfo, hasMore: !isDone });
        } catch (e: any) {
          if (cursor) await new Promise<void>((resolve) => cursor!.close(() => resolve()));
          session.runningQueryPid = undefined;
          console.error(`[${sessionId}] 流式查询错误:`, e.message);
          return Response.json({ error: e.message, success: false }, { status: 500 });
        }
      },
    },
    "/api/postgres/query-stream-more": {
      POST: async (req: Request) => {
        const data = (await req.json()) as { sessionId: string; batchSize?: number };
        const { sessionId, batchSize = 100 } = data;

        if (!sessionId) return Response.json({ error: "缺少 sessionId", success: false }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接", success: false }, { status: 400 });

        if (!session.cursor || session.cursor.isDone) return Response.json({ rows: [], hasMore: false });

        const { cursor } = session;

        try {
          const rows = await new Promise<any[]>((resolve, reject) => {
            cursor.instance.read(batchSize, (err: any, rows: any[]) => (err ? reject(err) : resolve(rows)));
          });

          const isDone = rows.length < batchSize;

          if (isDone) {
            await new Promise<void>((resolve) => cursor.instance.close(() => resolve()));
            session.cursor = undefined;
            session.runningQueryPid = undefined;
            console.log(`[${sessionId}] 查询完成，本批 ${rows.length} 行`);
          } else {
            cursor.isDone = false;
            console.log(`[${sessionId}] 返回 ${rows.length} 行，cursor 保持打开`);
          }

          return Response.json({ rows, hasMore: !isDone });
        } catch (e: any) {
          await new Promise<void>((resolve) => cursor.instance.close(() => resolve()));
          session.cursor = undefined;
          session.runningQueryPid = undefined;
          console.error(`[${sessionId}] 读取更多数据错误:`, e.message);
          return Response.json({ error: e.message, success: false }, { status: 500 });
        }
      },
    },
    "/api/postgres/save-changes": {
      POST: async (req: Request) => {
        const data = (await req.json()) as { sql: string; sessionId: string };
        const { sql, sessionId } = data;

        if (!sessionId) return Response.json({ error: "缺少 sessionId", success: false }, { status: 400 });
        if (!sql) return Response.json({ error: "缺少 SQL 语句", success: false }, { status: 400 });

        const session = getSession(sessionId);
        if (!session)
          return Response.json({ error: "未找到数据库连接，请先连接数据库", success: false }, { status: 400 });

        const { backGroundPool: adminPool } = session;

        try {
          console.log(`[${sessionId}] 执行保存修改: ${sql.slice(0, 100)}${sql.length > 100 ? "..." : ""}`);
          const result = await adminPool.query(sql);
          console.log(`[${sessionId}] 保存成功, 影响行数: ${result.rowCount}`);

          sendSSEMessage(sessionId, {
            type: "INFO",
            message: `保存成功: ${result.rowCount ?? 0} 行受影响`,
            timestamp: Date.now(),
          });

          return Response.json({ success: true, rowCount: result.rowCount });
        } catch (e: any) {
          console.error(`[${sessionId}] 保存失败:`, e.message);
          sendSSEMessage(sessionId, {
            type: "ERROR",
            message: `保存失败: ${e.message}`,
            timestamp: Date.now(),
            detail: e.detail || e.hint || undefined,
          });
          return Response.json({ error: e.message, success: false }, { status: 500 });
        }
      },
    },
    "/api/postgres/cancel-query": {
      POST: async (req: Request) => {
        const data = (await req.json()) as { sessionId: string };
        const { sessionId } = data;

        if (!sessionId)
          return new Response(JSON.stringify({ error: "缺少 sessionId", success: false }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接", success: false });

        const { backGroundPool: adminPool, runningQueryPid } = session;
        if (!runningQueryPid) return Response.json({ error: "没有正在执行的查询", success: false });

        try {
          const result = await adminPool.query(`SELECT pg_cancel_backend($1)`, [runningQueryPid]);
          const cancelled = result.rows[0]?.pg_cancel_backend;
          console.log(`[${sessionId}] 取消查询请求已发送, PID: ${runningQueryPid}, 结果: ${cancelled}`);
          return Response.json({
            success: true,
            cancelled,
            message: cancelled ? "查询取消请求已发送" : "查询可能已完成或无法取消",
          });
        } catch (e: any) {
          console.log(`[${sessionId}] 取消查询失败:`, e.message);
          return new Response(JSON.stringify({ error: e.message, success: false }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
    "/api/postgres/query-readonly": {
      POST: async (req: Request) => {
        const { sessionId, query, limit = 1000 } = (await req.json()) as {
          sessionId: string;
          query: string;
          limit?: number;
        };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });
        if (!query) return Response.json({ error: "缺少 query" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const limitedQuery = query.trim().toLowerCase().includes("limit")
            ? query
            : `${query} LIMIT ${limit}`;

          const result = await session.backGroundPool.query({ text: limitedQuery, rowMode: "array" });

          const columns = result.fields.map((f) => ({
            name: f.name,
            tableID: f.tableID,
            columnID: f.columnID,
            isEditable: false,
          }));

          return Response.json({ rows: result.rows, columns, hasMore: false });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },
    "/api/postgres/schemas": {
      POST: async (req: Request) => {
        const { sessionId } = (await req.json()) as { sessionId: string };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(`
            SELECT schema_name FROM information_schema.schemata
            WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'
            ORDER BY schema_name
          `);
          return Response.json({ schemas: result.rows.map((r) => r.schema_name) });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },
    "/api/postgres/tables": {
      POST: async (req: Request) => {
        const { sessionId, schema } = (await req.json()) as { sessionId: string; schema: string };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });
        if (!schema) return Response.json({ error: "缺少 schema" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(
            `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`,
            [schema]
          );
          return Response.json({
            tables: result.rows.filter((r) => r.table_type === "BASE TABLE").map((r) => r.table_name),
            views: result.rows.filter((r) => r.table_type === "VIEW").map((r) => r.table_name),
          });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },
    "/api/postgres/columns": {
      POST: async (req: Request) => {
        const { sessionId, schema, table } = (await req.json()) as {
          sessionId: string;
          schema: string;
          table: string;
        };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });
        if (!schema || !table) return Response.json({ error: "缺少参数" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(
            `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
             FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
            [schema, table]
          );
          return Response.json({ columns: result.rows });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },
    "/api/postgres/indexes": {
      POST: async (req: Request) => {
        const { sessionId, schema, table } = (await req.json()) as {
          sessionId: string;
          schema: string;
          table: string;
        };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(
            `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
            [schema, table]
          );
          return Response.json({ indexes: result.rows });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },
    "/api/postgres/foreign-keys": {
      POST: async (req: Request) => {
        const { sessionId, schema, table } = (await req.json()) as {
          sessionId: string;
          schema: string;
          table: string;
        };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const outgoingResult = await session.backGroundPool.query(
            `SELECT tc.constraint_name, tc.table_schema AS source_schema, tc.table_name AS source_table,
             kcu.column_name AS source_column, ccu.table_schema AS target_schema, ccu.table_name AS target_table,
             ccu.column_name AS target_column
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
            [schema, table]
          );

          const incomingResult = await session.backGroundPool.query(
            `SELECT tc.constraint_name, tc.table_schema AS source_schema, tc.table_name AS source_table,
             kcu.column_name AS source_column, ccu.table_schema AS target_schema, ccu.table_name AS target_table,
             ccu.column_name AS target_column
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
             JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_schema = $1 AND ccu.table_name = $2`,
            [schema, table]
          );

          return Response.json({ outgoing: outgoingResult.rows, incoming: incomingResult.rows });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      },
    },
  };
}
