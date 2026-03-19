/**
 * 构建前端+后端+SEA Linux 可执行文件。
 * 使用 Node 25.5+ 的 --build-sea 一步生成，无需 postject
 */
import { $ } from "bun";
import { SolidPlugin } from "bun-plugin-solid";
import { join } from "path";
import { writeFile, cp, readdir, rm, mkdir } from "fs/promises";

const root = join(import.meta.dir, "..");
const outDir = join(import.meta.dir, "out");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// ========== 1. 构建前端 ==========
console.log("📦 [1/4] Building frontend...");
await Bun.build({
  entrypoints: [join(import.meta.dir, "../index.html")],
  outdir: outDir,
  target: "browser",
  minify: true,
  plugins: [SolidPlugin()],
});
await cp(
  join(root, "node_modules", "monaco-editor", "min", "vs", "assets"),
  join(outDir, "vs", "assets"),
  { recursive: true }
);
console.log("✅ Frontend built\n");

// ========== 2. 构建后端 ==========
console.log("📦 [2/4] Building backend...");
await Bun.build({
  entrypoints: [join(import.meta.dir, "server-node.ts")],
  outdir: outDir,
  plugins: [SolidPlugin()],
  target: "node",
  format: "cjs",
  minify: true,
  external: ["cpu-features"],
});
console.log("✅ Backend built\n");

// ========== 3. 准备 sea-config，在容器内生成 blob + postject ==========
console.log("📦 [3/4] 准备 SEA 配置...");
const SKIP = new Set([
  "server-node.js",
  "package.json",
  "node_modules",
  "sea-config.json",
  "sea-prep.blob",
  "solid-project-sea.exe",
  "solid-project-sea",
]);
const skipPrefix = (p: string) => SKIP.has(p) || p.endsWith(".exe") || p.endsWith(".blob");

async function collectAssets(dir: string, prefix = ""): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (skipPrefix(e.name)) continue;
    const full = join(dir, e.name);
    const relNorm = rel.replace(/\\/g, "/");
    if (e.isDirectory()) {
      Object.assign(assets, await collectAssets(full, rel));
    } else {
      assets[relNorm] = relNorm; // 容器内用相对路径
    }
  }
  return assets;
}

const assets = await collectAssets(outDir);
const seaConfig = {
  main: "server-node.js",
  output: "solid-project-sea",
  mainFormat: "commonjs" as const,
  assets,
};
await writeFile(join(outDir, "sea-config.json"), JSON.stringify(seaConfig, null, 2));
console.log(`✅ SEA config (${Object.keys(assets).length} assets)\n`);

// ========== 4. 容器内：Node 25.5+ --build-sea 一步生成 ==========
console.log("📦 [4/4] Docker 内构建 Linux 可执行文件 (node --build-sea)...");
const outAbs = join(outDir).replace(/\\/g, "/");
await $`docker run --rm -v "${outAbs}:/app" -w /app node:25.8.1 sh -c "node --build-sea sea-config.json"`;
console.log("✅ solid-project-sea (Linux)\n");

console.log("🎉 构建完成！standalone/out/solid-project-sea 可直接部署");
