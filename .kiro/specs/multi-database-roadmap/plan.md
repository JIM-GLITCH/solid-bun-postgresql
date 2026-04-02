# 多数据库支持：分阶段路线图（Phase 1–4）

本文档为**持久计划**：记录从「单库 PostgreSQL 深耦合」到「多方言可扩展」的分阶段目标、验收标准与依赖关系。实现过程中请同步更新各 Phase 的**状态**与**备注**。

---

## 总目标

- 对外 RPC 统一为 **`db/*`**，请求携带 **`dbType`**；会话侧有 **`dbKind`**，与载荷校验一致。
- 每种方言的实现**独立模块**，`api-core` 只做路由与非 DB 横切逻辑。
- 持久化连接支持 **`StoredConnectionParams`（含 dbType）**，旧数据默认视为 `postgres`。
- 前端逐步按**能力矩阵**开关功能，避免写死 PostgreSQL。

---

## Phase 1：架构地基与 PostgreSQL 抽离

**状态：已完成**（截至本文件创建时的代码库）

**目标**

- 中性 **`db/*` API** + 全链路 **`dbType` / `dbKind`**。
- **`connections-store`** 加密存储带 **`dbType`**（缺省与迁移：`postgres`）。
- **`SessionConnection`** 独立类型文件；**PostgreSQL 的 `db/*` 实现**迁至 **`postgres-db-handlers.ts`**，`api-core` 仅按 `method.startsWith("db/")` 分发。
- **`forward()`** 仅用于 PG 模块内递归，避免经 `handleApiRequest` 循环分发。

**验收标准（自检）**

- [x] 无 `postgres/*`、`connect-postgres` 等旧方法名对外暴露（HTTP/Transport 一致）。
- [x] `connections/save`、`connections/get-params`、`connections/connect` 与 `dbType` 一致。
- [x] `backend/postgres-db-handlers.ts` 承载原 `api-core` 中 PG 专有大段逻辑。

**备注**

- README/API 文档若仍写旧路径，可在后续文档迭代中更新（非 Phase 1 阻塞）。

---

## Phase 2：第二方言 MVP（建议 MySQL）

**状态：已完成**（`mysql2` + `connect-mysql.ts` + `mysql-db-handlers.ts` + 会话联合类型 + 前端库类型选择）

**目标**

- 在 **`DbKind`** 中增加第二项（如 `mysql`）。
- 新增 **`mysql-db-handlers.ts`**（或等价命名），实现**最小闭环**：
  - `db/connect` / `db/disconnect`
  - `db/query-readonly`（只读 + LIMIT）
  - 元数据子集：`schemas`、`tables`、`columns`（`information_schema`）；其余 `db/*` 显式抛错
- `api-core` 在 **`db/`** 入口按 **`dbType`（connect）或 `session.dbKind`（已有会话）** 路由到 PG / MySQL 实现。
- 持久化：连接参数沿用 **`PostgresLoginParams` 形状** + **`dbType`**（`connections/save` 按方言默认端口 3306/5432）。

**刻意延后（Phase 2 可不包含）**

- 流式大结果集、`EXPLAIN`、取消查询、PG 特有的 `pg-stat` / 扩展 / 分区等——先 **`capabilities` 标为 false** 或省略对应 UI。

**验收标准**

- [x] 可选 `dbType: "mysql"` 完成建连与至少一条只读查询链路。
- [x] 侧栏可列出 schemas / tables / columns（其它 PG 专有能力点会报错，后续可按 `capabilities` 隐藏）。
- [ ] 单元/集成测试或手工清单：连接失败、错误信息、与协议文档一致。

---

## Phase 3：能力矩阵驱动前端

**状态：未开始**

**目标**

- 统一暴露 **`db/capabilities`**（或会话建立后缓存）字段语义稳定：`streamingQuery`、`cancelQuery`、`explainAnalyzeJson`、`metadataBrowser`、`postgresAdmin` 等；**方言扩展时只增不破坏原含义**。
- 前端 **`getDbCapabilities(connectionId)`**（或等价）在关键面板挂载前读取，**隐藏/禁用**本库不支持项（流式、EXPLAIN、监控、表设计器部分能力等）。
- 连接表单：按 **`dbType`** 切换字段集（端口默认、是否 SSL、是否 catalog 等），与 **`StoredConnectionParams`** 类型对齐。

**验收标准**

- [ ] 无「点进 PG 专属面板再报错」的体验；不支持时为空态或禁用并说明原因。
- [ ] 新增方言时，默认能力为保守 false，避免误开放。

---

## Phase 4：清理、归一与发布

**状态：未开始**

**目标**

- **文档**：README、OpenAPI/路由表、贡献指南中 RPC 与路径与 **`db/*` + `dbType`** 一致。
- **类型**：`shared` 中连接/载荷类型整理为清晰的 **`DbKind` 判别联合**（connect / save / get-params）。
- **兼容策略**：若曾对外承诺旧 URL，保留短期 **301/别名与弃用说明**；无对外承诺则可跳过。
- **技术债**：`as any` 递归转发收窄类型；重复的方言检测逻辑收到单一 **`resolveDbHandler(kind)`**。

**验收标准**

- [ ] 新贡献者单靠本文档 + README 能理解如何加第三种库。
- [ ] 主分支上无已弃用且无说明的 API 面。

---

## 维护约定

| 动作 | 说明 |
|------|------|
| 完成某一 Phase | 将上文对应 **状态** 改为「已完成」，勾选验收项，并补 **完成日期**（可选）。 |
| 范围裁剪 | 在对应 Phase 下增加 **「刻意延后」** 小节，避免默默缩水。 |
| 顺序调整 | Phase 2/3 可部分并行（例如先 capabilities 再 MySQL），但需在 Phase 标题下 **备注依赖**。 |

---

## 修订记录

| 日期 | 变更 |
|------|------|
| （创建日） | 初稿：Phase 1–4 定义与 Phase 1 已完成标记。 |
