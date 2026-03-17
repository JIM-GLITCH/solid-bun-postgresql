/**
 * Standalone 开发入口：Node + Hono，仅 API + Monaco
 * 开发时与 Vite 双服务器，前端由 Vite 提供（proxy /api /vs 到此）
 * 用 tsx standalone/server-node.ts 运行
 * SEA 模式：静态资源从 sea.getAsset() 读取
 */

import { Hono } from "hono";
import { createApiRoutes } from "../backend/api-handlers-http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const app = new Hono();
const apiRoutes = createApiRoutes();

// API 路由
for (const [path, handlers] of Object.entries(apiRoutes)) {
  if (handlers.GET) {
    app.get(path, (c) => handlers.GET!(c.req.raw));
  }
  if (handlers.POST) {
    app.post(path, (c) => handlers.POST!(c.req.raw));
  }
}

function frontendBaseUri() {
  // .js：打包后，server 与 index.html 同目录
  // .ts：开发时，server 在 standalone/，前端在 standalone/out/
  const bundled = __filename.endsWith(".js");
  return bundled ? __dirname : join(__dirname, "out");
}

// SEA 单可执行模式：从 sea.getAsset 提供静态资源
async function setupStatic() {
  const sea = await import("node:sea").catch(() => null);
  const isSea = sea?.isSea?.() ?? false;

  if (isSea && sea) {
    const { getAsset, getAssetKeys } = sea;
    const MIME: Record<string, string> = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".ttf": "font/ttf",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };
    app.use("/*", async (c, next) => {
      if (c.req.method !== "GET" && c.req.method !== "HEAD") return next();
      let path = new URL(c.req.url).pathname.replace(/^\/+/, "") || "index.html";
      if (path === "" || path.endsWith("/")) path += "index.html";
      const keys = getAssetKeys();
      const key = keys.find((k) => k === path || k === path.replace(/^\//, ""));
      if (!key) return next();
      try {
        const buf = getAsset(key);
        const ext = key.slice(key.lastIndexOf("."));
        const mime = MIME[ext] ?? "application/octet-stream";
        return c.newResponse(new Uint8Array(buf), 200, {
          "Content-Type": mime,
        });
      } catch {
        return next();
      }
    });
  } else {
    app.use(
      "/*",
      serveStatic({
        root: frontendBaseUri(),
        index: "index.html",
      })
    );
  }

  const PORT = Number(process.env.PORT) || 3000;
  serve({ fetch: app.fetch, port: PORT });
  console.log(`API server at http://localhost:${PORT} (Node)`);
}
setupStatic();