/**
 * 前端 bun 构建 + 后端 bun 构建 + Node.js SEA 单可执行
 * 需要 Node 20+；25.5+ 用 --build-sea 一步生成，否则用 postject 流程
 */
import { $ } from "bun";
import { SolidPlugin } from "bun-plugin-solid";
import { join } from "path";
import { writeFile, cp, readdir, rm, access } from "fs/promises";
// 先清空 out 目录
await rm(join(import.meta.dir, "out"), { recursive: true, force: true });
const nodeCmd = "node";

const root = join(import.meta.dir, "..");
const outDir = join(import.meta.dir, "out");

console.log("📦 [1/4] Building frontend (bun build)...");
await Bun.build({
  entrypoints: [join(import.meta.dir, "../index.html")],
  outdir: outDir,
  target: "browser",
  minify: true,
  plugins: [SolidPlugin()],
});
// 只复制 monaco-editor/min/vs/assets 目录下的文件
await cp(join(root, "node_modules", "monaco-editor", "min", "vs", "assets"), join(outDir, "vs", "assets"), {
  recursive: true,
});
console.log("✅ Frontend built\n");

console.log("📦 [2/4] Building backend (bun build)...");
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

console.log("📦 [3/4] Generating SEA config...");
// cpu-features 为 ssh2 可选依赖，SEA 嵌入后无 node_modules，ssh2 会走纯 JS 路径

// 收集需嵌入的静态资源（排除 server-node.js、package.json、node_modules、已有 exe 等）
const SKIP = new Set([
  "server-node.js",
  "package.json",
  "node_modules",
  "sea-config.json",
  "sea-prep.blob",
]);
const skipPrefix = (p: string) => SKIP.has(p) || p.endsWith(".exe") || p.endsWith(".blob");

async function collectAssets(dir: string, prefix = ""): Promise<Record<string, string>> {
  const assets: Record<string, string> = {};
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (skipPrefix(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      Object.assign(assets, await collectAssets(full, rel));
    } else {
      assets[rel.replace(/\\/g, "/")] = full;
    }
  }
  return assets;
}

const assets = await collectAssets(outDir);
const seaConfig = {
  main: join(outDir, "server-node.js"),
  output: join(outDir, "solid-project-sea.exe"),
  mainFormat: "commonjs" as const,
  assets,
};

await writeFile(join(outDir, "sea-config.json"), JSON.stringify(seaConfig, null, 2));
console.log(`✅ SEA config: ${Object.keys(assets).length} assets\n`);

const nodeVersion = (await $`${nodeCmd} -p "process.version"`.cwd(outDir).quiet().text()).trim();
const match = nodeVersion.match(/^v(\d+)\.(\d+)/);
const nodeMajor = match ? parseInt(match[1], 10) : 0;
const nodeMinor = match ? parseInt(match[2], 10) : 0;
const useBuildSea = nodeMajor > 25 || (nodeMajor === 25 && nodeMinor >= 5);

console.log("📦 [4/4] Building SEA executable...");
if (useBuildSea) {
  console.log(`   (Node ${nodeVersion} >= 25.5, using --build-sea)`);
  await $`${nodeCmd} --build-sea sea-config.json`.cwd(outDir).quiet(false);
} else {
  console.log(`   (Node ${nodeVersion} < 25.5, using postject workflow)`);
  const blobConfig = { ...seaConfig, output: join(outDir, "sea-prep.blob") };
  await writeFile(join(outDir, "sea-config.json"), JSON.stringify(blobConfig, null, 2));
  await $`${nodeCmd} --experimental-sea-config sea-config.json`.cwd(outDir).quiet(false);

  const nodePath =
    nodeCmd === "node"
      ? (await $`node -p "process.execPath"`.cwd(outDir).quiet().text()).trim()
      : nodeCmd;
  const exePath = join(outDir, "solid-project-sea.exe");
  await rm(exePath, { force: true });
  await cp(nodePath, exePath);
  await $`signtool remove /s solid-project-sea.exe`.cwd(outDir).quiet(true).nothrow();
  await $`npx postject solid-project-sea.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`
    .cwd(outDir)
    .quiet(false);
}

console.log("✅ SEA executable: standalone/out/solid-project-sea.exe\n");
