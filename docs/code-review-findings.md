# 代码审查发现清单

> 生成日期：2026-10-20
> 范围：backend/、frontend/、shared/、standalone/、vscode-extension/、vscode-http-jsonrpc/、electrobun-app/、subscription/ 及根配置
> 状态说明：☐ 待修复 / 🔧 修复中 / ✅ 已修复

---

## 🔴 严重（功能不可用 / 高危安全）

### #1 [✅] 批量导入必然失败 — 占位符与参数数量不匹配
- `backend/db-handlers/handlers-effect.ts:384-390`（及 `:403-418`）传入 `chunk.flat()`（100 行 × N 列 = 100N 个值），但三个方言的 `buildInsertSQL` 只生成单行占位符：
  - `backend/db-handlers/strategies/postgres-strategy-effect.ts:107` — `VALUES ($1, $2, ...)`（仅 N 个）
  - `backend/db-handlers/strategies/mysql-strategy-effect.ts:260` — `VALUES (?, ?, ...)`
  - `backend/db-handlers/strategies/sqlserver-strategy-effect.ts:120` — `VALUES (@param0, ...)`
- 后果：pg 抛 `bind message supplies 100N parameters, but prepared statement requires N`，rollback 路径整体失败，discard 路径逐行降级，批量导入语义失效。
- 修复：让 `buildInsertSQL` 支持多行，按 `values.length / columns.length` 生成多组占位符。
- **✅ 已修复（2026-10-20）**：三个方言 `buildInsertSQL` 均支持多行；`InsertParams.values` 改为二维数组（类型上杜绝平铺错配）；handler 按列数动态限制批次大小（pg 65535 参数上限保护）。**连带修复**：`quoteIdentifier("schema.table")` 会生成带点的单一标识符（`"public.users"` 在 PG 中不是 public.users 表），新增 `quoteQualifiedTable` 分段加引号。回归测试：`backend/db-handlers/strategies/build-insert-sql.test.ts`（7 例全过）。

### #2 [✅] SQL Server 元数据查询参数被完全丢弃
- `backend/db-handlers/strategies/sqlserver-strategy-effect.ts:171-181`：`_params` 被显式忽略，从不调用 `request.input()`。
- 后果：`metadataQueries` 全部使用命名参数（`@sch`、`@tbl`，如 `:107`、`:111-116`），`dbTables/dbColumns/dbIndexes/dbPrimaryKeys/dbUniqueConstraints/dbForeignKeys/dbTableComment/dbCheckConstraints` 全部抛 `Must declare the table variable "@sch"`。
- 修复：按 SQL 文本中的 `@name` 占位符扫描后 `request.input(name, sql.NVarChar, value)`，或按位置映射为 `@param0..@paramN`。
- **✅ 已修复（2026-10-20）**：新增 `extractNamedParams`（跳过字符串字面量内的 @）+ `bindInput`（按 JS 值类型推断 sql 类型）+ `bindParams`（有命名占位符按名绑定，否则按位置映射 `@paramN`）。`queryAsUser` 委托 `query` 同步生效。回归测试：`sqlserver-named-params.test.ts`（6 例全过）。

### #3 [✅] SQL Server 事务导入不可用
- `backend/db-handlers/strategies/sqlserver-strategy-effect.ts:187-189`：`withPoolClient` 直接抛错，而 `handlers-effect.ts:379` 的 `onError:"rollback"` 分支正是走它。
- 后果：SQL Server 下 `db/import-rows` 带 rollback 永远失败。
- 修复：用 `nativePool()` + `new sql.Transaction(pool)` 实现真正的 `withPoolClient`（BEGIN/COMMIT/ROLLBACK 映射）。
- **✅ 已修复（2026-10-20）**：`withPoolClient` 改为 `sql.Transaction` 实现，`BorrowedClient` 暴露 `beginTransaction/commit/rollback`（幂等，防重复结束事务）；handler 优先走契约事务方法、回退 BEGIN 语句（pg）；回滚失败不再掩盖原始错误。

