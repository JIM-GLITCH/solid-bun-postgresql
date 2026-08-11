/**
 * Standalone 入口：Bun 服务启动，静态资源 + RPC 后端
 * 后端逻辑在 backend/rpc-server（组装）与 api-core/*-db-handlers（业务）
 */

import { serve } from "bun";
import index from "../index.html";
import { createRpcBackend } from "../backend/rpc-server";

const { app: rpcApp } = createRpcBackend();

const server = serve({
  idleTimeout: 120,
  routes: {
    "/": index,
  },
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // RPC 会话路由：shakehand / buildconnection(SSE) / call
    if (pathname.startsWith("/rpc/")) {
      return rpcApp.fetch(req);
    }

    if (pathname.startsWith("/chunk-") && pathname.endsWith(".js")) {
      return new Response("Chunk file not found. Please clear browser cache.", {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const ext = pathname.split(".").pop()?.toLowerCase();
    const staticExts = ["js", "css", "json", "svg", "png", "jpg", "jpeg", "gif", "ico", "woff", "woff2", "ttf", "eot", "map", "ts", "tsx"];

    if (ext && staticExts.includes(ext)) {
      const file = Bun.file(`.${pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);
