/**
 * Standalone 入口（Bun 运行时）：Bun.serve 提供静态资源 + tRPC。
 *
 * 与 `server-node.ts`（Hono + Node，生产 SEA 用）保持同一份 API 面：
 * - `/api/trpc/*`：tRPC（业务 RPC 唯一入口）
 * - `/api/db/disconnect`：页面卸载 keepalive 断开
 */

import { serve } from "bun";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import index from "../index.html";
import { DB_DISCONNECT_PATH, handleDbDisconnectBeacon } from "../backend/api-handlers-http";
import { appRouter, createContext } from "../backend/trpc";

const server = serve({
  idleTimeout: 120,
  routes: {
    "/": index,
  },
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/api/trpc")) {
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        req,
        router: appRouter,
        createContext: ({ req }) => createContext({ req }),
      });
    }

    if (req.method === "POST" && pathname === DB_DISCONNECT_PATH) {
      return handleDbDisconnectBeacon(req);
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
