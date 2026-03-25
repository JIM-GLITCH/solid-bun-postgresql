# 需求文档

## 简介

JSONB 编辑器功能为 DB Player 数据库管理工具中的 JSON/JSONB 列提供可视化编辑能力。当前系统对 JSON/JSONB 类型的单元格仅支持纯文本编辑（通过 `EditableCell` 组件的 `<input>` 输入框），用户需要手动输入合法的 JSON 字符串，体验较差且容易出错。

本功能将在现有的查询结果表格（`QueryInterface`）中，为 JSON/JSONB 类型列提供专用的可视化编辑器，支持树形视图和表单视图两种模式，并与现有的单元格编辑、保存流程无缝集成。

---

## 词汇表

- **JSONB_Editor**：JSONB 编辑器组件，负责 JSON/JSONB 数据的可视化展示与编辑
- **Tree_View**：树形视图，以可折叠树状结构展示 JSON 对象/数组的层级关系
- **Form_View**：表单视图，以键值对表单形式展示 JSON 对象的顶层字段
- **JSON_Node**：JSON 树中的一个节点，可以是对象、数组、字符串、数字、布尔值或 null
- **EditableCell**：查询结果表格中的可编辑单元格组件（`editable-cell.tsx`）
- **QueryInterface**：查询界面组件（`query-interface.tsx`），包含 SQL 编辑器和结果表格
- **PG_OID**：PostgreSQL 类型 OID，json 为 114，jsonb 为 3802
- **Raw_Mode**：原始文本模式，直接编辑 JSON 字符串
- **Validator**：JSON 验证器，负责验证用户输入的 JSON 合法性

---

## 需求

### 需求 1：触发 JSONB 编辑器

**用户故事：** 作为数据库用户，我希望在双击 JSON/JSONB 类型的单元格时能打开专用的可视化编辑器，而不是普通的文本输入框，以便更方便地查看和编辑复杂的 JSON 数据。

#### 验收标准

1. WHEN 用户双击 `dataTypeOid` 为 114（json）或 3802（jsonb）的可编辑单元格，THE `JSONB_Editor` SHALL 以弹窗（Modal）形式打开，并加载该单元格的当前值
2. WHEN 用户双击 `dataTypeOid` 为 114 或 3802 的只读单元格，THE `JSONB_Editor` SHALL 以只读模式打开，仅供查看，不允许编辑
3. WHEN 单元格的值为 SQL NULL，THE `JSONB_Editor` SHALL 打开时显示空的 JSON 对象 `{}`，并允许用户输入新值
4. WHEN 单元格的值为非 JSON 格式的字符串，THE `JSONB_Editor` SHALL 打开时在 Raw_Mode 下显示原始字符串，并提示解析错误
5. THE `JSONB_Editor` SHALL 在打开时默认使用 Tree_View 模式

---

### 需求 2：树形视图（Tree View）

**用户故事：** 作为数据库用户，我希望以树形结构浏览 JSON 数据的层级关系，以便快速理解复杂嵌套结构。

#### 验收标准

1. THE `Tree_View` SHALL 将 JSON 对象的每个键值对渲染为一个可展开的 `JSON_Node`
2. THE `Tree_View` SHALL 将 JSON 数组的每个元素渲染为带索引的 `JSON_Node`
3. WHEN `JSON_Node` 的值为对象或数组，THE `Tree_View` SHALL 在节点左侧显示展开/折叠图标，点击后切换展开状态
4. THE `Tree_View` SHALL 用不同颜色区分 JSON 值类型：字符串（绿色）、数字（蓝色）、布尔值（橙色）、null（灰色）、对象/数组（默认前景色）
5. WHEN `JSON_Node` 的嵌套深度超过 3 层，THE `Tree_View` SHALL 默认折叠该节点，避免初始渲染过深
6. THE `Tree_View` SHALL 在每个叶子节点旁显示值类型标签（如 `string`、`number`、`boolean`、`null`）

