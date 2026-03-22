/**
 * 部署订阅前端到阿里云 OSS 静态网站
 * 用法：bun run deploy.ts
 *
 * 需要 .env 文件包含：
 *   OSS_REGION=oss-cn-hangzhou
 *   OSS_BUCKET=your-bucket-name
 *   OSS_ACCESS_KEY_ID=xxx
 *   OSS_ACCESS_KEY_SECRET=xxx
 */

import { join, relative } from "path";
import { readdir, readFile, rm } from "fs/promises";

// ─── 加载 .env ────────────────────────────────────────────────────────────────
const envPath = join(import.meta.dir, ".env");
try {
  const envText = await readFile(envPath, "utf-8");
  for (const line of envText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    process.env[key] ??= val;
  }
  console.log("[deploy] 已加载 .env");
} catch {
  console.log("[deploy] 未找到 .env，使用环境变量");
}

const region = process.env.OSS_REGION ?? "";
const bucket = process.env.OSS_BUCKET ?? "";
const accessKeyId = process.env.OSS_ACCESS_KEY_ID ?? "";
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET ?? "";

if (!region || !bucket || !accessKeyId || !accessKeySecret) {
  console.error("[deploy] 缺少 OSS 环境变量：OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET");
  process.exit(1);
}

// ─── 清空 dist ────────────────────────────────────────────────────────────────
const distDir = join(import.meta.dir, "dist");
console.log("[deploy] 清空 dist...");
await rm(distDir, { recursive: true, force: true });

// ─── 先 build ─────────────────────────────────────────────────────────────────
console.log("[deploy] 构建前端...");
const buildResult = Bun.spawnSync(["bun", "run", "build.ts"], {
  cwd: import.meta.dir,
  stdio: ["inherit", "inherit", "inherit"],
});
if (buildResult.exitCode !== 0) {
  console.error("[deploy] 构建失败");
  process.exit(1);
}

// ─── 清空 OSS bucket ─────────────────────────────────────────────────────────
async function ossSign(method: string, contentType: string, ossKey: string, date: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(accessKeySecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const stringToSign = `${method}\n\n${contentType}\n${date}\n/${bucket}/${ossKey}`;
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(stringToSign));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function ossListObjects(): Promise<string[]> {
  const date = new Date().toUTCString();
  const sig = await ossSign("GET", "", "", date);
  const url = `https://${bucket}.${region}.aliyuncs.com/?list-type=2&max-keys=1000`;
  const res = await fetch(url, {
    headers: { Date: date, Authorization: `OSS ${accessKeyId}:${sig}` },
  });
  const text = await res.text();
  const keys: string[] = [];
  for (const m of text.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
  return keys;
}

async function ossDelete(ossKey: string) {
  const date = new Date().toUTCString();
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(accessKeySecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const stringToSign = `DELETE\n\n\n${date}\n/${bucket}/${ossKey}`;
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));
  await fetch(`https://${bucket}.${region}.aliyuncs.com/${ossKey}`, {
    method: "DELETE",
    headers: { Date: date, Authorization: `OSS ${accessKeyId}:${signature}` },
  });
}

console.log("[deploy] 清空 OSS bucket...");
const existingKeys = await ossListObjects();
if (existingKeys.length > 0) {
  for (const key of existingKeys) {
    process.stdout.write(`  ✕ ${key} ... `);
    await ossDelete(key);
    console.log("✓");
  }
}

// ─── 上传到 OSS ───────────────────────────────────────────────────────────────

// MIME 类型映射
const mimeMap: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2": "font/woff2",
  ".woff":  "font/woff",
};

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...await listFiles(full));
    else files.push(full);
  }
  return files;
}

// OSS PutObject（用 fetch + 签名 v1）
async function ossUpload(ossKey: string, filePath: string, contentType: string) {
  const body = await readFile(filePath);
  const date = new Date().toUTCString();
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(accessKeySecret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const stringToSign = `PUT\n\n${contentType}\n${date}\n/${bucket}/${ossKey}`;
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(stringToSign));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  const url = `https://${bucket}.${region}.aliyuncs.com/${ossKey}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Date: date, "Content-Type": contentType, Authorization: `OSS ${accessKeyId}:${signature}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`上传失败 ${ossKey}: ${res.status} ${text}`);
  }
}

const files = await listFiles(distDir);
console.log(`[deploy] 上传 ${files.length} 个文件到 OSS bucket: ${bucket}`);

for (const file of files) {
  const ossKey = relative(distDir, file).replace(/\\/g, "/");
  const ext = "." + file.split(".").pop()!;
  const contentType = mimeMap[ext] ?? "application/octet-stream";
  process.stdout.write(`  → ${ossKey} ... `);
  await ossUpload(ossKey, file, contentType);
  console.log("✓");
}

console.log(`\n[deploy] ✅ 前端已部署到 https://${bucket}.${region}.aliyuncs.com/index.html`);
console.log(`[deploy] 如果开启了 OSS 静态网站托管，访问地址为 bucket 的外网域名`);
