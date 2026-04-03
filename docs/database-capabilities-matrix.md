# 数据库能力矩阵

本文档对照 `**DatabaseCapabilities**`（`shared/src/types.ts` + `defaultDatabaseCapabilities`）、**侧栏 / 查询页入口** 与 **后端 `db/`* 路由** 在各方言上的支持情况。实现随代码演进，以仓库内 `*-db-handlers.ts` 为准。

## 1. `DatabaseCapabilities` 字段（类型层开关）


| 字段                   | 含义                                          | 前端主要消费处                               |
| -------------------- | ------------------------------------------- | ------------------------------------- |
| `dialect`            | 当前 `DbKind`                                 | 缓存回退、展示                               |
| `streamingQuery`     | 流式查询 `db/query-stream`                      | `query-interface.tsx`                 |
| `cancelQuery`        | `db/cancel-query`                           | 查询页「中断」                               |
| `explainAnalyzeJson` | 结构化 EXPLAIN                                 | 解释分析弹窗                                |
| `explainText`        | 文本 EXPLAIN                                  | 解释分析、分区裁剪预览等                          |
| `sessionMonitor`     | `db/session-monitor` / `db/session-control` | 侧栏会话监控                                |
| `pgExtensionCatalog` | PG 扩展目录                                     | 侧栏扩展入口                                |
| `tableDesigner`      | 表设计器                                        | `table-designer-unified.tsx`、侧栏新建/编辑表 |
| `resultCellEdit`     | 结果网格编辑 + `db/save-changes`                  | `query-interface.tsx`                 |
| `visualQueryBuilder` | Visual Query Builder                        | `query-interface.tsx`                 |
| `fakeDataImport`     | 「生成假数据」等依赖 `db/import-rows`                 | `sidebar.tsx`                         |


服务端 `db/capabilities` 返回的对象应与上表字段一致；未命中快照时前端用 `defaultDatabaseCapabilities(方言)` 回填。

## 2. 默认矩阵（`defaultDatabaseCapabilities`）


| 字段                   | PostgreSQL | MySQL / MariaDB | SQL Server |
| -------------------- | ---------- | --------------- | ---------- |
| `streamingQuery`     | ✅          | ✅               | ❌          |
| `cancelQuery`        | ✅          | ✅               | ❌          |
| `explainAnalyzeJson` | ✅          | ✅               | ❌          |
| `explainText`        | ✅          | ✅               | ❌          |
| `sessionMonitor`     | ✅          | ✅               | ❌          |
| `pgExtensionCatalog` | ✅          | ❌               | ❌          |
| `tableDesigner`      | ✅          | ✅               | ✅          |
| `resultCellEdit`     | ✅          | ✅               | ✅          |
| `visualQueryBuilder` | ✅          | ✅               | ✅          |
| `fakeDataImport`     | ✅          | ✅               | ✅          |


## 3. 侧栏上下文菜单 vs 后端（概览）

下列为 **常见** `db/`* 与菜单对应关系；**未列出** 的菜单项可能仅前端拼 SQL 或走 VSCode/本地逻辑。


| 菜单 / 动作        | 主要后端或行为                                                                 | PG  | MySQL 族 | SQL Server | 备注                      |
| -------------- | ----------------------------------------------------------------------- | --- | ------- | ---------- | ----------------------- |
| 生成假数据          | `db/columns`、`db/primary-keys`、`db/unique-constraints`、`db/import-rows` | ✅   | ✅       | ✅          | 入口受 `fakeDataImport` 控制 |
| 新建表 / 编辑表      | 表设计器 + `db/table-ddl` 等                                                 | ✅   | ✅       | ✅          | 受 `tableDesigner` 控制    |
| 查看 DDL         | `db/table-ddl`                                                          | ✅   | ✅       | ✅          |                         |
| 分区结构           | `db/partition-info`、`db/explain-text` 等                                 | ✅   | 视实现     | 视实现        |                         |
| 清空表 / 删表       | `db/execute-ddl` 或专用路由                                                  | 视实现 | 视实现     | 视实现        |                         |
| SELECT / COUNT | 前端 SQL → `db/query-readonly`                                            | ✅   | ✅       | ✅          |                         |
| 备份数据库 / 架构     | 多为 PG / 专用                                                              | 视实现 | 视实现     | 视实现        |                         |
| 会话监控           | `db/session-monitor`                                                    | ✅   | ✅       | ❌          | 受 `sessionMonitor`      |
| 扩展目录           | `db/installed-extensions` 等                                             | ✅   | —       | —          | 受 `pgExtensionCatalog`  |


## 4. `db/import-rows` 方言差异


| 方言         | 事务 / 批次                                     | UPSERT（`conflictColumns` + `onConflict`） |
| ---------- | ------------------------------------------- | ---------------------------------------- |
| PostgreSQL | ✅ `BEGIN` + 批量 `INSERT`                     | ✅ `ON CONFLICT`                          |
| MySQL      | ✅ 事务 + `INSERT IGNORE` / `ON DUPLICATE KEY` | ✅                                        |
| SQL Server | ✅ `sql.Transaction` + 参数化批量 `INSERT`        | ❌ 暂不支持；传入则报错提示                           |


## 5. 新增方言时

1. 在 `DbKind` 与 `ConnectDbRequest` 中增加分支。
2. 在 `defaultDatabaseCapabilities` 中为该 `kind` 返回**完整** `DatabaseCapabilities`（未支持项务必为 `false`）。
3. 实现 `*-db-handlers.ts` 内与本矩阵相关的 `db/`* case。
4. 更新本表与（如适用）`docs/adding-a-database-dialect.md`。

