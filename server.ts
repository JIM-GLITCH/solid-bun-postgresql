import { serve, } from "bun";
import index from "./index.html";
import type { PostgresLoginParmas } from "./frontend/postgres";
import { connectPostgres } from "./backend/connect-postgres";
import { calculateColumnEditable } from "./backend/column-editable";
import { Client } from "pg";

// 每个 session 的连接信息
interface SessionConnection {
  client: Client;           // 主查询连接
  adminClient: Client;      // 管理连接（用于取消查询等操作）
  runningQueryPid?: number; // 当前正在执行查询的 PID
}

// 使用 Map 存储每个 session 的连接信息
const sessionMap = new Map<string, SessionConnection>();

// 获取指定 session 的连接信息
function getSession(sessionId: string): SessionConnection | undefined {
  return sessionMap.get(sessionId);
}

const server = serve({
  development: true,
  routes: {
    "/*": index,
    "/api/hello": { GET: () => Response.json({ message: "Hello from API" }) },
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
          
          client.on("error", (err) => {
            console.error(`[${sessionId}] 数据库错误:`, err);
          });
          client.on("notice", (msg) => {
            console.log(`[${sessionId}] 数据库通知:`, msg);
          });
          
          sessionMap.set(sessionId, { client, adminClient });
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
          
          const result = await client.query({ text: query, rowMode: "array" })
          console.log(`[${sessionId}] 查询结果:`, result.rowCount, "行")
          
          // 查询完成，清除 PID 记录
          session.runningQueryPid = undefined;
          
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