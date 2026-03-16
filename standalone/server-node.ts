/**
 * Standalone 入口：Node + Hono，SSH 可正常工作
 * 开发时内嵌 Vite 提供前端（HMR），单进程单端口
 * 用 tsx standalone/server-node.ts 或 node 运行
 */

import http from "node:http";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import connect from "connect";
import { createServer as createViteServer } from "vite";
import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync, existsSync } from "node:fs";
import { createApiRoutes } from "../backend/api-handlers-http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const monacoVs = join(rootDir, "node_modules", "monaco-editor", "min", "vs");

const MONACO_WORKERS: Record<string, string> = {
  "/vs/assets/editor.worker-Be8ye1pW.js": "monaco-editor/min/vs/assets/editor.worker-Be8ye1pW.js",
  "/vs/assets/json.worker-DKiEKt88.js": "monaco-editor/min/vs/assets/json.worker-DKiEKt88.js",
  "/vs/assets/css.worker-HnVq6Ewq.js": "monaco-editor/min/vs/assets/css.worker-HnVq6Ewq.js",
  "/vs/assets/html.worker-B51mlPHg.js": "monaco-editor/min/vs/assets/html.worker-B51mlPHg.js",
  "/vs/assets/ts.worker-CMbG-7ft.js": "monaco-editor/min/vs/assets/ts.worker-CMbG-7ft.js",
};

const honoApp = new Hono();
const apiRoutes = createApiRoutes();

// API 路由
for (const [path, handlers] of Object.entries(apiRoutes)) {
  if (handlers.GET) {
    honoApp.get(path, (c) => handlers.GET!(c.req.raw));
  }
  if (handlers.POST) {
    honoApp.post(path, (c) => handlers.POST!(c.req.raw));
  }
}

// Monaco workers
for (const [path, relPath] of Object.entries(MONACO_WORKERS)) {
  const fullPath = join(rootDir, "node_modules", relPath);
  if (existsSync(fullPath)) {
    honoApp.get(path, async (c) => {
      const buf = readFileSync(fullPath);
      return new Response(buf, {
        headers: { "Content-Type": "application/javascript" },
      });
    });
  }
}

// Monaco 其他资源
honoApp.get("/vs/*", async (c) => {
  const pathname = c.req.path.slice(4);
  const filePath = join(monacoVs, pathname);
  if (existsSync(filePath)) {
    const buf = readFileSync(filePath);
    const ext = pathname.split(".").pop()?.toLowerCase();
    const mime: Record<string, string> = {
      js: "application/javascript",
      css: "text/css",
      json: "application/json",
    };
    return new Response(buf, {
      headers: ext && mime[ext] ? { "Content-Type": mime[ext] } : {},
    });
  }
  return c.notFound();
});

const honoListener = getRequestListener(honoApp.fetch.bind(honoApp));

// Hono 优先处理 /api 和 /vs
function honoMiddleware(req: http.IncomingMessage, res: http.ServerResponse, next: () => void) {
  const url = req.url || "/";
  if (url.startsWith("/api") || url.startsWith("/vs")) {
    honoListener(req, res);
  } else {
    next();
  }
}

const port = Number(process.env.PORT) || 9000;
const connectApp = connect();
connectApp.use(honoMiddleware);

const server = http.createServer(connectApp);

async function start() {
  const vite = await createViteServer({
    configFile: join(rootDir, "vite.config.standalone.ts"),
    server: {
      middlewareMode: { server },
    },
  });
  connectApp.use(vite.middlewares);

  server.listen(port, () => {
    console.log(`Server running at http://localhost:${port} (Node + Vite)`);
  });
}
start();
