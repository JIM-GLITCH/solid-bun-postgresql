/**
 * 一键部署到阿里云 FC（Web 函数模式）
 *
 * 用法：
 *   bun run deploy.ts              # 构建 + 部署
 *   bun run deploy.ts --build-only # 只构建
 *   bun run deploy.ts --deploy-only # 只部署
 */

import { $ } from "bun";
import { join } from "path";
import { existsSync } from "fs";

const cwd = import.meta.dir;
const args = process.argv.slice(2);
const buildOnly = args.includes("--build-only");
const deployOnly = args.includes("--deploy-only");

// ─── 加载 .env ────────────────────────────────────────────────────────────────

const envVars: Record<string, string> = {};
const envFile = join(cwd, ".env");
if (!existsSync(envFile)) {
  console.error("❌ 未找到 .env 文件，请先执行: cp .env.example .env 并填写配置");
  process.exit(1);
}

const envText = await Bun.file(envFile).text();
for (const line of envText.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const idx = trimmed.indexOf("=");
  if (idx === -1) continue;
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim();
  if (key) envVars[key] = val;
}
console.log("[deploy] 已加载 .env");

// ─── 构建 ─────────────────────────────────────────────────────────────────────

if (!deployOnly) {
  console.log("\n[deploy] 构建 out/index.js ...");
  await $`bun run build.ts`.cwd(cwd);
  console.log("[deploy] ✅ 构建完成");
}

// ─── 部署 ─────────────────────────────────────────────────────────────────────

if (!buildOnly) {
  const sCheck = await $`s --version`.quiet().nothrow();
  if (sCheck.exitCode !== 0) {
    console.error("\n❌ 未找到 Serverless Devs CLI");
    console.error("   安装: npm i -g @serverless-devs/s");
    console.error("   配置: s config add");
    process.exit(1);
  }

  // 读取 s.yaml 模板，替换占位符
  const yamlTemplate = await Bun.file(join(cwd, "s.yaml")).text();
  const ENV_KEYS = [
    "DATABASE_URL", "JWT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET",
    "FRONTEND_URL", "API_BASE_URL",
    "ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_SANDBOX",
    "WECHAT_APP_ID", "WECHAT_MCH_ID", "WECHAT_PUBLIC_KEY", "WECHAT_PRIVATE_KEY", "WECHAT_SERIAL_NO",
  ];

  let yamlFilled = yamlTemplate;
  const missing: string[] = [];
  for (const key of ENV_KEYS) {
    const val = envVars[key] ?? process.env[key];
    if (!val) {
      missing.push(key);
      continue;
    }
    // 多行值（私钥等）需要 YAML 双引号包裹并转义换行
    const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    yamlFilled = yamlFilled.replaceAll(`__${key}__`, `"${escaped}"`);
  }

  if (missing.length > 0) {
    console.error(`\n❌ .env 中缺少以下变量：\n   ${missing.join(", ")}`);
    process.exit(1);
  }

  // 写入临时 s.deploy.yaml
  const tmpYaml = join(cwd, "s.deploy.yaml");
  await Bun.write(tmpYaml, yamlFilled);

  console.log("\n[deploy] 执行 s deploy ...");
  try {
    await $`s deploy --use-local -y --template s.deploy.yaml`.cwd(cwd);
    console.log("\n[deploy] ✅ 部署完成");
    console.log("[deploy] 在 FC 控制台查看 HTTP 触发器地址，填入 .env 的 API_BASE_URL 和 GitHub OAuth Callback URL");

    // ─── 自动更新 GitHub OAuth App callback URL ───────────────────────────────
    const githubPat = envVars["GITHUB_PAT"] ?? process.env.GITHUB_PAT;
    const githubClientId = envVars["GITHUB_CLIENT_ID"] ?? process.env.GITHUB_CLIENT_ID;
    const apiBaseUrl = envVars["API_BASE_URL"] ?? process.env.API_BASE_URL;

    if (githubPat && githubClientId && apiBaseUrl) {
      const callbackUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/auth/github/callback`;
      console.log(`\n[deploy] 更新 GitHub OAuth callback URL → ${callbackUrl}`);
      const ghRes = await fetch(`https://api.github.com/applications/${githubClientId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${githubPat}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ url: callbackUrl }),
      });
      if (ghRes.ok) {
        console.log("[deploy] ✅ GitHub OAuth callback URL 已更新");
      } else {
        const err = await ghRes.text();
        console.warn(`[deploy] ⚠️  GitHub OAuth 更新失败 (${ghRes.status}): ${err}`);
        console.warn("[deploy]    请手动在 GitHub → Settings → Developer settings → OAuth Apps 更新 callback URL");
      }
    } else {
      console.log("[deploy] ℹ️  未配置 GITHUB_PAT，跳过自动更新 GitHub OAuth callback URL");
    }
  } finally {
    // 清理临时文件（含敏感信息）
    await $`rm -f s.deploy.yaml`.cwd(cwd).nothrow();
  }
}
