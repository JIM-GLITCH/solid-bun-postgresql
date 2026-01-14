import { serve, } from "bun";
import index from "./index.html";
import type { PostgresLoginParmas } from "./frontend/postgres";
import { connectPostgres } from "./backend/connect-postgres";
import { calculateColumnEditable } from "./backend/column-editable";
import { Client } from "pg";

// 使用 Map 存储每个 session 的数据库连接
const clientMap = new Map<string, Client>();

// 获取指定 session 的客户端连接
function getClient(sessionId: string): Client | undefined {
  return clientMap.get(sessionId);
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
          const existingClient = clientMap.get(sessionId);
          if (existingClient) {
            await existingClient.end().catch(() => {});
            clientMap.delete(sessionId);
          }
          
          const client = await connectPostgres(params)
          client.on("error", (err) => {
            console.error(`[${sessionId}] 数据库错误:`, err);
          });
          client.on("notice", (msg) => {
            console.log(`[${sessionId}] 数据库通知:`, msg);
          });
          
          clientMap.set(sessionId, client);
          console.log(`[${sessionId}] 连接成功，当前连接数: ${clientMap.size}`)
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
        
        const client = getClient(sessionId);
        if (!client) {
          return new Response(JSON.stringify({ error: "未找到数据库连接，请先连接数据库", sucess: false }), { status: 400, headers: { "Content-Type": "application/json" } })
        }
        
        try {
          const result = await client.query({ text: query, rowMode: "array" })
          console.log(`[${sessionId}] 查询结果:`, result.rowCount, "行")
          
          // 计算每列的可编辑信息
          const columnsInfo = await calculateColumnEditable(client, result.fields)
          return Response.json({
            result: result.rows,
            columns: columnsInfo
          })
        } catch (e: any) {
          console.log(`[${sessionId}] 查询错误:`, e.message)
          return new Response(JSON.stringify({ error: e.message, sucess: false }), { status: 500, headers: { "Content-Type": "application/json" } })
        }
      },
    },
  },
});

console.log(`Server running at http://localhost:${server.port}`);