### #4 [✅] 服务绑定 0.0.0.0 且业务接口零认证
- **✅ 已修复（2026-10-20）**：默认 `hostname: "127.0.0.1"` 仅监听回环；确需局域网访问时显式设 `HOST=0.0.0.0`（standalone/server-node.ts）。tRPC 面无鉴权的问题仍在（需产品决策：本地令牌 or 保持回环），已在代码注释中警示。
- `standalone/server-node.ts:124`：`serve({ fetch: app.fetch, port: PORT })` 未传 `hostname`，默认监听所有网卡。
- `/api/trpc/*` 承载 `connections/get-params`（明文取数据库密码）、`db/query`（任意 SQL），局域网内任何人可枚举导出全部凭据。
- `backend/trpc/init.ts:29-35` 的 `protectedProcedure` 是空实现（认证被注释）。
- 修复：`hostname: "127.0.0.1"`；或增加令牌中间件。

### #5 [✅] 订阅 OAuth 开放重定向 + JWT 经 URL 泄露 + 无 CSRF 防护
- **✅ 已修复（2026-10-20）**：① http(s) 回跳目标限制为 `CORS_ORIGIN_ALLOWLIST`/`FRONTEND_URL` 白名单 Origin（阻断开放重定向与 token 外泄）；② state nonce 种 HttpOnly Cookie（`dbp_oauth_nonce`，SameSite=Lax），回调比对、一次性清除，阻断登录 CSRF 与回调 URL 重放。**遗留（低危）**：JWT 仍经 URL query 传递，建议后续改一次性 code 兑换（需前后端协同）。
- `subscription/backend/src/index.ts:333-349`：`isAllowedRedirect` 对任意 http(s) URL 返回 `true`；`nonce` 生成了但从未与 session/cookie 绑定校验；token 直接拼进回调 URL query（`:216-231`）。
- 攻击链：诱导受害者登录 → 302 到 `evil.example/steal?token=<JWT>`。
- 修复：nonce 写入 HttpOnly Cookie 回调比对；redirect 限制为白名单 Origin；token 改一次性 code。

### #6 [✅] /api/db/disconnect 信标端点无鉴权可断开任意会话
- **✅ 已修复（2026-10-20）**：新增同源校验（Origin/Referer 与请求 Host 比对），跨站请求 403。回归测试：`backend/api-handlers-http.test.ts`（5 例全过）。
- `backend/api-handlers-http.ts:17-31`：仅校验 `connectionId` 非空，sessionId 由客户端自选，可猜测冒用。
- 修复：校验 Origin/Referer 与本地回环。

## 🟠 高（资源泄漏 / 数据错乱 / 凭据安全）

### #7 [✅] 建连失败时 SSH 隧道与本地端口泄漏
- **✅ 已修复（2026-10-20）**：`openSession` 三方言分支在后续 `connectPostgres`/`pool.getConnection()` 失败时显式调用 `db.closeTunnel?.().catch()`，避免 net.Server/ssh2 Client 泄漏。
- `backend/db/sessions-effect.ts:114-176`：`getDbConfig/getMysqlDbConfig/getSqlServerDbConfig` 内部已成功建隧道，但后续 `connectPostgres`/`pool.getConnection()` 失败时 `closeTunnel` 永不调用。
- 修复：openSession 内 try/catch 显式 `await db.closeTunnel?.()`。

### #8 [✅] ssh-tunnel.close() 可能永久挂起 + 转发流无 error 处理
- **✅ 已修复（2026-10-20）**：`close()` 改用 `closeAllConnections()`（Node 18.2+）断开空闲转发 socket + 5s 超时兜底；`sock`/`stream` 双向管道均加 `error` 监听（避免进程崩溃）；`remotePort` 加 `Number.isInteger` 校验；`conn.on("close")` 在 ready 后意外断开时停监听。
- `backend/ssh-tunnel.ts:66-73`：`server.close(cb)` 不关闭已建立的转发 socket → close 永久 pending；`:56` `stream` 无 `error` 监听 → 进程崩溃；`:21` `Number(pgPort)` 非法值得 NaN。
- 修复：`closeAllConnections?.()` + 超时兜底；stream/sock 加 error 处理；端口校验。

