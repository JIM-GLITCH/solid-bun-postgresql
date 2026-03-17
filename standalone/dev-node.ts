/**
 * 前端
 *     bun build 构建 frontend 到 standalone/out
 *     复制 monaco-editor/min/vs 到 out/vs
 * 后端
 *     tsx standalone/server-node.ts
 */
import { $ } from "bun";
import { join } from "path";
import { cp } from "fs/promises";
import { SolidPlugin } from "bun-plugin-solid";

const root = join(import.meta.dir, "..");
const outDir = join(import.meta.dir, "out");

console.log("📦 [1/2] Building frontend (bun build)...");
await Bun.build({
  entrypoints: [join(import.meta.dir, "index.html")],
  outdir: outDir,
  target: "browser",
  plugins: [SolidPlugin()],
});
await cp(join(root, "node_modules", "monaco-editor", "min", "vs"), join(outDir, "vs"), {
  recursive: true,
});
console.log("✅ Frontend built to " + outDir + "\n");

console.log("📦 [2/2] Starting server...");
await $`npx tsx standalone/server-node.ts --port=3000`.cwd(root).quiet(false);