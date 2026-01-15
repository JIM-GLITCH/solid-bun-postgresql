import { serve, } from "bun";
import index from "./index.html";
import type { PostgresLoginParmas } from "./frontend/postgres";
import { connectPostgres } from "./backend/connect-postgres";
import { calculateColumnEditable } from "./backend/column-editable";
import { Client } from "pg";

// SSE 消息类型
interface SSEMessage {
  type: 'notice' | 'error' | 'info' | 'warning' | 'query' | 'notification';
  message: string;
  timestamp: number;
  detail?: string;  // 额外详情
}

// 每个 session 的连接信息
interface SessionConnection {
  client: Client;           // 主查询连接
  adminClient: Client;      // 管理连接（用于取消查询等操作）
  runningQueryPid?: number; // 当前正在执行查询的 PID
  sseControllers: Set<ReadableStreamDefaultController<Uint8Array>>; // SSE 连接控制器
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
  development: true,
  idleTimeout: 120,  // SSE 连接需要较长的空闲超时（秒），默认是 10 秒
  routes: {
    "/*": index,
    "/api/hello": { GET: () => Response.json({ message: "Hello from API" }) },
    // SSE 端点：用于向前端推送实时消息（如 PostgreSQL 的 notice 通知）
    "/api/events?sessionid=:sessionId": {
      GET: (req) => {
        const sessionId = req.params.sessionId;
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
            const welcomeMsg = `data: ${JSON.stringify({ type: 'info', message: 'SSE 连接已建立', timestamp: Date.now() })}\n\n`;
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
            await existingSession.client.end().catch(() => {});
            await existingSession.adminClient.end().catch(() => {});
            sessionMap.delete(sessionId);
          }
          
          // 创建主查询连接和管理连接
          const [client, adminClient] = await Promise.all([
            connectPostgres(params),
            connectPostgres(params)
          ]);
          
          // 监听数据库连接错误
          client.on("error", (err) => {
            console.error(`[${sessionId}] 数据库错误:`, err);
            sendSSEMessage(sessionId, {
              type: 'error',
              message: err.message || String(err),
              timestamp: Date.now()
            });
          });
          
          // 监听 NOTICE/WARNING 等消息
          client.on("notice", (msg: any) => {
            console.log(`[${sessionId}] 数据库通知:`, msg);
            // PostgreSQL notice 包含 severity (NOTICE, WARNING, INFO, DEBUG, LOG)
            const severity = msg.severity?.toLowerCase() || 'notice';
            const type = severity === 'warning' ? 'warning' : 'notice';
            sendSSEMessage(sessionId, {
              type,
              message: msg.message || String(msg),
              timestamp: Date.now(),
              detail: msg.detail || msg.hint || undefined
            });
          });
          
          // 监听 LISTEN/NOTIFY 通知
          client.on("notification", (msg: any) => {
            console.log(`[${sessionId}] NOTIFY 消息:`, msg);
            sendSSEMessage(sessionId, {
              type: 'notification',
              message: `[${msg.channel}] ${msg.payload || '(无内容)'}`,
              timestamp: Date.now()
            });
          });
          
          // 监听连接结束
          client.on("end", () => {
            console.log(`[${sessionId}] 数据库连接已断开`);
            sendSSEMessage(sessionId, {
              type: 'warning',
              message: '数据库连接已断开',
              timestamp: Date.now()
            });
          });
          
          sessionMap.set(sessionId, { client, adminClient, sseControllers: new Set() });
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
        
        const { client } = session;
        
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
            type: 'query',
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
            type: 'info',
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
            type: 'error',
            message: `查询错误: ${e.message}`,
            timestamp: Date.now(),
            detail: e.detail || e.hint || undefined
          });
          
          return new Response(JSON.stringify({ error: e.message, sucess: false }), { status: 500, headers: { "Content-Type": "application/json" } })
        }
      },
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
        
        const { adminClient, runningQueryPid } = session;
        if (!runningQueryPid) {
          return Response.json({ error: "没有正在执行的查询", success: false })
        }
        
        try {
          // 使用管理连接执行取消命令
          const result = await adminClient.query(`SELECT pg_cancel_backend($1)`, [runningQueryPid]);
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
  },
});

console.log(`Server running at http://localhost:${server.port}`);