/**
 * Electrobun 前端构建：以 index.html 为入口，Bun 自动打包引用的 tsx
 */
import { join } from "path";
import { mkdir } from "fs/promises";
import { SolidPlugin } from "bun-plugin-solid";

const root = import.meta.dir;
const outDir = join(root, "dist-electrobun");
await mkdir(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "index.html")],
  outdir: outDir,
  target: "browser",
  plugins: [SolidPlugin()],
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

console.log("Electrobun frontend built to electrobun-app/dist-electrobun/");
