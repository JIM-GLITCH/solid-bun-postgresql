/**
 * Electrobun 前端构建：用 Bun 替代 Vite，输出到 dist-electrobun/
 */
import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { SolidPlugin } from "bun-plugin-solid";

const root = import.meta.dir;
const projectRoot = join(root, "..");
const outDir = join(projectRoot, "dist-electrobun");

await mkdir(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(projectRoot, "frontend", "index-electrobun.tsx")],
  outdir: outDir,
  target: "browser",
  plugins: [SolidPlugin()],
  naming: "[name].js",
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

// 复制 HTML（script 改为 ./index.js）
const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Front Table</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
      #root { height: 100%; overflow: hidden; }
      html {
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./index-electrobun.js"></script>
  </body>
</html>
`;

await writeFile(join(outDir, "index.html"), html);
console.log("Electrobun frontend built to dist-electrobun/");
