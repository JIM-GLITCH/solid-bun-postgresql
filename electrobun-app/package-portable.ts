/**
 * 打包便携版：将 build 中的应用目录打成 zip，解压即用
 * 先执行 bun run electrobun:package:stable，再执行此脚本
 */
import { join } from "path";
import { existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";

const root = import.meta.dir;
const projectRoot = join(root, "..");
const buildDir = join(projectRoot, "build", "stable-win-x64");
const appDir = join(buildDir, "FrontTable");
const artifactsDir = join(projectRoot, "artifacts");
const portableZip = join(artifactsDir, "FrontTable-portable.zip");

if (!existsSync(appDir)) {
  console.error("未找到构建产物，请先执行: bun run electrobun:package:stable");
  process.exit(1);
}

mkdirSync(artifactsDir, { recursive: true });

// 用 PowerShell 打 zip，保留 FrontTable 目录结构
const appDirEscaped = appDir.replace(/'/g, "''");
const zipEscaped = portableZip.replace(/'/g, "''");
execSync(
  `powershell -Command "Compress-Archive -Path '${appDirEscaped}' -DestinationPath '${zipEscaped}' -Force"`,
  { stdio: "inherit" }
);

console.log(`\n便携版已生成: ${portableZip}`);
console.log("解压后运行 FrontTable\\bin\\launcher.exe 即可启动");
