# 实现计划：JSONB 编辑器

## 概述

按照设计文档，分步实现 JSONB 编辑器功能：先建立数据模型与工具函数，再实现主组件及三种视图，最后集成到 `EditableCell` 和 `sql-format.ts`。

## 任务

- [x] 1. 创建 JsonNode 数据模型与核心工具函数
  - 在 `solid-project/frontend/jsonb-editor-model.ts` 中定义 `JsonPrimitive`、`JsonValue`、`JsonObject`、`JsonArray`、`JsonLeaf`、`JsonNode` 类型
  - 实现 `toJsonNode(value: unknown): JsonNode`
  - 实现 `fromJsonNode(node: JsonNode): JsonValue`
  - 实现 `serializeCompact(node: JsonNode): string`
  - 实现 `serializePretty(node: JsonNode): string`
  - 实现 `parseJsonSafe(str: string): { ok: true; node: JsonNode } | { ok: false; error: string }`，`null` 输入返回空对象节点
  - 实现 `updateAtPath(root, path, newValue): JsonNode`（不可变更新，路径不存在时返回原节点）
  - 实现 `deleteAtPath(root, path): JsonNode`（不可变删除）
  - 实现 `buildJsonPath(columnName, path, isLeaf): string`（生成 PostgreSQL `->` / `->>` 路径）
  - 实现 `parseFormValue(input: string): JsonValue`（按优先级：null → boolean → number → JSON → string）
  - 实现 `jsonNodesEqual(a, b): boolean`（语义等价判断）
  - 实现 `isExpandable(node: JsonNode): boolean`
  - 实现 `getInitialExpanded(node: JsonNode, depth: number): boolean`（depth ≤ 3 且为对象/数组时返回 true）
  - 实现 `getValueColor(type: string): string`（字符串绿色、数字蓝色、布尔橙色、null 灰色）
  - _需求：1.3, 1.4, 2.3, 2.4, 2.5, 3.6, 7.2, 9.2, 10.4_

  - [ ]* 1.1 为 `parseJsonSafe` 编写属性测试（Property 1：JSON 解析往返一致性）
    - **Property 1: JSON 解析往返一致性**
    - **Validates: Requirements 10.4, 7.2**
    - 使用 `fc.jsonValue()` 生成器，numRuns: 100

  - [ ]* 1.2 为 `parseJsonSafe` 编写属性测试（Property 2：非法 JSON 被拒绝）
    - **Property 2: 非法 JSON 被拒绝**
    - **Validates: Requirements 1.4, 4.2, 4.3, 7.4, 8.3**
    - 使用 `fc.string()` 过滤合法 JSON，numRuns: 100

  - [ ]* 1.3 为 `toJsonNode` 编写属性测试（Property 3：节点数量与 JSON 结构一致）
    - **Property 3: 节点数量与 JSON 结构一致**
    - **Validates: Requirements 2.1, 2.2**
    - 使用 `fc.object()` 和 `fc.array(fc.anything())`，numRuns: 100

  - [ ]* 1.4 为 `isExpandable` 编写属性测试（Property 4：节点可展开性与类型对应）
    - **Property 4: 节点可展开性与类型对应**
    - **Validates: Requirements 2.3**
    - 使用 `fc.jsonValue()`，numRuns: 100

  - [ ]* 1.5 为 `getInitialExpanded` 编写属性测试（Property 5：深度超过 3 层时默认折叠）
    - **Property 5: 深度超过 3 层时默认折叠**
    - **Validates: Requirements 2.5**
    - 使用 `fc.jsonValue()` 和 `fc.integer({ min: 0, max: 10 })`，numRuns: 100

  - [ ]* 1.6 为 `getValueColor` 编写属性测试（Property 6：值类型颜色唯一映射）
    - **Property 6: 值类型颜色唯一映射**
    - **Validates: Requirements 2.4**
    - 枚举所有类型组合，numRuns: 100

  - [ ]* 1.7 为 `parseFormValue` 编写属性测试（Property 9：表单值解析类型正确）
    - **Property 9: 表单值解析类型正确**
    - **Validates: Requirements 3.6**
    - 使用 `fc.string()`，numRuns: 100

  - [ ]* 1.8 为 `serializePretty` 编写属性测试（Property 10：Raw 模式序列化格式）
    - **Property 10: Raw 模式序列化格式**
    - **Validates: Requirements 4.1, 5.3**
    - 使用 `fc.jsonValue()`，numRuns: 100

  - [ ]* 1.9 为 `serializeCompact` 编写属性测试（Property 11：紧凑序列化往返）
    - **Property 11: 紧凑序列化往返**
    - **Validates: Requirements 7.2**
    - 使用 `fc.jsonValue()`，numRuns: 100

  - [ ]* 1.10 为 `jsonNodesEqual` 编写属性测试（Property 12：未变化时 hasChanged 返回 false）
    - **Property 12: 未变化时 hasChanged 返回 false**
    - **Validates: Requirements 7.5**
    - 使用 `fc.jsonValue()`，numRuns: 100

  - [ ]* 1.11 为 `buildJsonPath` 编写属性测试（Property 14：PostgreSQL JSONB 路径构建正确性）
    - **Property 14: PostgreSQL JSONB 路径构建正确性**
    - **Validates: Requirements 9.2**
    - 使用 `fc.array(fc.oneof(fc.string(), fc.integer()))`，numRuns: 100

