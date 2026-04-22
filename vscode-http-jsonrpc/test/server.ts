import { RequestType } from 'vscode-jsonrpc';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createHttpServerMessageConnection } from '../';
import express from 'express';

type SumParams = { a: number; b: number };
const echoRequest = new RequestType<string, string, void>('demo/echo');
const sumRequest = new RequestType<SumParams, number, void>('demo/sum');
const port = Number(process.env.PORT ?? '3000');
const expressApp = express()
import { cors } from 'hono/cors'
const app = new Hono();
const { app: routeApp, connection } = createHttpServerMessageConnection();
const path = "/xxx"

app.use(cors())
app.route(path, routeApp)

console.log(`[server] JSON-RPC server started at http://localhost:${port}${path}`);
console.log('[server] rpc endpoint: POST /rpc');
console.log('[server] sse endpoint: GET /sse');

connection.onRequest(echoRequest, async (message) => {
  console.log(`[server] Received echo request: ${message}`);
  return `Echo: ${message}`;
});

connection.onRequest(sumRequest, async (params) => {
  console.log(`[server] Received sum request: a=${params.a}, b=${params.b}`);
  return params.a + params.b;
});

connection.onNotification('demo/ping', (payload) => {
  console.log('[server] Received ping:', payload);
});
connection.onRequest("ping", async () => {
  const result = await connection.sendRequest("ping")
  console.log(result)
  return "pong from server"
})

connection.listen();
serve({
  fetch: app.fetch,
  port,
});
