/**
 * Standalone 开发入口：Node + Hono，仅 API + Monaco
 * 开发模式：Vite (3000) 代理 /api、/vs 到此服务 (3001)；前端由 Vite 提供（HMR）
 * 生产/SEA：静态资源从 out/ 或 sea.getAsset() 读取
 * 开发：bun run dev（concurrently 启动 api:3001 + vite:3000）
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
  const bundled = __filename.endsWith(".js");
  return bundled ? __dirname : join(__dirname, "out");
}

// SEA 单可执行模式：从 sea.getAsset 提供静态资源
async function setupStatic() {
  const sea = await import("node:sea").catch(() => null);
  const isSea = sea?.isSea?.() ?? false;

  if (isSea && sea) {
    const { getAsset } = sea;
    const getAssetKeys = (sea as { getAssetKeys?: () => string[] }).getAssetKeys;
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
      const keys = getAssetKeys?.() ?? [];
      const key = keys.find((k: string) => k === path || k === path.replace(/^\//, ""));
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
    // Monaco /vs：开发时从 node_modules 提供（生产时 out/vs 由 serveStatic 覆盖）
    const monacoVs = join(__dirname, "..", "node_modules", "monaco-editor", "min", "vs");
    app.use("/vs/*", serveStatic({ root: monacoVs, rewriteRequestPath: (p) => p.replace(/^\/?vs\//, "") }));
    app.use(
      "/*",
      serveStatic({
        root: frontendBaseUri(),
        index: "index.html",
      })
    );
  }

  const isDev = __filename.endsWith(".ts");
  const PORT = Number(process.env.PORT) || (isDev ? 3001 : 3000);
  serve({ fetch: app.fetch, port: PORT });
  console.log(`API server at http://localhost:${PORT} (Node)`);
  if (isDev) console.log(`  → Vite proxies /api, /vs to this port`);
}

setupStatic();