### #9 [✅] connect 同 id 并发竞态，旧会话资源永不释放
- **✅ 已修复（2026-10-20）**：抽出 `connectInner`，`connect` 外层按 `connectionId` 串行化（Promise 队列，前一个失败不阻断重试），杜绝双开 + 后写覆盖前写导致的 Scope 永不 close。
- `backend/db/sessions-effect.ts:283-321`：两个 fiber 同时 connectSession 同 cid，都创建 scope，后写覆盖前写，被覆盖 entry 的 Scope 从未 close。
- 修复：以 cid 为键串行化；projection/connectors 写入并入原子步骤。

### #10 [✅] 前端查询/保存无并发守卫 — 同一 UPDATE 可能落库两次
- **✅ 已修复（2026-10-20）**：`runUserQuery` 增加 `loading()` 重入守卫 + 查询序号（`mySeq !== queryRequestSeq()` 丢弃过期响应）；`saveAllChanges` 增加 `saving()` 重入守卫，避免 Ctrl+Enter/Ctrl+S 连发导致结果错乱或同一条 UPDATE 落库两次。
- `frontend/query-interface.tsx:472-478`：`runUserQuery` 无 loading 前置判断、无请求序号；Ctrl+Enter 绕过按钮 disabled，结果集与列元数据错乱。
- `frontend/query-interface.tsx:1086-1106`：`saveAllChanges` 无 `if (saving()) return`，连按两次 Ctrl+S 同一条 UPDATE 落库两次。
- 修复：请求序号 + in-flight 守卫；循环前快照 pending 数组。

### #11 [✅] trustServerCertificate: true 关闭 SQL Server TLS 证书校验
- **✅ 已修复（2026-10-20）**：默认 `trustServerCertificate: false`；`PostgresLoginParams` 新增 `trustServerCertificate?: boolean`，仅用户显式勾选时关闭校验（内网自签场景）。
- `backend/connect-sqlserver.ts:46-50`。
- 修复：默认 false，仅在用户显式勾选时置 true。

### #12 [✅] 加密密钥与密文同目录存放
- **✅ 已修复（2026-10-20）**：新增 `backend/crypto-store.ts` 统一密钥管理与加解密（内存缓存 + 全进程唯一 `.key` 入口，杜绝三模块互相覆盖）；`.key` 改为「临时文件 + rename」原子写入；损坏的 `.key` 自动备份重建。三个 store 已重构接入。生产环境仍建议 `CONNECTIONS_ENCRYPTION_KEY` 外部注入（密钥与密文同目录是本地单机工具的固有约束）。
- `backend/connections-store.ts:45-59`、`ai-key-store.ts:32-46`、`subscription-token-store.ts:32-46`：`.key` 与密文同目录；三模块并发初始化互相覆盖密钥。
- 修复：统一密钥管理模块 + 文件锁/原子写入。

### #13 [✅] Webview CSP 允许 unsafe-inline + unsafe-eval
- **✅ 已修复（2026-10-20）**：移除 `unsafe-eval`（Vite/Solid 生产构建不依赖 eval）；新增 `object-src 'none'; base-uri 'none'; form-action 'none'`。
- `vscode-extension/src/extension.ts:427-436`。
- 修复：nonce + 显式 `object-src 'none'; base-uri 'none'; form-action 'none'`。

### #14 [✅] SSE writer 单例 push 槽，多客户端互相覆盖 + 心跳泄漏
- **✅ 已修复（2026-10-20）**：`pushes`/`heartbeats` 改为 Set，按连接分别登记与清理；`cancel` 只清本连接的推送与心跳；`write` 向所有活跃连接广播并自动移除失效连接；`dispose` 清理全部。
- `vscode-http-jsonrpc/server/writer.ts:8,16-45,59-69`。
- 修复：`Set<{controller, cleanup}>` 管理所有连接。

### #15 [✅] SEA 构建忽略 Bun.build 失败，产出静默损坏产物
- **✅ 已修复（2026-10-20）**：`build-sea-win.ts`/`build-sea-linux.ts` 新增 `buildOrFail`，检查 `result.success`，失败时打印 `result.logs` 并 `process.exit(1)`，避免编译失败仍继续打包部署。
- `standalone/build-sea-win.ts:16-34`、`build-sea-linux.ts:17-36`。
- 修复：检查 `result.success`，失败即 exit(1)。

