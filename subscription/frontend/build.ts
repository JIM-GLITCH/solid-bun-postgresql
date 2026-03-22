/**
 * 构建订阅 Portal：TS → dist/app.js
 * 环境变量 API_URL 会在编译时替换进代码
 */
import { join } from "path";
import { readFile } from "fs/promises";

// 加载 .env
try {
  const envText = await readFile(join(import.meta.dir, ".env"), "utf-8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= val;
  }
} catch {}

const apiUrl = process.env.API_URL ?? "";
const outDir = join(import.meta.dir, "dist");

await Bun.build({
  entrypoints: [join(import.meta.dir, "src", "index.html")],
  outdir: outDir,
  minify: process.env.NODE_ENV === "production",
  target: "browser",
  define: {
    __API_URL__: JSON.stringify(apiUrl),
  },
});

console.log(`[subscription/frontend] built → dist/index.html (API_URL=${apiUrl || "(localhost)"})`);
