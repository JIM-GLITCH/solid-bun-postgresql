import { serve, } from "bun";
import index from "./index.html";
import type { PostgresLoginParmas } from "./frontend/postgres";
import { connectPostgres, createPostgresPool } from "./backend/connect-postgres";
import { calculateColumnEditable } from "./backend/column-editable";
import { Client, Pool } from "pg";
import Cursor from "pg-cursor";

// SSE 消息类型
export interface SSEMessage {
  type: 'NOTICE' | 'ERROR' | 'INFO' | 'WARNING' | 'QUERY' | 'NOTIFICATION';
  message: string;
  timestamp: number;
  detail?: string;  // 额外详情
}

// 每个 session 的连接信息
interface SessionConnection {
  userUsedClient: Client;           // 用户使用的客户端（用于执行用户的sql语句,只用这一个可以保证当前用户只在一个事务中操作）
  backGroundPool: Pool;          // 后台查询连接池（用于取消查询,查询列信息等本软件执行的操作,使用 Pool 避免死锁）
  runningQueryPid?: number; // 当前正在执行查询的 PID
  sseControllers: Set<ReadableStreamDefaultController<Uint8Array>>; // SSE 连接控制器
  // 流式查询的 cursor 状态
  cursor?: {
    instance: Cursor;
    columns?: any[];  // 已计算的列信息
    isDone: boolean;  // 是否已读取完毕
  };
}

// 向指定 session 的所有 SSE 客户端发送消息
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
      // 连接可能已关闭，移除该控制器
      session.sseControllers.delete(controller);
    }
  }
}

// 使用 Map 存储每个 session 的连接信息
const sessionMap = new Map<string, SessionConnection>();

// 获取指定 session 的连接信息
function getSession(sessionId: string): SessionConnection | undefined {
  return sessionMap.get(sessionId);
}

