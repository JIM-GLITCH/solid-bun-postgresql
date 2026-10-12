/**
 * 架构边界检查（连接层与业务层隔离）。
 *
 * 用法：`node scripts/check-db-boundaries.mjs` —— 非零退出表示边界被破坏。
 * 规则来源：docs/db-connection-effect-refactor.md 第 1 节「边界不变量」。
 *
 * 规则分级：
 *  - **硬禁（会失败）**：业务层 *运行时* import 驱动；访问会话连接句柄字段。
 *  - **已记录例外（仅提示）**：业务层 *类型* import 驱动类型，用于 ctx 签名标注
 *    （Phase 1 后业务已不持有句柄，故仅类型耦合；后续可逐步消除）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BACKEND = join(ROOT, "backend");

/**
 * 业务层文件（连接层是 `backend/db/**` 与 `backend/sqlserver-support.ts`，不在此列）。
 *
 * 说明：`sqlserver-support.ts` 虽是平铺文件，但内容是**连接层 helper**
 * （SHOWPLAN / 分区元数据 / 会话监控 / `sqlServerSessionControl`），
 * 且 `db/connector-mssql.ts` 依赖它——若把它算作业务层会形成反向依赖，故归入连接层。
 */
const BUSINESS_FILES = [
  "api-core.ts",
  "postgres-db-handlers.ts",
  "mysql-db-handlers.ts",
  "sqlserver-db-handlers.ts",
  "column-editable.ts",
  "mysql-column-editable.ts",
];

const DRIVER_MODULES = /["'](pg|pg-cursor|mysql2(?:\/promise)?|mssql|ssh2)["']/;

/**
 * 已记录的业务层运行时驱动依赖（不计失败，但会打出提示）。
 *
 * `sqlserver-db-handlers.ts` 需要 `sql.Transaction` / `sql.Request` 做事务编排与
 * 参数化插入（`db/import-rows`），当前形态下无法零依赖；彻底消除需要把事务编排
 * 下沉到连接层（见设计文档 Phase 3 后续项）。此处如实记录而非隐藏。
 */
const ACKED_RUNTIME_DEPS = [
  { file: "sqlserver-db-handlers.ts", module: "mssql", why: "sql.Transaction / sql.Request（事务与参数化插入）" },
];

/** 业务层不得出现的会话连接句柄访问 */
const FORBIDDEN_SESSION_FIELDS =
  /\bsession\s*\.\s*(userUsedClient|backGroundPool|dbForReconnect|sqlServerRowStream|sqlServerActiveRequest|mysqlRowStream|mysqlRunningThreadId|runningQueryPid|cursor)\b/;

/**
 * 传输层文件：不得依赖会话句柄类型（应使用 `SessionInfo`）。
 * 这是 Phase 3「收窄对外类型」的可执行守护。
 */
const TRANSPORT_FILES = [
  "trpc/context.ts",
  "trpc/router/db.ts",
  "trpc/router/connections.ts",
  "trpc/router/ai.ts",
  "trpc/router/query-history.ts",
  "trpc/router/subscription.ts",
  "trpc/router/host.ts",
  "trpc/index.ts",
  "trpc/init.ts",
  "api-handlers-http.ts",
];

const HANDLE_TYPES = [
  "PostgresSessionConnection",
  "MysqlSessionConnection",
  "SqlServerSessionConnection",
  "Client",
  "Pool",
  "PoolConnection",
  "FieldDef",
  "FieldPacket",
  "Cursor",
  "ConnectionPool",
  "Request",
];

const violations = [];
const exceptions = [];

for (const rel of BUSINESS_FILES) {
  let src;
  try {
    src = readFileSync(join(BACKEND, rel), "utf8");
  } catch {
    continue;
  }
  src.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    const loc = `${rel}:${i + 1}`;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;

    // 1) 驱动 import
    if (DRIVER_MODULES.test(line) && /^\s*import\b/.test(line)) {
      const isTypeOnly = /^\s*import\s+type\b/.test(line) || /^\s*import\s*\{[^}]*\btype\b/.test(line);
      const acked = ACKED_RUNTIME_DEPS.find((a) => a.file === rel);
      if (isTypeOnly) exceptions.push(`${loc} 类型 import 驱动（已记录例外） → ${trimmed}`);
      else if (acked) exceptions.push(`${loc} 运行时 import ${acked.module}（已记录例外：${acked.why}）`);
      else violations.push(`${loc} 业务层不得运行时 import 驱动 → ${trimmed}`);
    }

    // 2) 会话句柄字段访问
    if (FORBIDDEN_SESSION_FIELDS.test(line)) {
      violations.push(`${loc} 业务层不得访问会话连接句柄 → ${trimmed}`);
    }

    // 3) 句柄类型 import
    const m = line.match(/^import\s+(?:type\s+)?\{([^}]*)\}\s+from/);
    if (m && /session-connection/.test(line)) {
      const names = m[1]
        .split(",")
        .map((s) => s.replace(/^type\s+/, "").trim())
        .filter(Boolean);
      const handles = names.filter((n) => HANDLE_TYPES.includes(n));
      if (handles.length) {
        violations.push(`${loc} 业务层不应 import 会话句柄类型：${handles.join(", ")}`);
      }
    }
  });
}

for (const rel of TRANSPORT_FILES) {
  let src;
  try {
    src = readFileSync(join(BACKEND, rel), "utf8");
  } catch {
    continue;
  }
  src.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    if (/\bSessionConnection\b/.test(line) && /\bimport\b/.test(line)) {
      violations.push(`trpc/${rel}:${i + 1} 传输层应使用 SessionInfo，不得 import SessionConnection → ${trimmed}`);
    }
  });
}

if (exceptions.length) {
  console.log(`ℹ️  已记录例外 ${exceptions.length} 处（类型 import，仅签名标注）：`);
  for (const e of exceptions) console.log("   · " + e);
}

if (violations.length === 0) {
  console.log("✅ 连接层边界检查通过：业务层无运行时驱动依赖、无会话句柄访问");
  process.exit(0);
}
console.error(`\n❌ 发现 ${violations.length} 处边界违规：`);
for (const v of violations) console.error("  - " + v);
process.exit(1);