---

### 需求 3：表单视图（Form View）

**用户故事：** 作为数据库用户，我希望以表单形式编辑 JSON 对象的顶层字段，以便快速修改常见的配置类 JSON 数据。

#### 验收标准

1. THE `Form_View` SHALL 将 JSON 对象的每个顶层键值对渲染为一行，包含键名输入框和值输入框
2. WHEN JSON 根值为数组而非对象，THE `Form_View` SHALL 显示提示信息，说明表单视图仅支持对象类型，并引导用户切换到 Tree_View 或 Raw_Mode
3. THE `Form_View` SHALL 在每行末尾提供删除按钮，点击后移除该键值对
4. THE `Form_View` SHALL 在表单底部提供"添加字段"按钮，点击后在末尾追加一个空的键值对行
5. WHEN 用户修改键名输入框，THE `Form_View` SHALL 实时更新内部 JSON 数据模型中对应的键名
6. WHEN 用户修改值输入框，THE `Form_View` SHALL 尝试将输入解析为 JSON 值（数字、布尔、null、对象、数组），解析失败时保留为字符串类型

---

### 需求 4：原始文本模式（Raw Mode）

**用户故事：** 作为数据库用户，我希望能直接编辑 JSON 的原始文本，以便处理复杂的批量修改或粘贴外部 JSON 数据。

#### 验收标准

1. THE `Raw_Mode` SHALL 提供一个多行文本编辑区域，显示当前 JSON 的格式化字符串（缩进 2 空格）
2. WHEN 用户在 Raw_Mode 中输入文本，THE `Validator` SHALL 实时验证输入是否为合法 JSON，并在编辑区域下方显示验证状态
3. IF 用户输入的文本不是合法 JSON，THEN THE `Validator` SHALL 显示具体的解析错误信息（如行号、错误描述），并禁用确认保存按钮
4. WHEN 用户从 Raw_Mode 切换到 Tree_View 或 Form_View，THE `JSONB_Editor` SHALL 先验证当前文本是否合法，IF 不合法 THEN THE `JSONB_Editor` SHALL 阻止切换并提示用户修正错误

---

### 需求 5：视图模式切换

**用户故事：** 作为数据库用户，我希望能在树形视图、表单视图和原始文本模式之间自由切换，以便根据不同场景选择最合适的编辑方式。

#### 验收标准

1. THE `JSONB_Editor` SHALL 在顶部提供三个模式切换标签：Tree（树形）、Form（表单）、Raw（原始）
2. WHEN 用户点击模式切换标签，THE `JSONB_Editor` SHALL 将当前模式的数据同步到内部统一数据模型，再切换到目标视图渲染
3. WHEN 从任意模式切换到 Raw_Mode，THE `JSONB_Editor` SHALL 将内部数据模型序列化为格式化 JSON 字符串（缩进 2 空格）显示在文本区域
4. WHEN 从 Raw_Mode 切换到其他模式，THE `JSONB_Editor` SHALL 将文本区域内容解析为内部数据模型，IF 解析失败 THEN THE `JSONB_Editor` SHALL 阻止切换

---

### 需求 6：编辑操作（Tree View 编辑）

**用户故事：** 作为数据库用户，我希望能在树形视图中直接编辑 JSON 节点的值，以便在保持结构可见的同时进行精确修改。

#### 验收标准

1. WHEN 用户单击 `JSON_Node` 的叶子节点值区域，THE `Tree_View` SHALL 将该值切换为内联编辑状态（inline input）
2. WHEN 用户在内联编辑状态下按 Enter 键或点击其他区域，THE `Tree_View` SHALL 保存修改并退出编辑状态
3. WHEN 用户在内联编辑状态下按 Escape 键，THE `Tree_View` SHALL 放弃修改并退出编辑状态
4. THE `Tree_View` SHALL 在每个对象节点旁提供"添加子字段"按钮，点击后在该对象下追加一个空键值对
5. THE `Tree_View` SHALL 在每个数组节点旁提供"添加元素"按钮，点击后在数组末尾追加一个 null 元素
6. THE `Tree_View` SHALL 在每个 `JSON_Node` 旁提供删除按钮，点击后从父节点中移除该节点

