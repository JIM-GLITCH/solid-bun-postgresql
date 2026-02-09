/**
 * Bun 打包：前端 → out/webview.js，Extension → out/extension.js
 */
import { SolidPlugin } from "bun-plugin-solid";
import { join } from "path";

const extDir = import.meta.dir;
const rootDir = join(extDir, "..");
const outDir = join(extDir, "out");

// 1. 打包前端 (Solid) → out/webview.js
const frontendEntry = join(rootDir, "frontend", "index-webview.tsx");
const frontendBuild = await Bun.build({
    entrypoints: [frontendEntry],
    outdir: outDir,
    plugins: [SolidPlugin()],
    target: "browser",
});

if (!frontendBuild.success) {
    console.error("Frontend build failed:", frontendBuild.logs);
    process.exit(1);
}
console.log("1. 前端打包完成\n");
// 2. 复制 index.html 到 out 文件夹
const indexHtml = join(extDir, "src", "index.html");
await Bun.$`cp ${indexHtml} ${outDir}/index.html`;

console.log("2. index.html复制完成\n");

// 3. 打包 Extension (Node) → out/extension.js
const extensionEntry = join(extDir, "src", "extension.ts");
const extensionBuild = await Bun.build({
    entrypoints: [extensionEntry],
    outdir: outDir,
    target: "node",
    format: "cjs",
    sourcemap: "external",
    external: ["vscode"],
});

if (!extensionBuild.success) {
    console.error("Extension build failed:", extensionBuild.logs);
    process.exit(1);
}
console.log("3. Extension打包完成\n");
