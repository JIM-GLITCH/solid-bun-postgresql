/**
 * Standalone 入口：Bun 服务启动，静态资源 + API 路由
 * 后端逻辑在 backend/api-handlers-http（路由）与 api-core（业务）
 * Monaco workers 用 import file 嵌入，编译后随 exe 一起分发
 */

import { serve } from "bun";
import { join } from "path";
import index from "../index.html";
import { createApiRoutes, handleApiPost } from "../backend/api-handlers-http";

// Monaco workers - 用 import file 嵌入，bun build --compile 时打包进 exe（worker 为 .js 无 d.ts）
// @ts-expect-error import with type file
import editorWorkerPath from "../node_modules/monaco-editor/min/vs/assets/editor.worker-Be8ye1pW.js" with { type: "file" };
// @ts-expect-error
import jsonWorkerPath from "../node_modules/monaco-editor/min/vs/assets/json.worker-DKiEKt88.js" with { type: "file" };
// @ts-expect-error
import cssWorkerPath from "../node_modules/monaco-editor/min/vs/assets/css.worker-HnVq6Ewq.js" with { type: "file" };
// @ts-expect-error
import htmlWorkerPath from "../node_modules/monaco-editor/min/vs/assets/html.worker-B51mlPHg.js" with { type: "file" };
// @ts-expect-error
import tsWorkerPath from "../node_modules/monaco-editor/min/vs/assets/ts.worker-CMbG-7ft.js" with { type: "file" };

const apiRoutes = createApiRoutes();
const monacoVs = join(import.meta.dir, "..", "node_modules", "monaco-editor", "min", "vs");

const workerHeaders = { "Content-Type": "application/javascript" as const };

const server = serve({
  idleTimeout: 120,
  routes: {
    "/": index,
    ...apiRoutes,
    // Monaco workers - 嵌入后提供，编译时打包进 exe
    "/vs/assets/editor.worker-Be8ye1pW.js": () => new Response(Bun.file(editorWorkerPath), { headers: workerHeaders }),
    "/vs/assets/json.worker-DKiEKt88.js": () => new Response(Bun.file(jsonWorkerPath), { headers: workerHeaders }),
    "/vs/assets/css.worker-HnVq6Ewq.js": () => new Response(Bun.file(cssWorkerPath), { headers: workerHeaders }),
    "/vs/assets/html.worker-B51mlPHg.js": () => new Response(Bun.file(htmlWorkerPath), { headers: workerHeaders }),
    "/vs/assets/ts.worker-CMbG-7ft.js": () => new Response(Bun.file(tsWorkerPath), { headers: workerHeaders }),
  },
  async fetch(req) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (req.method === "POST" && pathname.startsWith("/api/")) {
      return handleApiPost(req);
    }

    // Monaco 其他资源（loader、base 等）- 开发时从 node_modules 读取
    if (pathname.startsWith("/vs/")) {
      const file = Bun.file(join(monacoVs, pathname.slice(4)));
      if (await file.exists()) {
        const ext = pathname.split(".").pop()?.toLowerCase();
        const mime: Record<string, string> = {
          js: "application/javascript",
          css: "text/css",
          json: "application/json",
        };
        return new Response(file, {
          headers: ext && mime[ext] ? { "Content-Type": mime[ext] } : {},
        });
      }
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
