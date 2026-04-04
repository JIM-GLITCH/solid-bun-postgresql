# 按数据库需适配的功能清单

本文档列举：**每个数据库方言**在接入或维护时，需要在前端显式分支、或通过后端能力与 RPC 对齐的功能点。与 `shared/src/transport.ts` 中的 `DatabaseCapabilities`、`db/*` 路由及三库 handler 对应。

---

## 一、前端有直接方言分支的

每种库都要覆盖或归入某一族（如 MariaDB 与 MySQL 共用 `isMysqlFamily`）。


| 功能                | 主要文件与适配点                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **连接表单**          | `frontend/connection-form.tsx`：端口默认、`dbType`、MySQL/MariaDB 库名说明、SQL Server 专用字段、PostgreSQL 说明、各方言 `connectionFieldRows`     |
| **侧栏**            | `frontend/sidebar.tsx`：`SELECT *` 与 `LIMIT` / `TOP`、MySQL 默认 schema 行为、对象树与上下文菜单；含 **查看 ER 图**（连接 / schema 右键）入口 |
| **新建 Schema/库**   | `frontend/create-schema-modal.tsx`：标题与 DDL（MySQL `CREATE DATABASE`、SQL Server `CREATE SCHEMA`、PostgreSQL `CREATE SCHEMA` 等） |
| **复制表**           | `frontend/copy-table-modal.tsx`：`CREATE TABLE ... LIKE`、`SELECT INTO`、`LIKE ... INCLUDING ALL` 等方言差异                        |
| **重命名表**          | `frontend/rename-table-modal.tsx`：`RENAME TABLE`、`sp_rename`、PostgreSQL `ALTER ... RENAME`                                  |
| **删 Schema**      | `frontend/delete-schema-modal.tsx`：各方言 DDL                                                                                  |
| **删表 / TRUNCATE** | `frontend/delete-table-modal.tsx`、`frontend/truncate-table-modal.tsx`：引用与语句形式                                               |
| **表设计器**          | `frontend/table-designer-shared.ts` 及 unified/create/edit：标识符引用、类型映射、默认值、自增、外键动作、唯一索引等（`postgres` / `mysql` / `sqlserver`）  |
| **可视化查询**         | `frontend/visual-query-builder.tsx`：表名限定、`JOIN` 语法、`TOP`/`LIMIT`、`DbKind`                                                   |
| **查询结果表格编辑**      | `frontend/query-interface.tsx`：生成 DML 使用 `shared` 中 `formatSqlValue`、`formatWhereCondition`，依赖 `ColumnEditableInfo.sqlDialect`；**具体操作见下文「结果表格编辑」** |
| **API 层**         | `frontend/api.ts`：`dbConn()` 携带 `dbType`，连接登记对应方言                                                                           |


---

## 二、主要靠后端 + `DatabaseCapabilities`（前端共用 UI，新库仍须逐条接线）


| 能力 / 功能         | 说明                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------- |
| **流式查询**        | `streamingQuery` → `db/query-stream`、`db/query-stream-more`                                                |
| **取消查询**        | `cancelQuery` → `db/cancel-query`                                                                          |
| **EXPLAIN**     | `explainAnalyzeJson` / `explainText` → `db/explain`；计划展示对 MySQL JSON 等可能有专门分支（如 `explain-plan-viewer.tsx`） |
| **会话监控 / Kill** | `sessionMonitor` → `db/session-monitor`、`db/session-control`                                               |
| **表设计器入口**      | `tableDesigner` + `db/data-types`、`db/execute-ddl` 及各类元数据 RPC                                              |
| **结果网格编辑**      | `resultCellEdit` + `db/save-changes` + 查询元数据中的 `ColumnEditableInfo[]`；**交互与 DML 生成见下文「结果表格编辑」** |
| **可视化查询入口**     | `visualQueryBuilder` + `db/schemas`、`db/tables`、`db/foreign-keys` 等                                        |
| **查看 ER 图**      | `frontend/er-diagram-modal.tsx`、`er-diagram-picker-modal.tsx`（侧栏打开）；依赖 `db/tables`、`db/columns`、`db/foreign-keys`、`db/primary-keys`。画布中类型显示简写（`simplifyTypeForDisplay`）以 PostgreSQL 常见类型名为准，其它方言可增补映射 |
| **假数据 / 批量导入**  | `fakeDataImport` + `db/import-rows`                                                                        |
| **PG 扩展目录**     | `pgExtensionCatalog` → `db/installed-extensions`（通常仅 PostgreSQL 为 true）                                    |
| **分区结构 / 裁剪预览** | `partitionStructureInspect` → 侧栏入口；依赖 `db/partition-info` 与文本 EXPLAIN（各方言未实现对应 RPC 时应为 false） |


