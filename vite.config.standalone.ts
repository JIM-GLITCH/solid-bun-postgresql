/**
 * Standalone 开发：Vite 作为中间件嵌入 Node 服务器
 * 由 server-node.ts 内嵌使用，单端口 9000
 */
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [solidPlugin() as any],
  root: ".",
  resolve: {
    conditions: ["development", "browser"],
  },
});
