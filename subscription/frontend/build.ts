/**
 * 构建订阅 Portal：TS → dist/app.js
 */
import { join } from "path";

const outDir = join(import.meta.dir, "dist");

await Bun.build({
  entrypoints: [join(import.meta.dir, "src", "index.html")],
  outdir: outDir,
  minify: process.env.NODE_ENV === "production",
  target: "browser",
});

console.log("[subscription/frontend] built → dist/index.html");