### 结果表格编辑（`frontend/query-interface.tsx`）

新方言需保证：**流式/查询结果里带上正确的 `ColumnEditableInfo`**，且 `db/save-changes` 能执行生成的单条 DML。

**后端 / 类型（`shared/src/types.ts` 等）**

- **`ColumnEditableInfo`**：`isEditable`；`tableName` / `columnName`（限定名，用于拼 SQL）；`uniqueKeyColumns` / `uniqueKeyFieldIndices`（生成 `UPDATE`/`DELETE` 的 `WHERE`）；`sqlDialect`（`postgres` | `mysql` | `sqlserver`）；`dataTypeOid` / `dataTypeLabel`（字面量格式化与展示）；`omitFromInsert`（如 identity、computed，生成 `INSERT` 时省略列）；`nullable` 等。
- 各库在 **`column-editable.ts` / `mysql-column-editable.ts` / SQL Server 列元数据路径** 等处填充上述字段；与 **PostgreSQL** 差异最大在 OID 与系统目录来源。

**`db/save-changes`**

- 前端按顺序多次调用：先全部 **UPDATE**，再按行号**倒序 DELETE**，再按行号**正序 INSERT**；失败则报错，已执行的语句不会自动回滚（由用户重试）。

**用户可见操作**

| 操作 | 说明 |
|------|------|
| **单元格编辑** | 可编辑列双击/编辑；待插入行只改本地，不产生 `UPDATE`。 |
| **Set null** | 右键将单元格设为 SQL `NULL`（支持多单元格选区）。 |
| **插入行** | 在选区最后一行下方插入空行，填值后保存时生成 `INSERT`；若可写列均被 `omitFromInsert`，按方言生成 `INSERT … DEFAULT VALUES` 或 MySQL `INSERT INTO t () VALUES ()`。 |
| **删除行** | 多选行后右键 **删除行**，生成 `DELETE … WHERE`（依赖唯一键列元数据）。 |
| **撤销修改** | 撤销待执行的单元格 `UPDATE`（恢复显示）；待插入行上为清空该格。 |
| **撤销删除 / 撤销添加** | 从待执行列表移除对应 `DELETE` / 新行。 |
| **查看修改 / 隐藏 SQL** | 展开待执行的 `UPDATE`/`DELETE`/`INSERT` 文本预览。 |
| **保存修改 / Ctrl+S** | 执行所有待定 DML；`Ctrl+S` 在非 SQL 编辑器焦点、当前 Tab 激活且 `resultCellEdit` 时触发。 |
| **复制（Ctrl+C）** | 焦点在结果表且存在选区时，复制为 **制表符分隔（TSV）**，供 Excel 等粘贴。 |
| **打开 JSON/JSONB 编辑器** | 右键 JSON/JSONB 列打开专用编辑器（与 PG 类型检测相关；其它库若暴露同类列名/类型可复用）。 |

---

## 三、实质面向 PostgreSQL（其它库一般关闭能力或不展示）

接新库时若无等价实现，保持 `false` 或隐藏 UI 即可。


| 功能             | 说明                                                 |
| -------------- | -------------------------------------------------- |
| **JSONB 编辑器**  | `jsonb-editor*.tsx`：依赖 PostgreSQL 类型与值形态           |
| **分区表**        | `partition-table-modal.tsx` + `db/partition-info`  |
| **扩展管理**       | `extensions-modal.tsx` + `db/installed-extensions` |
| **pg_stat 监控** | `pg-stat-modal.tsx` + 会话/统计相关 PG 语义                |


---

## 四、新方言接入时的检查清单

1. **连接与存盘**：`DbKind`、`connection-form`、默认端口、`connect` / `connections/connect` 路由。
2. **所有会调用的 `db/*` RPC**：与现有 PostgreSQL / MySQL / SQL Server 覆盖面一致，或刻意关闭对应能力。
3. **`defaultDatabaseCapabilities` 与后端 `db/capabilities`**：与真实实现一致（参见 `docs/database-capabilities-matrix.md`）。
4. **第一节所列前端文件**：凡已有 `postgres` / `mysql` / `sqlserver` 分支的，需增加新方言或归入已有族。
5. **第三节 PG 专项**：非 PostgreSQL 则保持关闭或不展示。

### MariaDB

与 MySQL 共用 `isMysqlFamily` 与同一套后端 handler；前端多数按 MySQL 处理，连接文案与 `dbType` 登记与 MySQL 区分即可。

---

## 相关文档

- `docs/database-capabilities-matrix.md` — 能力矩阵
- `docs/adding-a-database-dialect.md` — 接入新方言指引

