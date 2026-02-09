import { $ } from "bun";

// 启动 docker 数据库（从项目根目录查找 docker-compose.yml）
$`docker compose up`
  .quiet()
  .catch((e: Error) => { console.error(e) });

// 启动后端服务 热更新（从项目根运行）
$`bun run --hot ./standalone/server.ts`
  .quiet(false)
  .catch((e: Error) => { console.error(e) });
