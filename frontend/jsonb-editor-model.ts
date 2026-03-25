/**
 * JSONB 编辑器数据模型与核心工具函数
 */

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export interface JsonObject {
  type: "object";
  entries: Array<{ key: string; value: JsonNode }>;
}

export interface JsonArray {
  type: "array";
  items: JsonNode[];
}

export interface JsonLeaf {
  type: "string" | "number" | "boolean" | "null";
  value: JsonPrimitive;
}

export type JsonNode = JsonObject | JsonArray | JsonLeaf;

// ─── 核心转换函数 ─────────────────────────────────────────────────────────────

/** 将原始 JS 值转换为 JsonNode */
export function toJsonNode(value: unknown): JsonNode {
  if (value === null) {
    return { type: "null", value: null };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", value };
  }
  if (typeof value === "number") {
    return { type: "number", value };
  }
  if (typeof value === "string") {
    return { type: "string", value };
  }
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.map((item) => toJsonNode(item)),
    };
  }
  if (typeof value === "object") {
    return {
      type: "object",
      entries: Object.entries(value as Record<string, unknown>).map(([key, val]) => ({
        key,
        value: toJsonNode(val),
      })),
    };
  }
  // fallback: treat as string
  return { type: "string", value: String(value) };
}

/** 将 JsonNode 还原为原始 JS 值 */
export function fromJsonNode(node: JsonNode): JsonValue {
  if (node.type === "object") {
    const obj: Record<string, JsonValue> = {};
    for (const entry of node.entries) {
      obj[entry.key] = fromJsonNode(entry.value);
    }
    return obj as JsonValue;
  }
  if (node.type === "array") {
    return node.items.map((item) => fromJsonNode(item));
  }
  return node.value;
}

// ─── 序列化函数 ───────────────────────────────────────────────────────────────

/** 序列化为紧凑 JSON 字符串（用于 onSave） */
export function serializeCompact(node: JsonNode): string {
  return JSON.stringify(fromJsonNode(node));
}

/** 序列化为格式化 JSON 字符串（用于 Raw 模式显示，缩进 2 空格） */
export function serializePretty(node: JsonNode): string {
  return JSON.stringify(fromJsonNode(node), null, 2);
}

// ─── 解析函数 ─────────────────────────────────────────────────────────────────

