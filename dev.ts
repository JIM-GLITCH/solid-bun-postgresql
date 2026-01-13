import { $ } from "bun"

// 启动docker数据库
$`docker compose up`
    .quiet()
    .catch((e: Error) => { console.error(e) })


// 启动后端服务 热更新
$`bun run --hot ./server.ts`
    .quiet(false)
    .catch((e: Error) => { console.error(e) })
