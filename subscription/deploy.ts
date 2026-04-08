import { $ } from "bun";
import { join } from "path";

const root = import.meta.dir;

// 注意：此脚本假定 frontend 和 backend 均有 deploy.ts
const backendDir = join(root, "backend");
const frontendDir = join(root, "frontend");

console.log("[subscription] 后端部署开始（读取 subscription/backend/.env）");
await $`bun run deploy.ts`.cwd(backendDir);

console.log("[subscription] 前端部署开始");
await $`bun run deploy.ts`.cwd(frontendDir);

console.log("[subscription] 部署完成！");