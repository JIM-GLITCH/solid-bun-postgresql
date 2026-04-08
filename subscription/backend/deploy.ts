/**
 * 一键部署到阿里云 FC（Web 函数模式）
 *
 * 环境变量仅来自本目录下的 .env（subscription/backend/.env），与仓库根目录 .env 无关。
 * 沙箱：ALIPAY_SANDBOX=true|1|yes 且填齐 ALIPAY_SANDBOX_*；否则走正式 ALIPAY_*。
 * 正式模式下沙箱变量在模板中会被写成空串，FC 控制台可能不显示空环境变量。
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

/** 去掉首尾包裹引号，避免 ALIPAY_SANDBOX="true" 被当成字面量而判不成沙箱 */
function parseEnvLineValue(raw: string): string {
  let v = raw.trim();
  if (v.length >= 2) {
    const q = v[0];
    if ((q === '"' || q === "'") && v[v.length - 1] === q) {
      v = v.slice(1, -1);
    }
  }
  return v;
}

/** 行末的 " 是否为闭合引号（前面有偶数个 \） */
function closesDoubleQuoted(s: string): boolean {
  if (s.length === 0 || s[s.length - 1] !== '"') return false;
  let n = 0;
  for (let j = s.length - 2; j >= 0 && s[j] === "\\"; j--) n++;
  return n % 2 === 0;
}

function closesSingleQuoted(s: string): boolean {
  if (s.length === 0 || s[s.length - 1] !== "'") return false;
  let n = 0;
  for (let j = s.length - 2; j >= 0 && s[j] === "\\"; j--) n++;
  return n % 2 === 0;
}

function unescapeDoubleQuoted(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

/**
 * 解析 .env（支持双引号 / 单引号跨多行，便于粘贴 PEM）。
 * 旧版按行解析会把多行私钥截断成仅第一行，导致 FC 上验签失败 invalid-signature。
 */
function parseDotEnvFile(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const out: Record<string, string> = {};
  let i = 0;
  while (i < lines.length) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i++;
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      i++;
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    const afterEq = trimmed.slice(eq + 1);
    if (!key) {
      i++;
      continue;
    }

    if (afterEq.startsWith('"')) {
      let body = afterEq.slice(1);
      while (!closesDoubleQuoted(body) && i + 1 < lines.length) {
        i++;
        body += "\n" + lines[i];
      }
      if (!closesDoubleQuoted(body)) {
        console.error(`❌ .env 中 ${key} 的双引号字符串未闭合`);
        process.exit(1);
      }
      body = body.slice(0, -1);
      out[key] = unescapeDoubleQuoted(body);
      i++;
      continue;
    }

    if (afterEq.startsWith("'")) {
      let body = afterEq.slice(1);
      while (!closesSingleQuoted(body) && i + 1 < lines.length) {
        i++;
        body += "\n" + lines[i];
      }
      if (!closesSingleQuoted(body)) {
        console.error(`❌ .env 中 ${key} 的单引号字符串未闭合`);
        process.exit(1);
      }
      body = body.slice(0, -1);
      out[key] = body.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
      i++;
      continue;
    }

    out[key] = parseEnvLineValue(afterEq);
    i++;
  }
  return out;
}

const envText = await Bun.file(envFile).text();
Object.assign(envVars, parseDotEnvFile(envText));
console.log("[deploy] 已加载 .env（路径: subscription/backend/.env）");

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

  function getEnv(key: string): string {
    return (envVars[key] ?? process.env[key] ?? "").trim();
  }

  const alipaySandboxRaw = getEnv("ALIPAY_SANDBOX");
  const alipaySandboxMode = ["1", "true", "yes"].includes(alipaySandboxRaw.toLowerCase());

  const REQUIRED_ALWAYS = [
    "DATABASE_URL",
    "JWT_SECRET",
    "GITHUB_CLIENT_ID",
    "GITHUB_CLIENT_SECRET",
    "FRONTEND_URL",
    "API_BASE_URL",
    "ALIPAY_SANDBOX",
    "WECHAT_APP_ID",
    "WECHAT_MCH_ID",
    "WECHAT_PUBLIC_KEY",
    "WECHAT_PRIVATE_KEY",
    "WECHAT_SERIAL_NO",
  ] as const;

  const ALIPAY_PROD = ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"] as const;
  const ALIPAY_SANDBOX_CREDS = [
    "ALIPAY_SANDBOX_APP_ID",
    "ALIPAY_SANDBOX_PRIVATE_KEY",
    "ALIPAY_SANDBOX_PUBLIC_KEY",
  ] as const;

  const missing: string[] = [];
  for (const key of REQUIRED_ALWAYS) {
    if (!getEnv(key)) missing.push(key);
  }
  if (alipaySandboxMode) {
    for (const key of ALIPAY_SANDBOX_CREDS) {
      if (!getEnv(key)) missing.push(key);
    }
  } else {
    for (const key of ALIPAY_PROD) {
      if (!getEnv(key)) missing.push(key);
    }
  }

  const ALIPAY_AES_OPTIONAL = ["ALIPAY_AES_KEY", "ALIPAY_SANDBOX_AES_KEY"] as const;

  const YAML_KEYS = [
    ...REQUIRED_ALWAYS,
    ...ALIPAY_PROD,
    ...ALIPAY_SANDBOX_CREDS,
    ...ALIPAY_AES_OPTIONAL,
  ];

  let yamlFilled = yamlTemplate;
  for (const key of YAML_KEYS) {
    const val = getEnv(key);
    const escaped = val.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    yamlFilled = yamlFilled.replaceAll(`__${key}__`, `"${escaped}"`);
  }

  const mask = (s: string) => (s ? `${s.slice(0, 4)}…(len=${s.length})` : "（空）");
  console.log(
    `\n[deploy] 支付宝：${alipaySandboxMode ? "沙箱" : "正式"} | ALIPAY_SANDBOX=${alipaySandboxRaw || "（未设置）"}`
  );
  if (alipaySandboxMode) {
    console.log(
      `[deploy] 将注入沙箱凭证：APP_ID=${mask(getEnv("ALIPAY_SANDBOX_APP_ID"))} PRIVATE_KEY=${mask(getEnv("ALIPAY_SANDBOX_PRIVATE_KEY"))} PUBLIC_KEY=${mask(getEnv("ALIPAY_SANDBOX_PUBLIC_KEY"))}`
    );
  } else {
    console.log(
      `[deploy] 将注入正式凭证：APP_ID=${mask(getEnv("ALIPAY_APP_ID"))} …；沙箱三套在 .env 为空时 FC 控制台可能不展示这些键`
    );
  }

  if (missing.length > 0) {
    console.error(`\n❌ .env 中缺少以下变量：\n   ${missing.join(", ")}`);
    if (alipaySandboxMode) {
      console.error("   （沙箱模式：需填齐 ALIPAY_SANDBOX_APP_ID、ALIPAY_SANDBOX_PRIVATE_KEY、ALIPAY_SANDBOX_PUBLIC_KEY）");
    } else {
      console.error("   （当前为正式支付宝，需填 ALIPAY_APP_ID 等三套正式变量）");
    }
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
