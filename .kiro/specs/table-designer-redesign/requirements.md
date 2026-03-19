# 需求文档

## 简介

本功能对现有的表设计器（Table Designer）进行重构和增强，参考 Antares SQL 客户端的设计理念。
当前实现分为两个独立组件（`table-designer-create.tsx` 和 `table-designer-edit.tsx`），存在功能不对等、约束管理缺失、无索引管理等问题。

重构目标：将新建表和编辑表统一为一套 UI 组件，增加索引管理、完整约束管理（含编辑模式）、列注释、表注释、列名重命名、清除修改等功能，并改进外键管理 UI。

## 词汇表

- **TableDesigner**：统一的表设计器组件，同时支持新建表（create）和编辑表（edit）两种模式
- **TableColumn**：列定义数据结构，包含列名、类型、长度/精度、可空性、主键、默认值、注释等属性
- **IndexDef**：索引定义数据结构，包含索引名、索引类型（BTREE/HASH）、列列表、唯一性标志
- **ForeignKeyDef**：外键约束定义，包含本表列、参照 schema、参照表、参照列、ON DELETE 动作、ON UPDATE 动作
- **UniqueConstraintDef**：唯一约束定义，包含约束名和列列表
- **CheckConstraintDef**：检查约束定义，包含约束名和表达式
- **isChanged**：表示当前设计器是否存在未保存修改的状态标志
- **DDL_Builder**：负责将设计器状态转换为 PostgreSQL DDL 语句的逻辑模块
- **ConstraintModal**：用于管理索引、外键、唯一约束、检查约束的弹窗组件

---

## 需求

### 需求 1：统一新建/编辑表 UI 组件

**用户故事：** 作为开发者，我希望新建表和编辑表使用同一套 UI 组件，以便获得一致的操作体验，并减少代码维护成本。

#### 验收标准

1. THE **TableDesigner** SHALL 通过 `mode` 属性（`"create"` | `"edit"`）区分新建和编辑两种模式，并在同一组件内渲染所有 UI 元素。
2. WHEN `mode` 为 `"edit"` 时，THE **TableDesigner** SHALL 从后端加载现有表的列定义、索引、约束信息并填充到表单中。
3. WHEN `mode` 为 `"create"` 时，THE **TableDesigner** SHALL 以空白状态初始化，并提供一个默认的空列行。
4. THE **TableDesigner** SHALL 在工具栏中显示"保存"、"清除修改"、"添加列"操作按钮，以及"索引"、"外键"、"检查约束"、"唯一约束"的管理入口。
5. WHEN `mode` 为 `"edit"` 时，THE **TableDesigner** SHALL 在标题区域显示当前 schema 和表名（格式：`schema.table_name`）。
6. WHEN `mode` 为 `"create"` 时，THE **TableDesigner** SHALL 提供可编辑的表名输入框。

---

### 需求 2：未保存修改状态追踪

**用户故事：** 作为用户，我希望设计器能追踪是否有未保存的修改，以便在离开前得到提示，避免意外丢失修改。

#### 验收标准

1. THE **TableDesigner** SHALL 维护一个 `isChanged` 状态，初始值为 `false`。
2. WHEN 用户对列定义、索引、约束或表注释进行任何修改时，THE **TableDesigner** SHALL 将 `isChanged` 设置为 `true`。
3. WHEN 用户成功保存修改后，THE **TableDesigner** SHALL 将 `isChanged` 重置为 `false`。
4. WHEN 用户执行"清除修改"操作后，THE **TableDesigner** SHALL 将 `isChanged` 重置为 `false`。
5. WHILE `isChanged` 为 `true` 时，THE **TableDesigner** SHALL 在工具栏的"保存"按钮旁显示视觉提示（如高亮或标记），以提醒用户存在未保存修改。

---

### 需求 3：清除修改功能

**用户故事：** 作为用户，我希望能一键撤销所有未保存的修改，将设计器恢复到最后一次保存（或初始加载）的状态。

#### 验收标准

1. THE **TableDesigner** SHALL 在工具栏提供"清除修改"按钮。
2. WHEN 用户点击"清除修改"按钮时，THE **TableDesigner** SHALL 将所有列定义、索引、约束、表注释恢复到最后一次成功保存或初始加载时的状态。
3. WHEN 用户点击"清除修改"按钮时，THE **TableDesigner** SHALL 将 `isChanged` 重置为 `false`。
4. WHILE `isChanged` 为 `false` 时，THE **TableDesigner** SHALL 将"清除修改"按钮置为禁用状态。

---

### 需求 4：列定义增强（注释、精度）

**用户故事：** 作为数据库设计者，我希望在设计列时能填写列注释和精度/小数位数，以便生成更完整的表结构。

