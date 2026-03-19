# 实现计划：表设计器重构（table-designer-redesign）

## 概述

将现有的 `table-designer-create.tsx` 和 `table-designer-edit.tsx` 合并为统一的 `table-designer-unified.tsx`，扩展共享类型与 DDL 构建逻辑，新增后端 API，并实现索引管理、完整约束管理、列注释、表注释、列名重命名、清除修改等功能。

## 任务

- [x] 1. 扩展共享类型与 DDL 构建逻辑（table-designer-shared.ts）
  - 在 `table-designer-shared.ts` 中扩展 `TableColumn` 接口，新增 `originalName`、`precision`、`scale`、`comment` 字段
  - 新增 `IndexDef`、`ForeignKeyDef`（含 `FKAction` 类型）、`UniqueConstraintDef`、`CheckConstraintDef`、`OriginalState` 接口
  - 扩展 `needsLength` 逻辑，新增 `needsPrecision(type)` 函数（判断 numeric/decimal）
  - 实现 `autoIndexName(tableName, columns)` 函数，生成 `idx_{表名}_{列名}` 格式的默认索引名
  - 实现 `validateDesignerState(state)` 验证函数，覆盖表名为空、列名为空、列名重复、索引列为空、外键不完整、检查约束表达式为空等规则
  - 实现 `buildDdlStatements(schema, tableName, mode, original, current)` 函数，按设计文档规定顺序生成 SQL 数组
  - _需求：1.1、4.2、4.3、6.2、7.5、7.6、7.7、8.5、8.6、9.5、9.6、9.7、10.2、10.5、11.1、11.2、11.3_

  - [ ]* 1.1 为 `buildDdlStatements` 编写属性测试（属性 5、8、9、10、11、12、13、14）
    - **属性 5：列注释 DDL 生成** — 生成随机列定义（含/不含注释），验证 `COMMENT ON COLUMN` 语句的存在性
    - **属性 8：表注释 DDL 生成** — 生成随机表注释，验证 `COMMENT ON TABLE` 语句的存在性
    - **属性 9：列重命名 DDL 生成** — 生成随机列名对，验证 `RENAME COLUMN` 语句的正确性
    - **属性 10：索引 DDL 生成** — 生成随机索引定义，验证 `CREATE/DROP INDEX` 语句
    - **属性 11：外键 DDL 生成** — 生成随机外键定义，验证 `ADD/DROP CONSTRAINT FOREIGN KEY` 语句
    - **属性 12：约束 DDL 生成** — 生成随机唯一/检查约束，验证 `ADD/DROP CONSTRAINT` 语句
    - **属性 13：DDL 生成顺序** — 生成包含多种操作的状态，验证 SQL 语句顺序
    - **属性 14：无修改时 DDL 为空** — 生成任意原始状态，不修改时验证 SQL 为空数组
    - **验证：需求 4.3、5.2、6.2、7.5、7.6、8.5、8.6、9.5、9.6、9.7、10.2、10.5**

  - [ ]* 1.2 为 `validateDesignerState` 编写属性测试（属性 15、16）
    - **属性 15：重复列名验证** — 生成包含重复列名的列列表，验证验证函数返回错误
    - **属性 16：自动生成索引名** — 生成随机表名和列名，验证自动索引名符合 `idx_{表名}_{列名}` 格式
    - **验证：需求 7.7、11.3**

- [x] 2. 新增后端 API（api-core.ts 与 api.ts）
  - 在 `backend/api-core.ts` 的 `handleApiRequest` switch 中新增 `postgres/table-comment` case，执行 `obj_description` 查询返回表注释
  - 在 `backend/api-core.ts` 中新增 `postgres/check-constraints` case，执行 `information_schema.check_constraints` 查询（过滤 `_not_null` 约束）
  - 在 `frontend/api.ts` 中新增 `getTableComment(connectionId, schema, table)` 和 `getCheckConstraints(connectionId, schema, table)` 函数
  - 在 `shared/src/transport.ts`（或类型声明处）注册新增的两个 API 方法类型
  - _需求：1.2、5.3、9.4_

- [x] 3. 实现统一表设计器主组件（table-designer-unified.tsx）
  - 创建 `frontend/table-designer-unified.tsx`，定义 `TableDesignerProps`（含 `mode: "create" | "edit"`）
  - 使用 `createStore` 管理 `columns`、`indexes`、`foreignKeys`、`uniqueConstraints`、`checkConstraints`
  - 使用 `createSignal` 管理 `tableName`、`tableComment`、`originalState`（快照）
  - 使用 `createMemo` 实现 `isChanged`（JSON 序列化对比当前状态与快照）
  - edit 模式下使用 `createResource` 并行加载列、索引、外键、唯一约束、检查约束、表注释，加载完成后设置 `originalState` 快照
  - create 模式下初始化空状态，`originalState` 为空快照
  - _需求：1.1、1.2、1.3、2.1、2.2_

  - [ ]* 3.1 为 `isChanged` 编写属性测试（属性 2、3）
    - **属性 2：修改触发 isChanged** — 生成随机修改操作，验证 `isChanged` 变为 `true`
    - **属性 3：清除修改还原（Round-Trip）** — 生成随机修改序列，清除后对比快照完全一致
    - **验证：需求 2.2、3.2、3.3**

