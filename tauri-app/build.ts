/**
 * 构建 Tauri sidecar：将 backend 打包成 stdio 二进制
 * 输出到 src-tauri/binaries/server-stdio-<target-triple>.exe
 * 入口仍在 standalone/server-stdio.ts（standalone 仅负责 standalone 构建，此处仅负责产出 sidecar 二进制）
 */

import { join } from "path";
import { mkdir, copyFile } from "fs/promises";
import { SolidPlugin } from "bun-plugin-solid";

const tauriAppDir = import.meta.dir;
const distDir = join(tauriAppDir, "dist");

await mkdir(distDir, { recursive: true });

// 构建前端到 dist/
await Bun.build({
    entrypoints: [join(tauriAppDir, "../frontend", "index-tauri.tsx")],
    outdir: distDir,
    target: "browser",
    plugins: [SolidPlugin()],
});

// 复制 index.html 到 dist（引用 ./index-tauri.js）
await copyFile(join(tauriAppDir, "index.html"), join(distDir, "index.html"));

console.log("1. frontend built successfully\n");

// 构建 sidecar 的 server-stdio 二进制
const standaloneDir = join(tauriAppDir, "..", "standalone");
const binariesDir = join(tauriAppDir, "src-tauri", "binaries");

const targetTriple =
    process.env.TAURI_ENV_ARCH === "aarch64"
        ? "aarch64-pc-windows-msvc"
        : "x86_64-pc-windows-msvc";
const ext = process.platform === "win32" ? ".exe" : "";
const outName = `server-stdio-${targetTriple}${ext}`;

await mkdir(binariesDir, { recursive: true });

await Bun.build({
    entrypoints: [join(standaloneDir, "server-stdio.ts")],
    outdir: binariesDir,
    target: "bun",
    compile: {
        target: process.platform === "win32" ? "bun-windows-x64" : "bun-linux-x64",
        outfile: outName,
    },
});

console.log("2. stdio binary built successfully\n");