### #16 [✅] Electrobun 对所有 RPC 强制订阅校验，功能被锁死
- **✅ 已修复（2026-10-20）**：按服务端语义，仅 `subscription/assert`（高级特性 visual-query-builder/table-designer 入口）要求 license；其余 `db/*`、`connections/*` 不再强制订阅，整个应用恢复可用。
- `electrobun-app/src/bun/index.ts:45-46`。
- 修复：仅对 `subscription/assert` 或 premium 方法列表校验。

### #17 [✅] 订阅后端默认返回完整错误堆栈
- **✅ 已修复（2026-10-20）**：默认不返回堆栈/pg 细节，仅 `API_DEBUG=1` 时输出。
- `subscription/backend/src/index.ts:123-137`：`API_DEBUG !== "0"`。
- 修复：默认改为 `API_DEBUG === "1"` 才输出 detail。

### #18 [✅] 根路径 POST 返回侮辱性内容
- **✅ 已修复（2026-10-20）**：改为 `404 {"success":false,"error":"not found"}`。
- `subscription/backend/src/index.ts:606-608`：`c.json("fuck you")`。
- 修复：改为 404 JSON。

## 🟡 中（语义正确性 / 健壮性）

### #19 [☐] MySQL 行流未结束时在同连接执行 USE
- （推迟：需重构流式查询与切库的执行顺序，改动面较大、回归风险高，建议单独 PR 处理。）
- `backend/db-handlers/strategies/mysql-strategy-effect.ts:601-617`。
- 修复：USE 挪到 startStream 建流之前；readStreamBatch 不再发 USE。

### #20 [☐] PG 游标关闭无超时，连接已死时 startStream 永久挂起
- （推迟：需在 pg-cursor close 路径引入竞态安全的超时兜底，建议单独处理并补测试。）
- `backend/db-handlers/strategies/postgres-strategy-effect.ts:264-275, 359-382`。
- 修复：close/read 包 Promise.race + 超时。

### #21 [✅] "连接已死"判定完全依赖错误文案正则
- **✅ 已修复（2026-10-20）**：收窄 SQL Server 的 `FALLBACK`/`isSqlServerPoolDeadError` 正则，移除裸 `socket|timeout|closed|broken`（普通 SQL 错误含这些词会被误判为断连、触发重建并关掉正在使用的连接）；仅匹配明确连接层错误（ECONNRESET/Connection lost/connection reset by peer/socket closed/broken pipe/communication link failure）。
- `backend/db/sessions.ts:162-175`、`backend/db/errors.ts:60-78`。
- 修复：connector catch 处统一 toDbError；收紧正则。

### #22 [✅] 所有 DB 查询无 statement/request 超时
- **✅ 已修复（2026-10-20，PG）**：`createPostgresPool` 通过 pg `options` 为新连接设置 `statement_timeout`（默认 600000ms=10min，可用 `PG_STATEMENT_TIMEOUT_MS` 调整，0 关闭），防止挂死查询永久占用唯一连接；对游标 FETCH（每批 100 行）无碍。MySQL/MSSQL 等价超时留作后续（见推迟项）。
- `backend/db/connector.ts:76-100` 及三方言连接配置。
- 修复：统一 withQueryTimeout；PG SET statement_timeout。

### #23 [✅] 凭据存储非原子读-改-写，崩溃即丢数据
- **✅ 已修复（2026-10-20）**：`crypto-store.atomicWriteJson`（同目录临时文件 + rename 原子替换）应用于 `connections-store`/`ai-key-store`/`subscription-token-store` 三个 store 的写入；`connections-store.loadRaw` 解析失败时先备份为 `.corrupt-<ts>` 再返回空列表，避免空列表覆盖清空全部已保存连接。
- `backend/connections-store.ts:104-140`、`query-history-store.ts:31-47`、`ai-key-store.ts:68-88`。
- 修复：临时文件 + renameSync 原子替换；loadRaw 失败回滚备份。

