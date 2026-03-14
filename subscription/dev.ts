/**
 * 订阅前后端分开跑：两个 Bun 进程
 * - 前端: bun subscription/frontend/index.html (默认 3000)
 * - 后端: bun subscription/backend/src/index.ts (9000)
 * 用法: bun run subscription:dev
 */

import { join } from "path";
import { $ } from "bun";

const root = import.meta.dir;
const apiDir = join(root, "subscription", "backend");
const portalDir = join(root, "subscription", "frontend");
const apiPort = process.env.API_PORT ?? "9000";
const portalPort = process.env.PORT ?? "3000";



// 2. 并排启动：后端 + 前端
process.env.PORT = apiPort;
process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? `http://localhost:${portalPort}`;
process.env.API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${apiPort}`;

const api = $`bun run --watch src/index.ts`
  .cwd(apiDir)
  .env(process.env as Record<string, string>)
  .nothrow();

const portal = $`bun index.html`
  .cwd(portalDir)
  .env({ ...process.env, PORT: portalPort })
  .nothrow();

console.log(`[subscription] 后端 API  http://localhost:${apiPort}`);
console.log(`[subscription] 前端购买页 http://localhost:${portalPort}`);
console.log("[subscription] Ctrl+C 退出");

await Promise.all([api, portal]);
