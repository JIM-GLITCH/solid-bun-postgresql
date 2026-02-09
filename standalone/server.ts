/**
 * Standalone 入口：Bun 服务启动，静态资源 + API 路由
 * 后端逻辑在 backend/api-handlers
 */

import { serve } from "bun";
import index from "./index.html";
import { createApiRoutes } from "../backend/api-handlers-http";

const apiRoutes = createApiRoutes();

const server = serve({
  idleTimeout: 120,
  routes: {
    "/": index,
    ...apiRoutes,
  },
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

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