- [x] 4. 实现工具栏与表元信息区域
  - 在主组件中实现工具栏（ToolBar）：包含"保存"按钮（`isChanged` 为 true 时高亮）、"清除修改"按钮（`isChanged` 为 false 时禁用）、"预览 SQL"按钮
  - 实现"清除修改"逻辑：将所有 store 状态从 `originalState` 快照恢复，重置 `isChanged`
  - 实现 TableMetaSection：create 模式显示可编辑表名输入框 + 表注释输入框；edit 模式显示只读 `schema.table_name` + 可编辑表注释输入框
  - _需求：1.4、1.5、1.6、2.3、2.4、2.5、3.1、3.2、3.3、3.4、5.1、5.2_

- [x] 5. 实现列定义 Tab（ColumnsTab）
  - 实现列定义表格，列头：列名 | 类型 | 长度/精度 | 小数位 | 非空 | 主键 | 默认值 | 注释 | 操作
  - 当列类型为 `numeric`/`decimal` 时，显示精度（precision）和小数位（scale）输入框；其他需要长度的类型显示长度输入框；否则显示"—"
  - edit 模式下已有列（`isNew` 为 false）的列名可编辑，修改时同步更新 `originalName`（若尚未设置）
  - 实现列复制按钮：在当前列下方插入属性相同、列名加 `_copy` 后缀的新列
  - 实现列排序按钮（上移/下移）：交换相邻列位置
  - _需求：4.1、4.2、4.4、4.5、6.1_

  - [ ]* 5.1 为列复制行为编写属性测试（属性 6）
    - **属性 6：列复制行为** — 生成随机列，复制后验证列表长度 +1、新列属性与原列相同、列名为原列名 + `_copy`
    - **验证：需求 4.4**

  - [ ]* 5.2 为列排序行为编写属性测试（属性 7）
    - **属性 7：列排序行为** — 生成随机列列表，上移/下移后验证目标列位置及其余列顺序不变
    - **验证：需求 4.5**

- [x] 6. 实现索引管理 Tab（IndexesTab）
  - 实现索引管理面板，每行：索引名 | 类型（BTREE/HASH）| 列（多选或逗号分隔输入）| UNIQUE 复选框 | 删除按钮
  - 已有索引（`isExisting: true`）点击删除时标记 `toDelete: true` 并以删除线样式显示，而非直接移除
  - 新增索引行（`isNew: true`）点击删除时直接从列表移除
  - 索引名为空时，根据表名和列名自动填充默认索引名（调用 `autoIndexName`）
  - edit 模式加载时将现有索引填充到面板（`isExisting: true`）
  - _需求：7.1、7.2、7.3、7.4、7.7、7.8_

- [x] 7. 实现外键管理 Tab（ForeignKeysTab）
  - 实现外键管理面板，每行：约束名（可选）| 本表列 | 参照 schema | 参照表 | 参照列 | ON DELETE 下拉 | ON UPDATE 下拉 | 删除按钮
  - ON DELETE / ON UPDATE 下拉选项：`NO ACTION`、`RESTRICT`、`CASCADE`、`SET NULL`、`SET DEFAULT`
  - 已有外键（`isExisting: true`）点击删除时标记 `toDelete: true`；新增外键直接移除
  - edit 模式加载时将现有外键填充到面板（`isExisting: true`）
  - _需求：8.1、8.2、8.3、8.4_

- [x] 8. 实现约束管理 Tab（ConstraintsTab）
  - 实现唯一约束子区域：约束名（可选）| 列（逗号分隔）| 删除按钮
  - 实现检查约束子区域：约束名（可选）| 表达式 | 删除按钮
  - 已有约束（`isExisting: true`）点击删除时标记 `toDelete: true`；新增约束直接移除
  - edit 模式加载时将现有唯一约束和检查约束填充到面板（`isExisting: true`）
  - _需求：9.1、9.2、9.3、9.4_

- [x] 9. 实现 SQL 预览面板与保存流程
  - 实现 SqlPreviewPanel：只读 `<pre>` 展示 `buildDdlStatements` 生成的 SQL 列表，每条语句以 `;` 结尾并换行分隔
  - 实现保存流程：调用 `validateDesignerState` 验证，验证失败时显示错误并阻止保存；验证通过后逐条调用 `executeDdl` 执行 SQL，全部成功后将当前状态设为新的 `originalState` 快照并重置 `isChanged`
  - 实现无修改时的提示：当 `buildDdlStatements` 返回空数组时，显示"没有修改需要保存"
  - 保存进行中将"保存"按钮置为禁用并显示加载状态
  - 后端执行失败时显示错误信息，保持当前编辑状态不变
  - _需求：10.1、10.3、10.4、10.5、11.1、11.2、11.3、11.4、11.5_

- [x] 10. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户说明。

- [x] 11. 更新路由入口（table-designer.tsx）与数据加载属性测试
  - 修改 `frontend/table-designer.tsx`，将 create 和 edit 两个分支统一替换为渲染 `TableDesignerUnified` 组件
  - 保持 `TableDesignerProps` 接口不变，确保调用方无需修改
  - _需求：1.1、1.2、1.3_

  - [ ]* 11.1 为数据加载填充编写属性测试（属性 1）
    - **属性 1：数据加载填充一致性** — mock API 返回任意列/索引/外键/约束/注释数据，验证加载后组件内部状态与加载数据完全一致
    - **验证：需求 1.2、5.3、7.4、8.4、9.3、9.4**

- [x] 12. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户说明。

## 备注

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 进度
- 每个任务均引用了具体需求条款，确保可追溯性
- 属性测试使用 `fast-check` 库，每个属性最少运行 100 次迭代
- 单元测试文件：`frontend/table-designer-shared.test.ts`（DDL 构建逻辑）和 `frontend/table-designer-unified.test.tsx`（组件行为）
- 后端新增 API 需同步在 `shared/src/transport.ts` 的类型声明中注册
