# 如何新增一种数据库方言

面向维护者：在已有 **PostgreSQL / MySQL** 之外增加第三种 `DbKind` 时的推荐顺序（与 `.kiro/specs/multi-database-roadmap/plan.md` 一致）。

## 1. 类型与能力矩阵

1. 在 **`shared/src/types.ts`** 的 **`DbKind`** 中增加字面量（如 `"sqlite"`）。
2. 将 **`ConnectDbRequest`** 的联合类型**增加一支**（与 `db/connect` 载荷形状一致；若新库登录字段不同，在此支上收窄字段）。
3. 在 **`shared/src/database-capabilities.ts`** 的 **`defaultDatabaseCapabilities`** 中为该 `kind` 返回完整 **`DatabaseCapabilities`**（未支持的能力务必为 `false`，避免 UI 误开）。字段与侧栏/API 对照见 **[database-capabilities-matrix.md](./database-capabilities-matrix.md)**。
4. 若 Transport 有 **`db/*` 新方法**，同步 **`shared/src/transport.ts`** 的 **`ApiMethod`** 与 **`ApiRequestPayload`**。

## 2. 后端会话与路由

1. 扩展 **`backend/session-connection.ts`**：`SessionConnection` 联合或公共字段，承载新驱动所需的池/客户端状态。
2. 新增 **`connect-<dialect>.ts`**（参考 `connect-postgres.ts`、`connect-mysql.ts`）负责建连、池配置、可选 SSH。
3. 新增 **`<dialect>-db-handlers.ts`**，实现 **`handleXxxDbRequest(method, payload, ctx)`**：对 `switch (method)` 覆盖本库支持的 `db/*`，其余 **`default` 抛「不支持」**（与 `mysql-db-handlers` MVP 策略一致）。
4. 在 **`backend/api-core.ts`**：
   - 扩展方言判断（当前为 **`shouldRouteDbRequestToMysql`**；增库时可改为 **`resolveDbHandlerKind(method, payload)`** 等多路分支），使 `db/*` 落到正确处理器；
   - **`db/connect`** 中按 `dbType` 建连并写入 **`connectionMap`**；
   - **`connections/save`** 若需新库默认端口，在 **`ConnectionSavePayload`** 分支里补充。

## 3. 前端

1. **`frontend/db-session-meta.ts`**：若需刷新后恢复方言，扩展 `sessionStorage` 白名单。
2. **`frontend/connection-form.tsx`**（或等价表单）：按 **`dbType`** 切换说明、占位与端口默认。
3. 侧栏、查询页等：已通过 **`getEffectiveDbCapabilities`** / **`sessionMonitor`** 等开关；新库默认矩阵应使不支持的菜单自动隐藏。
4. **`prefetchDbCapabilities`** 已在建连后拉取；无需改，除非新库 `db/capabilities` 有特殊逻辑。

## 4. HTTP 与扩展

1. 若新方法需 **HTTP**，在 **`backend/api-handlers-http.ts`** 的 **`POST_ROUTES`** 中增加 **`path` ↔ `method`**（路径通常为 `/api/${rpcMethod}`）。
2. VSCode：**`api-handlers-vscode`** 透传同一 **`ApiMethod`** 即可。

## 5. 自检清单

- [ ] `bun test` 中与方言相关的单测通过或已补充。
- [ ] `defaultDatabaseCapabilities("<新kind>")` 与 **`db/capabilities`** 返回值一致（若后端覆盖默认值）。
- [ ] README / 路线图 Phase 备注已更新（若对外行为有变）。
