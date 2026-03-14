/**
 * 一键部署到阿里云 FC
 * 用法: ACR_NAMESPACE=your-namespace bun run deploy.ts
 * TS 代码直接跑，Bun 原生支持，无需编译
 */
import { $ } from "bun";
import { join } from "path";

const namespace = process.env.ACR_NAMESPACE;
if (!namespace) {
  console.error("请设置 ACR_NAMESPACE 环境变量，例如: ACR_NAMESPACE=my-namespace bun run deploy.ts");
  process.exit(1);
}

const image = `registry.cn-hangzhou.aliyuncs.com/${namespace}/db-player-subscription:latest`;
const cwd = join(import.meta.dir);

console.log("[deploy] 构建镜像...");
await $`docker build -t ${image} .`.cwd(cwd);

console.log("[deploy] 推送镜像...");
await $`docker push ${image}`.cwd(cwd);

console.log("[deploy] 完成，镜像:", image);
console.log("[deploy] 在 FC 控制台更新服务镜像地址，或执行 s deploy");
