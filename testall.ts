import { $ } from "bun"
// 前端测试
await $`bun run vitest run`.catch((e:Error) => {
    console.error(e)
})
// 后端测试
await $`bun test`.catch((e:Error) => {
    console.error(e)
})