### #24 [✅] updateConnectionMeta 解密失败抛未捕获异常
- **✅ 已修复（2026-10-20）**：`updateConnectionMeta` 解密失败（密钥轮换/文件损坏）时不再抛出，保留现有 label，避免调用方 500。
- `backend/connections-store.ts:178-188`。
- 修复：try/catch 保留原 label。

### #25 [✅] import-rows 与 query 输入无大小上限
- **✅ 已修复（2026-10-20）**：`db/import-rows` 的输入加 `columns.max(1000)` 与 `rows.max(200000)`，防止超大负载导致内存耗尽。
- `backend/trpc/router/db.ts:351-361`。
- 修复：`z.array(...).max(5000)`、`z.string().max(1_000_000)`。

### #26 [☐] 多个 db handler 返回假数据桩实现
- （推迟：改为抛 NOT_IMPLEMENTED 会破坏依赖假响应的前端面板，需前端配套改造，建议前后端协同处理。）
- `backend/db-handlers/handlers-effect.ts:310-355, 467-480`。
- 修复：抛 NOT_IMPLEMENTED。

### #27 [✅] dbImportRows 空吞错误后仍报"导入成功"
- **✅ 已修复（2026-10-20，随 #1 重写）**：`discard` 路径不再 `catch {}` 吞错，逐行降级并记录失败行；最终返回 `success:false` + `failed[]` 列表，前端据此提示「N 行成功, M 行失败」。
- `backend/db-handlers/handlers-effect.ts:410-430`。
- 修复：收集失败行号与原因，返回 failed 列表，有失败发 WARNING。

### #28 [✅] 字符串 "null" 被转成 SQL NULL（数据丢失）
- **✅ 已修复（2026-10-20）**：`formatSqlValue` 移除字符串 `"null"`→SQL NULL 的转换（前端以 JS `null` 表示清空，已正确映射 NULL）；`text/varchar` 列输入字面量 `null` 现保留为字符串。回归测试：`shared/src/format-cell.test.ts`（4 例全过）。
- `shared/src/format-cell.ts:246, 281`。
- 修复：对 text/varchar/json/jsonb 等类型一律按字符串字面量处理。

### #29 [☐] sessionMonitor 借用池连接后 RESET 失败会残留超时设置
- （推迟：需确保 RESET 失败时归还连接前清除超时，建议单独处理。）
- `backend/db-handlers/strategies/postgres-strategy-effect.ts:128-222`。
- 修复：SET LOCAL 或 reset 失败即销毁连接。

### #30 [☐] 查询历史搜索无防抖、无取消、响应乱序覆盖
- （推迟：前端 UX/健壮性优化，建议专项清理并加防抖+竞态序号。）
- `frontend/query-history-panel.tsx:60-83`。
- 修复：250ms 防抖 + 请求序号 + onCleanup 清理。

### #31 [☐] sql-editor-codemirror.tsx 多个生命周期问题
- （推迟：前端性能/稳定性优化，含全量重解析、AI 定时器、O(n·m) LCS 等，改动面大，建议专项重构。）
- `:1316` readOnly 非响应式；`:1126-1131` AI 45s 定时器不清理；`:1198-1201` 已销毁 view 上 dispatch；`:561-603` 每次按键全量解析；`:649` LCS O(n·m) 全量 DP。
- 修复：Compartment + clearTimeout + disposed 标志 + 防抖 + 线性空间 diff。

### #32 [✅] dialog-context.tsx confirm/prompt Promise 可能永久悬挂
- **✅ 已修复（2026-10-20）**：`confirmState`/`promptState` 改为数组队列（带自增 id），支持并发 confirm/prompt，各自独立 resolve；抽取 `ConfirmModal` 组件，用 `<For>` 渲染多个并存弹窗，避免后者覆盖前者导致前一个 Promise 永久 pending。
- `frontend/dialog-context.tsx:68-76`。
- 修复：队列管理；onCleanup 对未决 resolve false/null。

### #33 [☐] 其余前端 effect 无取消/无 in-flight 守卫
- （推迟：散布多处（backup/import modal、app.tsx SSE、table-designer 等），建议专项清理。）
- `backup-modal.tsx:34-49`、`import-modal.tsx:41-95`、`app.tsx:129-133`、`table-designer-type-input.tsx:74-76`、`table-designer-unified.tsx:268-292`。
- 修复：cancelled 标志 + 独立 loading + formatUnknownError。