- [x] 2. 修改 `shared/src/sql-format.ts`，为 JSONB 类型添加 `::jsonb` 转换
  - 在 `formatSqlValue`（或 `formatCellToEditable` 调用链中的对应函数）中，当 `dataTypeOid === 3802` 时输出 `'...'::jsonb`，当 `dataTypeOid === 114` 时输出普通字符串字面量
  - 确保输出中的 JSON 字符串部分与原始值语义等价
  - _需求：10.3_

  - [ ]* 2.1 为 `formatSqlValue` 编写属性测试（Property 13：JSONB SQL 格式化包含类型转换）
    - **Property 13: JSONB SQL 格式化包含类型转换**
    - **Validates: Requirements 10.3**
    - 使用 `fc.jsonValue()`，numRuns: 100

- [x] 3. 检查点 —— 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

- [x] 4. 实现 `RawMode` 子组件
  - 在 `solid-project/frontend/jsonb-editor.tsx` 中创建文件并实现 `RawMode` 组件
  - 多行 `<textarea>`，显示格式化 JSON（缩进 2 空格）
  - 实时验证：输入变化时调用 `parseJsonSafe`，合法时清除错误，非法时显示错误信息
  - 提供"格式化"按钮：合法时替换为 `serializePretty` 输出，非法时仅显示错误
  - 只读模式下 `<textarea>` 设为 `readonly`，隐藏格式化按钮
  - _需求：4.1, 4.2, 4.3, 8.1, 8.2, 8.3_

- [x] 5. 实现 `TreeView` 子组件
  - 在 `jsonb-editor.tsx` 中实现递归 `TreeView` 组件
  - 渲染对象键值对（需求 2.1）和数组索引元素（需求 2.2）
  - 展开/折叠图标，使用 `getInitialExpanded` 初始化状态（需求 2.3, 2.5）
  - 用 `getValueColor` 为叶子节点值着色，显示类型标签（需求 2.4, 2.6）
  - 叶子节点单击进入内联编辑（`<input>`），Enter/失焦保存，Escape 取消（需求 6.1, 6.2, 6.3）
  - 对象节点旁"添加子字段"按钮，数组节点旁"添加元素"按钮（需求 6.4, 6.5）
  - 每个节点旁"删除"按钮（需求 6.6）
  - 右键菜单：提供"复制路径"（调用 `buildJsonPath`）和"复制值"选项（需求 9.1, 9.2, 9.3）
  - 超过 50 层深度时停止递归，显示 `...` 占位符
  - _需求：2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 9.1, 9.2, 9.3_

- [x] 6. 实现 `FormView` 子组件
  - 在 `jsonb-editor.tsx` 中实现 `FormView` 组件
  - 根值为对象时，将顶层键值对渲染为表单行（键名输入框 + 值输入框）（需求 3.1）
  - 根值为数组时，显示提示信息引导切换到 Tree/Raw 模式（需求 3.2）
  - 每行末尾"删除"按钮（需求 3.3）
  - 底部"添加字段"按钮（需求 3.4）
  - 键名修改时实时更新模型（需求 3.5）
  - 值修改时调用 `parseFormValue` 解析（需求 3.6）
  - _需求：3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 6.1 为 `FormView` 行数编写属性测试（Property 7：表单视图行数与顶层键数一致）
    - **Property 7: 表单视图行数与顶层键数一致**
    - **Validates: Requirements 3.1**
    - 使用 `fc.object()`，numRuns: 100

  - [ ]* 6.2 为键名更新逻辑编写属性测试（Property 8：键名更新保留值）
    - **Property 8: 键名更新保留值**
    - **Validates: Requirements 3.5**
    - 使用 `fc.object()` 和 `fc.string()`，numRuns: 100

- [x] 7. 实现 `JSONB_Editor` 主组件并串联三种视图
  - 在 `jsonb-editor.tsx` 中实现 `JSONB_Editor` 主组件（弹窗 Modal）
  - 接收 `initialValue`、`isReadOnly`、`onSave`、`onClose` props
  - 初始化：`initialValue` 为 null 时使用空对象节点；非法 JSON 时强制进入 Raw 模式并显示错误（需求 1.3, 1.4）
  - 顶部三个模式切换标签：Tree / Form / Raw（需求 5.1）
  - 切换到 Raw 时序列化 `rootNode` 为 `serializePretty` 输出（需求 5.3）
  - 从 Raw 切换时先验证，非法则阻止切换并显示错误（需求 4.4, 5.4）
  - 默认模式为 `"tree"`（需求 1.5）
  - 底部按钮：只读模式仅显示"关闭"；编辑模式显示"确认"和"取消"（需求 7.1, 7.6）
  - "确认"：Raw 模式非法时禁用；值未变化时直接关闭不触发 `onSave`；否则序列化为紧凑 JSON 调用 `onSave`（需求 7.2, 7.4, 7.5）
  - "取消"/Escape：放弃修改关闭弹窗（需求 7.3）
  - _需求：1.3, 1.4, 1.5, 4.4, 5.1, 5.2, 5.3, 5.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 8. 修改 `EditableCell`，集成 JSONB_Editor
  - 在 `solid-project/frontend/editable-cell.tsx` 中添加 `showJsonEditor` 信号
  - 修改 `startEditing()`：当 `dataTypeOid` 为 114 或 3802 时，设置 `showJsonEditor(true)` 而非进入 `<input>` 编辑；只读单元格同样可打开查看（需求 1.1, 1.2）
  - 在渲染中追加 `<Show when={showJsonEditor()}>` 块，渲染 `JSONB_Editor` 组件，`onSave` 回调调用 `props.onSave` 后关闭弹窗（需求 10.1, 10.2）
  - _需求：1.1, 1.2, 10.1, 10.2_

- [x] 9. 最终检查点 —— 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户提问。

## 备注

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 进度
- 每个任务均引用具体需求条款以保证可追溯性
- 属性测试文件路径：`solid-project/frontend/jsonb-editor-model.test.ts`
- 属性测试使用 fast-check，每个属性最少运行 100 次
- 检查点任务确保增量验证，发现问题及时修正