#### 验收标准

1. THE **TableDesigner** SHALL 在列定义表格中提供"注释"（comment）输入列，允许用户为每列填写注释文本。
2. WHEN 列类型为 `numeric` 或 `decimal` 时，THE **TableDesigner** SHALL 同时显示"精度"（precision）和"小数位"（scale）两个输入框，替代单一的"长度"输入框。
3. WHEN 列注释不为空时，THE **DDL_Builder** SHALL 为该列生成 `COMMENT ON COLUMN` SQL 语句。
4. THE **TableDesigner** SHALL 支持列的复制操作：WHEN 用户点击某列的"复制"按钮时，THE **TableDesigner** SHALL 在该列下方插入一个与其属性相同（列名加 `_copy` 后缀）的新列。
5. THE **TableDesigner** SHALL 在列定义表格中提供列排序操作（上移/下移按钮），WHEN 用户点击时，THE **TableDesigner** SHALL 调整列的顺序。

---

### 需求 5：表注释支持

**用户故事：** 作为数据库设计者，我希望能为表添加注释，以便在数据库中记录表的用途说明。

#### 验收标准

1. THE **TableDesigner** SHALL 在表名输入区域下方提供"表注释"（table comment）输入框。
2. WHEN 表注释不为空时，THE **DDL_Builder** SHALL 生成 `COMMENT ON TABLE` SQL 语句。
3. WHEN `mode` 为 `"edit"` 且表存在注释时，THE **TableDesigner** SHALL 在加载时将现有表注释填充到输入框中。

---

### 需求 6：列名重命名（编辑模式）

**用户故事：** 作为用户，我希望在编辑表时能修改已有列的列名，以便通过 UI 完成列重命名操作，而无需手动编写 SQL。

#### 验收标准

1. WHEN `mode` 为 `"edit"` 时，THE **TableDesigner** SHALL 允许用户修改已有列（非新增列）的列名。
2. WHEN 用户修改了已有列的列名时，THE **DDL_Builder** SHALL 生成 `ALTER TABLE ... RENAME COLUMN old_name TO new_name` SQL 语句。
3. IF 用户将列名修改为空字符串，THEN THE **TableDesigner** SHALL 显示验证错误提示，并阻止保存操作。
4. IF 用户将列名修改为与同表其他列相同的名称，THEN THE **TableDesigner** SHALL 显示"列名重复"错误提示，并阻止保存操作。

---

### 需求 7：索引管理

**用户故事：** 作为数据库设计者，我希望能在表设计器中管理表的索引，以便创建和删除索引，而无需手动编写 SQL。

#### 验收标准

1. THE **TableDesigner** SHALL 提供索引管理入口（工具栏按钮或 Tab），WHEN 用户点击时，THE **TableDesigner** SHALL 打开索引管理面板。
2. THE **TableDesigner** SHALL 支持添加索引：WHEN 用户点击"添加索引"时，THE **TableDesigner** SHALL 新增一条索引定义行，包含索引名、索引类型（BTREE/HASH）、列选择、唯一性（UNIQUE）选项。
3. THE **TableDesigner** SHALL 支持删除索引：WHEN 用户点击某索引的"删除"按钮时，THE **TableDesigner** SHALL 将该索引标记为待删除。
4. WHEN `mode` 为 `"edit"` 且表存在索引时，THE **TableDesigner** SHALL 在加载时将现有索引填充到索引管理面板中。
5. WHEN 用户保存时，THE **DDL_Builder** SHALL 为新增索引生成 `CREATE [UNIQUE] INDEX ... ON ... USING ...` SQL 语句。
6. WHEN 用户保存时，THE **DDL_Builder** SHALL 为待删除的已有索引生成 `DROP INDEX` SQL 语句。
7. IF 索引名为空，THEN THE **TableDesigner** SHALL 自动生成默认索引名（格式：`idx_{表名}_{列名}`）。
8. IF 索引列列表为空，THEN THE **TableDesigner** SHALL 显示验证错误，并阻止保存操作。

---

### 需求 8：外键约束管理（新建和编辑模式统一）

**用户故事：** 作为数据库设计者，我希望在新建和编辑表时都能管理外键约束，并支持选择 ON DELETE/ON UPDATE 动作，以便生成完整的外键定义。

#### 验收标准

