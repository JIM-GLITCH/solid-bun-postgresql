import { serve, } from "bun";
import index from "./index.html";
import type { PostgresLoginParmas } from "./frontend/postgres";
import { connectPostgres } from "./backend/connect-postgres";
import { calculateColumnEditable } from "./backend/column-editable";
import { Client } from "pg";
declare global {
  var client: Client | undefined
}
const server = serve({
  development: true,
  routes: {
    "/*": index,
    "/api/hello": { GET: () => Response.json({ message: "Hello from API" }) },
    "/api/connect-postgres": {
      POST: async (req) => {
        const data = await req.json() as PostgresLoginParmas
        console.log(data)
        try {
          global.client = await connectPostgres(data)
          global.client.on("error", (err) => {
            console.error(err);
          });
          global.client.on("notice", (msg) => {
            console.log(msg);
          });
          if (global.client) {
            return Response.json({ sucess: true })
          } else {
            return Response.json({ sucess: false })
          }
        } catch (e) {
          return Response.json({ error: e, sucess: false })
        }
      },
    },
    "/api/postgres/query": {
      POST: async (req) => {
        const data = await req.json() as { query: string }
        // console.log(data)
        try {
          const result = await global.client!.query({ text: data.query, rowMode: "array" })
          console.log(result)
          
          // 计算每列的可编辑信息
          const columnsInfo = await calculateColumnEditable(global.client!, result.fields)
          console.log(columnsInfo)
          return Response.json({
            result: result.rows,
            columns: columnsInfo
          })
        } catch (e: any) {
          console.log(e.message)
          return new Response(JSON.stringify({ error: e.message, sucess: false }), { status: 500, headers: { "Content-Type": "application/json" } })
        }
      },
    },
  },
});

console.log(`Server running at http://localhost:${server.port}`);