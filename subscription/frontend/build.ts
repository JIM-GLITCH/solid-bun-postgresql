/**
 * 构建订阅 Portal：TS → dist/app.js
 */
import { join } from "path";

const outDir = join(import.meta.dir, "dist");

await Bun.build({
  entrypoints: [join(import.meta.dir, "src", "app.ts")],
  outdir: outDir,
  naming: "app.js",
  target: "browser",
  minify: process.env.NODE_ENV === "production",
});

console.log("[subscription/frontend] built → dist/app.js");
