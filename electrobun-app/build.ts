/**
 * Electrobun 前端构建：以 index.html 为入口，Bun 自动打包引用的 tsx
 */
import { join } from "path";
import { mkdir, cp } from "fs/promises";
import { existsSync } from "fs";
import { SolidPlugin } from "bun-plugin-solid";

const root = import.meta.dir;
const projectRoot = join(root, "..");
const outDir = join(root, "dist-electrobun");
const monacoMin = join(projectRoot, "node_modules", "monaco-editor", "min", "vs");

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

// Monaco Workers 需单独提供（主代码已打包）
if (existsSync(monacoMin)) {
  await cp(monacoMin, join(outDir, "vs"), { recursive: true });
  console.log("Monaco Editor vs/ copied");
}

console.log("Electrobun frontend built to electrobun-app/dist-electrobun/");