const server = serve({
  // development: true,
  idleTimeout: 120,  // SSE 连接需要较长的空闲超时（秒），默认是 10 秒
  routes: {
    "/": index,  // Hash 路由只需要这一行，所有前端路由由 # 后的部分处理
    "/api/hello": { GET: () => Response.json({ message: "Hello from API" }) },
    // SSE 端点：用于向前端推送实时消息（如 PostgreSQL 的 notice 通知）
    "/api/events": {
      GET: (req) => {
        const url = new URL(req.url);
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          return new Response('缺少 sessionId', { status: 400 });
        }

        const session = sessionMap.get(sessionId);
        if (!session) {
          return new Response('未找到数据库连接，请先连接数据库', { status: 400 });
        }

        let controller: ReadableStreamDefaultController<Uint8Array>;
        let heartbeatInterval: ReturnType<typeof setInterval>;

        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            controller = ctrl;
            session.sseControllers.add(controller);
            console.log(`[${sessionId}] SSE 连接建立，当前连接数: ${session.sseControllers.size}`);

            // 发送初始连接成功消息
            const welcomeMsg = `data: ${JSON.stringify({ type: 'APP', message: 'SSE 连接已建立', timestamp: Date.now() })}\n\n`;
            controller.enqueue(new TextEncoder().encode(welcomeMsg));

            // 心跳：每 10 秒发送一次，保持连接活跃
            const sendHeartbeat = () => {
              try {
                // SSE 注释行（以冒号开头），不会被 EventSource 当作消息处理
                controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'));
              } catch (e) {
                // 连接已关闭，清除心跳
                clearInterval(heartbeatInterval);
              }
            };
            // 立即发送第一次心跳，然后每 10 秒发送一次
            sendHeartbeat();
            heartbeatInterval = setInterval(sendHeartbeat, 10000);
          },
          cancel() {
            clearInterval(heartbeatInterval);
            session.sseControllers.delete(controller);
            console.log(`[${sessionId}] SSE 连接关闭，剩余连接数: ${session.sseControllers.size}`);
          }
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          }
        });
      }
    },
    "/api/connect-postgres": {
      POST: async (req) => {
        const data = await req.json() as PostgresLoginParmas & { sessionId: string }
        const { sessionId, ...params } = data;
        console.log(`[${sessionId}] 连接请求:`, params)

        if (!sessionId) {
          return Response.json({ error: "缺少 sessionId", sucess: false })
        }

        try {
          // 如果该 session 已有连接，先关闭旧连接
          const existingSession = sessionMap.get(sessionId);
          if (existingSession) {
            await existingSession.userUsedClient.end().catch(() => { });
            await existingSession.backGroundPool.end().catch(() => { });
            sessionMap.delete(sessionId);
          }

          // 创建主查询连接和管理连接池
          const client = await connectPostgres(params);
          const adminPool = createPostgresPool(params);

          // 监听数据库连接错误
          client.on("error", (err) => {
            console.error(`[${sessionId}] 数据库错误:`, err);
            sendSSEMessage(sessionId, {
              type: 'ERROR',
              message: err.message || String(err),
              timestamp: Date.now()
            });
          });

          // 监听 NOTICE/WARNING 等消息
          client.on("notice", (msg) => {
            console.log(`[${sessionId}] 数据库通知:`, msg);
            // PostgreSQL notice 包含 severity (NOTICE, WARNING, INFO, DEBUG, LOG)
            console.log(msg.severity)
            const severity = (msg.severity || 'NOTICE').toUpperCase();

            sendSSEMessage(sessionId, {
              type: severity as SSEMessage['type'],
              message: msg.message || String(msg),
              timestamp: Date.now(),
              detail: msg.detail || msg.hint || undefined
            });
          });

          // 监听 LISTEN/NOTIFY 通知
          client.on("notification", (msg: any) => {
            console.log(`[${sessionId}] NOTIFY 消息:`, msg);
            sendSSEMessage(sessionId, {
              type: 'NOTIFICATION',
              message: `[${msg.channel}] ${msg.payload || '(无内容)'}`,
              timestamp: Date.now()
            });
          });

          // 监听连接结束
          client.on("end", () => {
            console.log(`[${sessionId}] 数据库连接已断开`);
            sendSSEMessage(sessionId, {
              type: 'WARNING',
              message: '数据库连接已断开',
              timestamp: Date.now()
            });
          });

          sessionMap.set(sessionId, { userUsedClient: client, backGroundPool: adminPool, sseControllers: new Set() });
          console.log(`[${sessionId}] 连接成功，当前 session 数: ${sessionMap.size}`)
          return Response.json({ sucess: true })
        } catch (e) {
          return Response.json({ error: e, sucess: false })
        }
      },
    },
    "/api/postgres/query": {
      POST: async (req) => {
        const data = await req.json() as { query: string, sessionId: string }
        const { query, sessionId } = data;

        if (!sessionId) {
          return new Response(JSON.stringify({ error: "缺少 sessionId", sucess: false }), { status: 400, headers: { "Content-Type": "application/json" } })
        }

        const session = getSession(sessionId);
        if (!session) {
          return new Response(JSON.stringify({ error: "未找到数据库连接，请先连接数据库", sucess: false }), { status: 400, headers: { "Content-Type": "application/json" } })
        }

        const { userUsedClient: client } = session;

        try {
          // 记录当前连接的 PID，用于后续可能的取消操作
          const pid = (client as any).processID;
          if (pid) {
            session.runningQueryPid = pid;
            console.log(`[${sessionId}] 开始查询, PID: ${pid}`)
          }

          // 发送查询开始消息
          const startTime = Date.now();
          sendSSEMessage(sessionId, {
            type: 'QUERY',
            message: `执行查询: ${query.slice(0, 100)}${query.length > 100 ? '...' : ''}`,
            timestamp: startTime
          });

          const result = await client.query({ text: query, rowMode: "array" })
          const duration = Date.now() - startTime;
          console.log(`[${sessionId}] 查询结果:`, result.rowCount, "行")

          // 查询完成，清除 PID 记录
          session.runningQueryPid = undefined;

          // 发送查询完成消息
          const commandInfo = result.command ? `${result.command} ` : '';
          sendSSEMessage(sessionId, {
            type: 'INFO',
            message: `${commandInfo}完成: ${result.rowCount ?? 0} 行，耗时 ${duration}ms`,
            timestamp: Date.now()
          });

          // 计算每列的可编辑信息
          const columnsInfo = await calculateColumnEditable(client, result.fields)
          return Response.json({
            result: result.rows,
            columns: columnsInfo
          })
        } catch (e: any) {
          // 查询出错或被取消，清除 PID 记录
          session.runningQueryPid = undefined;
          console.log(`[${sessionId}] 查询错误:`, e.message)

          // 发送查询错误消息
          sendSSEMessage(sessionId, {
            type: 'ERROR',
            message: `查询错误: ${e.message}`,
            timestamp: Date.now(),
            detail: e.detail || e.hint || undefined
          });

          return new Response(JSON.stringify({ error: e.message, sucess: false }), { status: 500, headers: { "Content-Type": "application/json" } })
        }
      },
    },
    // 流式查询：启动查询并返回第一批数据
    "/api/postgres/query-stream": {
      POST: async (req) => {
        const data = await req.json() as { query: string, sessionId: string, batchSize?: number }
        const { query, sessionId, batchSize = 100 } = data;

        if (!sessionId) {
          return Response.json({ error: "缺少 sessionId", success: false }, { status: 400 })
        }

        const session = getSession(sessionId);
        if (!session) {
          return Response.json({ error: "未找到数据库连接，请先连接数据库", success: false }, { status: 400 })
        }

        const { userUsedClient: client, backGroundPool: adminPool } = session;

        // 如果有之前的 cursor，先关闭它
        if (session.cursor) {
          await new Promise<void>(resolve => session.cursor!.instance.close(() => resolve()));
          session.cursor = undefined;
        }

        // 记录当前连接的 PID，用于后续可能的取消操作
        const pid = (client as any).processID;
        if (pid) {
          session.runningQueryPid = pid;
          console.log(`[${sessionId}] 开始流式查询, PID: ${pid}`)
        }

        // 创建 cursor（在 try 外声明，以便 catch 中可以访问并关闭）
        let cursor: Cursor | undefined;

        try {
          cursor = client.query(new Cursor(query, [], { rowMode: "array" }));

          // 读取第一批数据
          const rows = await new Promise<any[]>((resolve, reject) => {
            cursor!.read(batchSize, (err: any, rows: any[]) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          // 获取并计算列信息
          const fields = (cursor as any)._result?.fields;
          const columnsInfo = fields ? await calculateColumnEditable(adminPool, fields,query) : [];

          const isDone = rows.length < batchSize;

          if (isDone) {
            // 数据已全部读取完，关闭 cursor
            await new Promise<void>(resolve => cursor!.close(() => resolve()));
            session.runningQueryPid = undefined;
            console.log(`[${sessionId}] 查询完成，共 ${rows.length} 行`)
          } else {
            // 保存 cursor 状态，等待后续请求
            session.cursor = {
              instance: cursor,
              columns: columnsInfo,
              isDone: false
            };
            console.log(`[${sessionId}] 返回前 ${rows.length} 行，cursor 保持打开`)
          }

          return Response.json({
            rows,
            columns: columnsInfo,
            hasMore: !isDone
          })
        } catch (e: any) {
          // 出错时关闭 cursor，避免资源泄漏
          if (cursor) {
            await new Promise<void>(resolve => cursor!.close(() => resolve()));
          }
          session.runningQueryPid = undefined;
          console.error(`[${sessionId}] 流式查询错误:`, e.message);
          return Response.json({ error: e.message, success: false }, { status: 500 })
        }
      }
    },
    // 流式查询：获取更多数据
    "/api/postgres/query-stream-more": {
      POST: async (req) => {
        const data = await req.json() as { sessionId: string, batchSize?: number }
        const { sessionId, batchSize = 100 } = data;

        if (!sessionId) {
          return Response.json({ error: "缺少 sessionId", success: false }, { status: 400 })
        }

        const session = getSession(sessionId);
        if (!session) {
          return Response.json({ error: "未找到数据库连接", success: false }, { status: 400 })
        }

        if (!session.cursor || session.cursor.isDone) {
          return Response.json({ rows: [], hasMore: false })
        }

        const { cursor } = session;

        try {
          // 读取下一批数据
          const rows = await new Promise<any[]>((resolve, reject) => {
            cursor.instance.read(batchSize, (err: any, rows: any[]) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          const isDone = rows.length < batchSize;

          if (isDone) {
            // 数据已全部读取完，关闭 cursor
            await new Promise<void>(resolve => cursor.instance.close(() => resolve()));
            session.cursor = undefined;
            session.runningQueryPid = undefined;
            console.log(`[${sessionId}] 查询完成，本批 ${rows.length} 行`)
          } else {
            cursor.isDone = false;
            console.log(`[${sessionId}] 返回 ${rows.length} 行，cursor 保持打开`)
          }

          return Response.json({
            rows,
            hasMore: !isDone
          })
        } catch (e: any) {
          // 出错时清理 cursor
          await new Promise<void>(resolve => cursor.instance.close(() => resolve()));
          session.cursor = undefined;
          session.runningQueryPid = undefined;
          console.error(`[${sessionId}] 读取更多数据错误:`, e.message);
          return Response.json({ error: e.message, success: false }, { status: 500 })
        }
      }
    },
    // 保存修改：使用 adminClient 执行 UPDATE 语句
    "/api/postgres/save-changes": {
      POST: async (req) => {
        const data = await req.json() as { sql: string, sessionId: string }
        const { sql, sessionId } = data;

        if (!sessionId) {
          return Response.json({ error: "缺少 sessionId", success: false }, { status: 400 })
        }

        if (!sql) {
          return Response.json({ error: "缺少 SQL 语句", success: false }, { status: 400 })
        }

        const session = getSession(sessionId);
        if (!session) {
          return Response.json({ error: "未找到数据库连接，请先连接数据库", success: false }, { status: 400 })
        }

        const { backGroundPool: adminPool } = session;

        try {
          console.log(`[${sessionId}] 执行保存修改 (adminPool): ${sql.slice(0, 100)}${sql.length > 100 ? '...' : ''}`)
          const result = await adminPool.query(sql);
          console.log(`[${sessionId}] 保存成功, 影响行数: ${result.rowCount}`)

          sendSSEMessage(sessionId, {
            type: 'INFO',
            message: `保存成功: ${result.rowCount ?? 0} 行受影响`,
            timestamp: Date.now()
          });

          return Response.json({ success: true, rowCount: result.rowCount })
        } catch (e: any) {
          console.error(`[${sessionId}] 保存失败:`, e.message);

          sendSSEMessage(sessionId, {
            type: 'ERROR',
            message: `保存失败: ${e.message}`,
            timestamp: Date.now(),
            detail: e.detail || e.hint || undefined
          });

          return Response.json({ error: e.message, success: false }, { status: 500 })
        }
      }
    },
    "/api/postgres/cancel-query": {
      POST: async (req) => {
        const data = await req.json() as { sessionId: string }
        const { sessionId } = data;

        if (!sessionId) {
          return new Response(JSON.stringify({ error: "缺少 sessionId", success: false }), { status: 400, headers: { "Content-Type": "application/json" } })
        }

        const session = getSession(sessionId);
        if (!session) {
          return Response.json({ error: "未找到数据库连接", success: false })
        }

        const { backGroundPool: adminPool, runningQueryPid } = session;
        if (!runningQueryPid) {
          return Response.json({ error: "没有正在执行的查询", success: false })
        }

        try {
          // 使用管理连接池执行取消命令
          const result = await adminPool.query(`SELECT pg_cancel_backend($1)`, [runningQueryPid]);
          const cancelled = result.rows[0]?.pg_cancel_backend;

          console.log(`[${sessionId}] 取消查询请求已发送, PID: ${runningQueryPid}, 结果: ${cancelled}`)

          return Response.json({
            success: true,
            cancelled,
            message: cancelled ? "查询取消请求已发送" : "查询可能已完成或无法取消"
          })
        } catch (e: any) {
          console.log(`[${sessionId}] 取消查询失败:`, e.message)
          return new Response(JSON.stringify({ error: e.message, success: false }), { status: 500, headers: { "Content-Type": "application/json" } })
        }
      },
    },
    // Sidebar 专用的只读查询（使用 backGrouundPool，不阻塞用户操作）
    "/api/postgres/query-readonly": {
      POST: async (req) => {
        const { sessionId, query, limit = 1000 } = await req.json() as { sessionId: string; query: string; limit?: number };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });
        if (!query) return Response.json({ error: "缺少 query" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          // 添加 LIMIT 防止查询过多数据
          const limitedQuery = query.trim().toLowerCase().includes('limit')
            ? query
            : `${query} LIMIT ${limit}`;

          const result = await session.backGroundPool.query({ text: limitedQuery, rowMode: "array" });

          // 简单返回列名和数据
          const columns = result.fields.map(f => ({
            name: f.name,
            tableID: f.tableID,
            columnID: f.columnID,
            isEditable: false  // 只读查询不可编辑
          }));

          return Response.json({
            rows: result.rows,
            columns,
            hasMore: false
          });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }
    },
    // 获取数据库结构：schemas
    "/api/postgres/schemas": {
      POST: async (req) => {
        const { sessionId } = await req.json() as { sessionId: string };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(`
            SELECT schema_name 
            FROM information_schema.schemata 
            WHERE schema_name NOT LIKE 'pg_%' 
              AND schema_name != 'information_schema'
            ORDER BY schema_name
          `);
          return Response.json({ schemas: result.rows.map(r => r.schema_name) });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }
    },
    // 获取指定 schema 下的表
    "/api/postgres/tables": {
      POST: async (req) => {
        const { sessionId, schema } = await req.json() as { sessionId: string; schema: string };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });
        if (!schema) return Response.json({ error: "缺少 schema" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(`
            SELECT table_name, table_type
            FROM information_schema.tables 
            WHERE table_schema = $1
            ORDER BY table_type, table_name
          `, [schema]);
          return Response.json({
            tables: result.rows.filter(r => r.table_type === 'BASE TABLE').map(r => r.table_name),
            views: result.rows.filter(r => r.table_type === 'VIEW').map(r => r.table_name)
          });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }
    },
    // 获取表/视图的列信息
    "/api/postgres/columns": {
      POST: async (req) => {
        const { sessionId, schema, table } = await req.json() as { sessionId: string; schema: string; table: string };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });
        if (!schema || !table) return Response.json({ error: "缺少参数" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(`
            SELECT 
              column_name,
              data_type,
              is_nullable,
              column_default,
              character_maximum_length
            FROM information_schema.columns 
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position
          `, [schema, table]);
          return Response.json({ columns: result.rows });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }
    },
    // 获取表的索引信息
    "/api/postgres/indexes": {
      POST: async (req) => {
        const { sessionId, schema, table } = await req.json() as { sessionId: string; schema: string; table: string };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          const result = await session.backGroundPool.query(`
            SELECT 
              indexname,
              indexdef
            FROM pg_indexes 
            WHERE schemaname = $1 AND tablename = $2
            ORDER BY indexname
          `, [schema, table]);
          return Response.json({ indexes: result.rows });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }
    },
    // 获取表的外键信息
    "/api/postgres/foreign-keys": {
      POST: async (req) => {
        const { sessionId, schema, table } = await req.json() as { sessionId: string; schema: string; table: string };
        if (!sessionId) return Response.json({ error: "缺少 sessionId" }, { status: 400 });

        const session = getSession(sessionId);
        if (!session) return Response.json({ error: "未找到数据库连接" }, { status: 400 });

        try {
          // 获取从该表出发的外键（该表引用其他表）
          const outgoingResult = await session.backGroundPool.query(`
            SELECT
              tc.constraint_name,
              tc.table_schema AS source_schema,
              tc.table_name AS source_table,
              kcu.column_name AS source_column,
              ccu.table_schema AS target_schema,
              ccu.table_name AS target_table,
              ccu.column_name AS target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = $1
              AND tc.table_name = $2
          `, [schema, table]);

          // 获取指向该表的外键（其他表引用该表）
          const incomingResult = await session.backGroundPool.query(`
            SELECT
              tc.constraint_name,
              tc.table_schema AS source_schema,
              tc.table_name AS source_table,
              kcu.column_name AS source_column,
              ccu.table_schema AS target_schema,
              ccu.table_name AS target_table,
              ccu.column_name AS target_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
              AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_schema = $1
              AND ccu.table_name = $2
          `, [schema, table]);

          return Response.json({ 
            outgoing: outgoingResult.rows,  // 该表引用其他表
            incoming: incomingResult.rows   // 其他表引用该表
          });
        } catch (e: any) {
          return Response.json({ error: e.message }, { status: 500 });
        }
      }
    },
  },
  // 处理未被 routes 匹配的请求
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;
    
    // 尝试作为静态文件处理（检查常见的静态资源扩展名）
    const ext = pathname.split('.').pop()?.toLowerCase();
    const staticExts = ['js', 'ts', 'tsx', 'jsx', 'css', 'json', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'ico', 'woff', 'woff2', 'ttf', 'eot', 'map'];
    
    if (ext && staticExts.includes(ext)) {
      // 尝试返回静态文件
      const file = Bun.file(`.${pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }
    
    // 对于未匹配的路由，返回 404
    // 注意：前端路由需要在 routes 中显式配置（使用 index），
    // 因为 Bun 需要处理 HTML 中的 TypeScript 引用
    return new Response("Not Found", { status: 404 });
  }
});

console.log(`Server running at http://localhost:${server.port}`);