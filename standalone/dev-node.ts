/**
 * 前端
 *     bun build 构建 frontend 到 standalone/out
 * 后端
 *     tsx standalone/server-node.ts
 */
import { $ } from "bun";
import { join } from "path";
import { SolidPlugin } from "bun-plugin-solid";

const root = join(import.meta.dir, "..");
const outDir = join(import.meta.dir, "out");

console.log("📦 [1/2] Building frontend (bun build)...");
await Bun.build({
  entrypoints: [join(import.meta.dir, "../index.html")],
  outdir: outDir,
  target: "browser",
  plugins: [SolidPlugin()],
});
console.log("✅ Frontend built to " + outDir + "\n");

console.log("📦 [2/2] Starting server...");
await $`npx tsx standalone/server-node.ts --port=3000`.cwd(root).quiet(false);