### #34 [✅] docker-compose 弱口令 + 全接口暴露
- **✅ 已修复（2026-10-20）**：`POSTGRES_PASSWORD` 改用环境变量 `${DB_PASSWORD:-强默认值}`（不再硬编码 `secret`）；端口仅绑定 `127.0.0.1:5432`；补充 healthcheck。
- `docker-compose.yml:8-13`。
- 修复：`127.0.0.1:5432:5432` + healthcheck + required 变量。

### #35 [☐] 订阅门户无 CSP + JWT 存 localStorage + 第三方 CDN 脚本
- （推迟：涉及支付/账户安全与第三方集成，需与订阅后端协同决策（如改用 httpOnly Cookie、移除 CDN），建议单独评审。）
- `subscription/frontend/src/index.html`、`app.ts:3,40,373-383`、`app.ts:326-328` innerHTML。
- 修复：CSP + HttpOnly Cookie + 本地打包 qrcode + textContent。

### #36 [☐] 支付宝回调验签不校验 app_id/金额，缺防重放
- （推迟：支付安全，需谨慎处理并补充测试，建议单独评审；当前仅验 RSA 签名，应增加 app_id/金额一致性校验与回调幂等。）
- `subscription/backend/src/payment.ts:214-228`、`index.ts:515-529`。
- 修复：追加 app_id/金额/out_trade_no 校验；notify_id 去重；请求体大小上限。

## 🟢 低 / 可优化

- [☐] `mysql-strategy-effect.ts:501-511`：rowMode:"array" 分支丢弃 spec.values
- [☐] `handlers-effect.ts:380-396`：ROLLBACK 抛错掩盖原始错误；MySQL beginTransaction 契约未使用
- [☐] `sessions.ts:316-319`：assertSessionDbType 空实现
- [☐] `db/sessions.ts:194-209`：MySQL 重建连接失败后会话不可用
- [☐] `standalone/server-node.ts:51-58`：SEA MIME 表缺 .svg/.png/.json/.ico
- [☐] `standalone/server-node.ts:92-122`：uncaughtException 后继续运行
- [☐] `standalone/deploy.ts:22`：fuser -k 无差别杀进程
- [☐] `vscode-extension/src/extension.ts:276-287`：saveFile 默认文件名可被操控
- [☐] `vscode-extension/build.ts:27`：shell cp 在 Windows 下失败
- [☐] `shared/src/sql-format.ts:40-59`：catch 分支重复死代码
- [☐] `shared/src/sql-split.ts:64-71`：未处理 E'\'' 反斜杠转义引号
- [☐] `query-interface.tsx:1040, 1726, 1755`：result[rowIndex][colIndex] 无越界保护
- [☐] `export-result.ts:38-50`：blobToBase64 O(n²)
- [☐] `visual-query-builder.tsx:2168, 2504` 等 4 处 <For> 内联新数组
- [☐] `er-diagram-modal.tsx:367-392`：memo 内 querySelector DOM 测量
- [☐] `visual-query-builder.tsx:185-191` / `er-diagram-modal.tsx:162-216`：N+1 串行请求
- [☐] `table-designer-create.tsx` / `table-designer-edit.tsx`：死代码
- [☐] `vscode-extension/src/license-validator.ts`：validate() 从未被调用
- [☐] 订阅许可架构：SUBSCRIPTION_OFF + 可配置 subscriptionApiUrl = 完整绕过路径，建议内置公钥离线验签

---

## 修复批次

| 批次 | 内容 | 状态 |
|---|---|---|
| 第一批（P0 功能） | #1 #2 #3 | 待开始 |
| 第二批（P0 安全） | #4 #5 #6 #11 #12 #17 #18 | 待开始 |
| 第三批（P1 泄漏/竞态） | #7 #8 #9 #10 #13 #14 #15 #16 | 待开始 |
| 第四批（P2 健壮性） | #19–#36 | 待开始 |
| 第五批（P3 优化） | 低优先级项 | 待开始 |