/** 安全解析 JSON 字符串，null 输入返回空对象节点 */
export function parseJsonSafe(
  str: string | null
): { ok: true; node: JsonNode } | { ok: false; error: string } {
  if (str === null) {
    return { ok: true, node: { type: "object", entries: [] } };
  }
  try {
    const parsed = JSON.parse(str);
    return { ok: true, node: toJsonNode(parsed) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── 不可变更新函数 ───────────────────────────────────────────────────────────

/** 不可变更新：在指定路径设置新值，路径不存在时返回原节点 */
export function updateAtPath(
  root: JsonNode,
  path: (string | number)[],
  newValue: JsonValue
): JsonNode {
  if (path.length === 0) {
    return toJsonNode(newValue);
  }

  const [head, ...tail] = path;

  if (root.type === "object" && typeof head === "string") {
    const idx = root.entries.findIndex((e) => e.key === head);
    if (idx === -1) return root; // path not found
    const newEntries = root.entries.map((entry, i) => {
      if (i !== idx) return entry;
      return {
        key: entry.key,
        value: tail.length === 0 ? toJsonNode(newValue) : updateAtPath(entry.value, tail, newValue),
      };
    });
    return { type: "object", entries: newEntries };
  }

  if (root.type === "array" && typeof head === "number") {
    if (head < 0 || head >= root.items.length) return root; // path not found
    const newItems = root.items.map((item, i) => {
      if (i !== head) return item;
      return tail.length === 0 ? toJsonNode(newValue) : updateAtPath(item, tail, newValue);
    });
    return { type: "array", items: newItems };
  }

  return root; // path not found
}

/** 不可变删除：移除指定路径的节点 */
export function deleteAtPath(
  root: JsonNode,
  path: (string | number)[]
): JsonNode {
  if (path.length === 0) return root;

  const [head, ...tail] = path;

  if (root.type === "object" && typeof head === "string") {
    if (tail.length === 0) {
      return {
        type: "object",
        entries: root.entries.filter((e) => e.key !== head),
      };
    }
    const idx = root.entries.findIndex((e) => e.key === head);
    if (idx === -1) return root;
    const newEntries = root.entries.map((entry, i) => {
      if (i !== idx) return entry;
      return { key: entry.key, value: deleteAtPath(entry.value, tail) };
    });
    return { type: "object", entries: newEntries };
  }

  if (root.type === "array" && typeof head === "number") {
    if (tail.length === 0) {
      return {
        type: "array",
        items: root.items.filter((_, i) => i !== head),
      };
    }
    if (head < 0 || head >= root.items.length) return root;
    const newItems = root.items.map((item, i) => {
      if (i !== head) return item;
      return deleteAtPath(item, tail);
    });
    return { type: "array", items: newItems };
  }

  return root;
}

// ─── PostgreSQL 路径构建 ──────────────────────────────────────────────────────

/**
 * 构建 PostgreSQL JSONB 路径字符串
 * 例：buildJsonPath("data", ["user", "name"], true) => "data->'user'->>'name'"
 */
export function buildJsonPath(
  columnName: string,
  path: (string | number)[],
  isLeaf: boolean
): string {
  if (path.length === 0) return columnName;

  let result = columnName;
  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    const isLast = i === path.length - 1;
    const op = isLast && isLeaf ? "->>" : "->";
    if (typeof segment === "number") {
      result += `->${segment}`;
    } else {
      result += `${op}'${segment}'`;
    }
  }
  return result;
}

// ─── 表单值解析 ───────────────────────────────────────────────────────────────

/**
 * 解析表单值输入字符串为 JsonValue
 * 优先级：null → boolean → number → JSON 对象/数组 → string
 */
export function parseFormValue(input: string): JsonValue {
  if (input === "null") return null;
  if (input === "true") return true;
  if (input === "false") return false;

  // 合法数字
  if (input.trim() !== "" && !isNaN(Number(input))) {
    return Number(input);
  }

  // 合法 JSON 对象或数组
  const trimmed = input.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed) as JsonValue;
    } catch {
      // fall through to string
    }
  }

  return input;
}

// ─── 语义等价判断 ─────────────────────────────────────────────────────────────

/** 判断两个 JsonNode 是否语义等价 */
export function jsonNodesEqual(a: JsonNode, b: JsonNode): boolean {
  if (a.type !== b.type) return false;

  if (a.type === "object" && b.type === "object") {
    if (a.entries.length !== b.entries.length) return false;
    for (let i = 0; i < a.entries.length; i++) {
      if (a.entries[i].key !== b.entries[i].key) return false;
      if (!jsonNodesEqual(a.entries[i].value, b.entries[i].value)) return false;
    }
    return true;
  }

  if (a.type === "array" && b.type === "array") {
    if (a.items.length !== b.items.length) return false;
    for (let i = 0; i < a.items.length; i++) {
      if (!jsonNodesEqual(a.items[i], b.items[i])) return false;
    }
    return true;
  }

  if (
    (a.type === "string" || a.type === "number" || a.type === "boolean" || a.type === "null") &&
    (b.type === "string" || b.type === "number" || b.type === "boolean" || b.type === "null")
  ) {
    return (a as JsonLeaf).value === (b as JsonLeaf).value;
  }

  return false;
}

// ─── 展开/折叠辅助函数 ────────────────────────────────────────────────────────

/** 当 type 为 object 或 array 时返回 true */
export function isExpandable(node: JsonNode): boolean {
  return node.type === "object" || node.type === "array";
}

/** depth ≤ 3 且为对象/数组时返回 true */
export function getInitialExpanded(node: JsonNode, depth: number): boolean {
  return depth <= 3 && isExpandable(node);
}

// ─── 值颜色映射 ───────────────────────────────────────────────────────────────

/** 根据 JSON 值类型返回颜色字符串 */
export function getValueColor(type: string): string {
  switch (type) {
    case "string":
      return "green";
    case "number":
      return "blue";
    case "boolean":
      return "orange";
    case "null":
      return "gray";
    default:
      return "";
  }
}