1. THE **TableDesigner** SHALL 在新建和编辑两种模式下均提供外键约束管理功能。
2. THE **TableDesigner** SHALL 支持添加外键：每条外键定义包含约束名（可选）、本表列、参照 schema、参照表、参照列、ON DELETE 动作、ON UPDATE 动作。
3. THE **TableDesigner** SHALL 为 ON DELETE 和 ON UPDATE 提供下拉选择，选项包括：`NO ACTION`、`RESTRICT`、`CASCADE`、`SET NULL`、`SET DEFAULT`。
4. WHEN `mode` 为 `"edit"` 且表存在外键时，THE **TableDesigner** SHALL 在加载时将现有外键填充到外键管理面板中。
5. WHEN 用户保存时，THE **DDL_Builder** SHALL 为新增外键生成包含 `ON DELETE` 和 `ON UPDATE` 子句的 `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` SQL 语句。
6. WHEN 用户保存时，THE **DDL_Builder** SHALL 为待删除的已有外键生成 `ALTER TABLE ... DROP CONSTRAINT` SQL 语句。
7. IF 外键的本表列、参照表或参照列为空，THEN THE **TableDesigner** SHALL 显示验证错误，并阻止保存操作。

---

### 需求 9：唯一约束和检查约束管理（新建和编辑模式统一）

**用户故事：** 作为数据库设计者，我希望在新建和编辑表时都能管理唯一约束和检查约束，以便完整定义表的完整性规则。

#### 验收标准

1. THE **TableDesigner** SHALL 在新建和编辑两种模式下均提供唯一约束（UNIQUE）管理功能。
2. THE **TableDesigner** SHALL 在新建和编辑两种模式下均提供检查约束（CHECK）管理功能。
3. WHEN `mode` 为 `"edit"` 且表存在唯一约束时，THE **TableDesigner** SHALL 在加载时将现有唯一约束填充到管理面板中。
4. WHEN `mode` 为 `"edit"` 且表存在检查约束时，THE **TableDesigner** SHALL 在加载时将现有检查约束填充到管理面板中。
5. WHEN 用户保存时，THE **DDL_Builder** SHALL 为新增唯一约束生成 `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE` SQL 语句（新建表时内联在 `CREATE TABLE` 中）。
6. WHEN 用户保存时，THE **DDL_Builder** SHALL 为新增检查约束生成 `ALTER TABLE ... ADD CONSTRAINT ... CHECK` SQL 语句（新建表时内联在 `CREATE TABLE` 中）。
7. WHEN 用户保存时，THE **DDL_Builder** SHALL 为待删除的已有约束生成 `ALTER TABLE ... DROP CONSTRAINT` SQL 语句。
8. IF 检查约束表达式为空，THEN THE **TableDesigner** SHALL 显示验证错误，并阻止保存操作。

---

### 需求 10：SQL 预览与执行

**用户故事：** 作为用户，我希望在执行前能预览将要执行的 SQL 语句，以便确认修改内容的正确性。

#### 验收标准

1. THE **TableDesigner** SHALL 提供"预览 SQL"功能，WHEN 用户点击时，THE **TableDesigner** SHALL 展示 **DDL_Builder** 生成的完整 SQL 语句列表。
2. THE **DDL_Builder** SHALL 按以下顺序生成 SQL 语句：列修改（ADD/ALTER/DROP COLUMN）→ 列重命名 → 约束删除 → 约束新增 → 索引删除 → 索引新增 → 注释语句。
3. WHEN 用户点击"保存"时，THE **TableDesigner** SHALL 按顺序逐条执行生成的 SQL 语句，并在全部成功后更新内部状态（将当前状态设为新的"原始状态"）。
4. IF 任意一条 SQL 语句执行失败，THEN THE **TableDesigner** SHALL 停止执行后续语句，并在界面上显示具体的错误信息。
5. WHEN 没有任何修改时，THE **DDL_Builder** SHALL 生成空的 SQL 列表，THE **TableDesigner** SHALL 提示"没有修改需要保存"。

---

### 需求 11：输入验证与错误处理

**用户故事：** 作为用户，我希望设计器能在保存前验证输入的合法性，并给出清晰的错误提示，以便快速定位和修正问题。

#### 验收标准

1. IF 表名为空，THEN THE **TableDesigner** SHALL 显示"表名不能为空"错误提示，并阻止保存操作。
2. IF 存在列名为空的列定义行，THEN THE **TableDesigner** SHALL 显示"列名不能为空"错误提示，并阻止保存操作。
3. IF 存在重复的列名，THEN THE **TableDesigner** SHALL 显示"列名重复"错误提示，并阻止保存操作。
4. IF 后端 DDL 执行返回错误，THEN THE **TableDesigner** SHALL 在界面上显示后端返回的错误信息，并保持当前编辑状态不变。
5. THE **TableDesigner** SHALL 在保存操作进行中将"保存"按钮置为禁用状态，并显示加载指示，以防止重复提交。