---

### 需求 7：保存与取消

**用户故事：** 作为数据库用户，我希望编辑完成后能将修改后的 JSON 值保存回单元格，或取消放弃修改，以便与现有的数据保存流程集成。

#### 验收标准

1. THE `JSONB_Editor` SHALL 在底部提供"确认"和"取消"两个按钮
2. WHEN 用户点击"确认"按钮，THE `JSONB_Editor` SHALL 将内部数据模型序列化为紧凑 JSON 字符串，调用 `EditableCell` 的 `onSave` 回调，并关闭弹窗
3. WHEN 用户点击"取消"按钮或按 Escape 键，THE `JSONB_Editor` SHALL 放弃所有修改并关闭弹窗，不触发 `onSave`
4. WHEN 用户点击"确认"按钮且当前处于 Raw_Mode 且内容不合法，THE `JSONB_Editor` SHALL 阻止保存并显示错误提示
5. WHEN 用户点击"确认"按钮且值未发生变化，THE `JSONB_Editor` SHALL 直接关闭弹窗，不触发 `onSave`
6. WHEN `JSONB_Editor` 处于只读模式，THE `JSONB_Editor` SHALL 仅显示"关闭"按钮，不显示"确认"按钮

---

### 需求 8：JSON 格式化与美化

**用户故事：** 作为数据库用户，我希望能一键格式化 JSON 内容，以便快速整理粘贴进来的压缩 JSON 数据。

#### 验收标准

1. THE `JSONB_Editor` SHALL 在 Raw_Mode 下提供"格式化"按钮
2. WHEN 用户点击"格式化"按钮且当前文本为合法 JSON，THE `JSONB_Editor` SHALL 将文本替换为缩进 2 空格的格式化 JSON 字符串
3. IF 用户点击"格式化"按钮且当前文本不是合法 JSON，THEN THE `Validator` SHALL 显示解析错误，不修改文本内容

---

### 需求 9：JSON 路径复制

**用户故事：** 作为数据库用户，我希望能复制 JSON 树中某个节点的访问路径，以便在 SQL 查询中使用 `->` 或 `->>` 操作符。

#### 验收标准

1. THE `Tree_View` SHALL 在每个 `JSON_Node` 的右键菜单中提供"复制路径"选项
2. WHEN 用户选择"复制路径"，THE `Tree_View` SHALL 将该节点从根到当前节点的 PostgreSQL JSONB 路径（如 `data->'user'->>'name'`）写入剪贴板
3. THE `Tree_View` SHALL 在每个 `JSON_Node` 的右键菜单中提供"复制值"选项，将该节点的 JSON 值字符串写入剪贴板

---

### 需求 10：与现有编辑流程集成

**用户故事：** 作为数据库用户，我希望 JSONB 编辑器的修改能无缝融入现有的待保存队列，以便与其他列的修改一起批量提交。

#### 验收标准

1. WHEN `JSONB_Editor` 调用 `onSave` 回调，THE `QueryInterface` SHALL 将该修改加入 `pendingUpdates` 队列，与普通单元格编辑行为一致
2. THE `QueryInterface` SHALL 在 JSON/JSONB 列的单元格上显示与其他已修改单元格相同的视觉标记（黄色背景）
3. WHEN `QueryInterface` 执行"保存所有修改"，THE `QueryInterface` SHALL 将 JSON/JSONB 列的修改值以 `'...'::jsonb` 格式拼入 UPDATE SQL
4. FOR ALL 合法的 JSON 对象值，经过 JSONB_Editor 编辑保存后再次打开，THE `JSONB_Editor` SHALL 显示与保存前语义等价的 JSON 结构（往返一致性）
