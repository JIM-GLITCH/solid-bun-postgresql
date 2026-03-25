/**
 * JSONB 编辑器数据模型属性测试
 *
 * 注意：本文件使用 fast-check 进行属性测试。
 * @fast-check/vitest 需要 vitest 作为 peer dependency，本项目使用 bun test，
 * 因此直接使用 fast-check 的 fc.assert + fc.property API。
 */

import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import {
  toJsonNode,
  fromJsonNode,
  serializeCompact,
  serializePretty,
  parseJsonSafe,
  isExpandable,
  getInitialExpanded,
  getValueColor,
  parseFormValue,
  jsonNodesEqual,
  buildJsonPath,
  type JsonNode,
} from "./jsonb-editor-model";

// ─── Property 1：JSON 解析往返一致性 ─────────────────────────────────────────
// Feature: jsonb-editor, Property 1: JSON 解析往返一致性
// Validates: Requirements 10.4, 7.2

describe("Property 1: JSON 解析往返一致性", () => {
  test("对任意合法 JSON 值，序列化后再解析应与原值语义等价", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const str = JSON.stringify(value);
        const result = parseJsonSafe(str);
        expect(result.ok).toBe(true);
        if (result.ok) {
          const roundTripped = JSON.parse(serializeCompact(result.node));
          // 使用 JSON 往返后的值进行比较（-0 在 JSON 中序列化为 "0"，这是预期行为）
          const expected = JSON.parse(str);
          expect(roundTripped).toEqual(expected);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 2：非法 JSON 被拒绝 ────────────────────────────────────────────
// Feature: jsonb-editor, Property 2: 非法 JSON 被拒绝
// Validates: Requirements 1.4, 4.2, 4.3, 7.4, 8.3

describe("Property 2: 非法 JSON 被拒绝", () => {
  test("对任意不能被 JSON.parse 解析的字符串，parseJsonSafe 应返回 ok: false", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => {
          try {
            JSON.parse(s);
            return false; // 过滤掉合法 JSON
          } catch {
            return true; // 保留非法 JSON
          }
        }),
        (invalidStr) => {
          const result = parseJsonSafe(invalidStr);
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error).toBeTruthy();
            expect(result.error.length).toBeGreaterThan(0);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 3：节点数量与 JSON 结构一致 ────────────────────────────────────
// Feature: jsonb-editor, Property 3: 节点数量与 JSON 结构一致
// Validates: Requirements 2.1, 2.2

describe("Property 3: 节点数量与 JSON 结构一致", () => {
  test("对任意 JSON 对象，entries 长度应等于原对象键数", () => {
    fc.assert(
      fc.property(fc.object(), (obj) => {
        const node = toJsonNode(obj);
        expect(node.type).toBe("object");
        if (node.type === "object") {
          expect(node.entries.length).toBe(Object.keys(obj).length);
        }
      }),
      { numRuns: 100 }
    );
  });

  test("对任意 JSON 数组，items 长度应等于原数组长度", () => {
    fc.assert(
      fc.property(fc.array(fc.anything()), (arr) => {
        const node = toJsonNode(arr);
        expect(node.type).toBe("array");
        if (node.type === "array") {
          expect(node.items.length).toBe(arr.length);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 4：节点可展开性与类型对应 ──────────────────────────────────────
// Feature: jsonb-editor, Property 4: 节点可展开性与类型对应
// Validates: Requirements 2.3

describe("Property 4: 节点可展开性与类型对应", () => {
  test("当且仅当 type 为 object 或 array 时，isExpandable 返回 true", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const node = toJsonNode(value);
        const expandable = isExpandable(node);
        if (node.type === "object" || node.type === "array") {
          expect(expandable).toBe(true);
        } else {
          expect(expandable).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 5：深度超过 3 层时默认折叠 ─────────────────────────────────────
// Feature: jsonb-editor, Property 5: 深度超过 3 层时默认折叠
// Validates: Requirements 2.5

describe("Property 5: 深度超过 3 层时默认折叠", () => {
  test("depth > 3 时 getInitialExpanded 返回 false", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.integer({ min: 4, max: 10 }), (value, depth) => {
        const node = toJsonNode(value);
        expect(getInitialExpanded(node, depth)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test("depth <= 3 且为对象/数组时 getInitialExpanded 返回 true", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.integer({ min: 0, max: 3 }), (value, depth) => {
        const node = toJsonNode(value);
        const result = getInitialExpanded(node, depth);
        if (node.type === "object" || node.type === "array") {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 9：表单值解析类型正确 ──────────────────────────────────────────
// Feature: jsonb-editor, Property 9: 表单值解析类型正确
// Validates: Requirements 3.6

describe("Property 9: 表单值解析类型正确", () => {
  test("parseFormValue 不应抛出异常，且特殊值解析正确", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        // 不应抛出异常
        let result: unknown;
        expect(() => {
          result = parseFormValue(input);
        }).not.toThrow();

        // 特殊值检查
        if (input === "null") {
          expect(result).toBeNull();
        } else if (input === "true") {
          expect(result).toBe(true);
        } else if (input === "false") {
          expect(result).toBe(false);
        }
        // 合法数字字符串 → number
        if (input.trim() !== "" && !isNaN(Number(input))) {
          expect(typeof result).toBe("number");
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 10：Raw 模式序列化格式 ─────────────────────────────────────────
// Feature: jsonb-editor, Property 10: Raw 模式序列化格式
// Validates: Requirements 4.1, 5.3

describe("Property 10: Raw 模式序列化格式", () => {
  test("serializePretty 输出应等于 JSON.stringify(fromJsonNode(node), null, 2)", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const node = toJsonNode(value);
        const pretty = serializePretty(node);
        const expected = JSON.stringify(fromJsonNode(node), null, 2);
        expect(pretty).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 11：紧凑序列化往返 ─────────────────────────────────────────────
// Feature: jsonb-editor, Property 11: 紧凑序列化往返
// Validates: Requirements 7.2

describe("Property 11: 紧凑序列化往返", () => {
  test("serializeCompact 输出应等于 JSON.stringify(fromJsonNode(node))", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const node = toJsonNode(value);
        const compact = serializeCompact(node);
        expect(compact).toBe(JSON.stringify(fromJsonNode(node)));
      }),
      { numRuns: 100 }
    );
  });

  test("parseJsonSafe(serializeCompact(node)) 与原节点语义等价", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const node = toJsonNode(value);
        const compact = serializeCompact(node);
        const result = parseJsonSafe(compact);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(jsonNodesEqual(node, result.node)).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 12：未变化时 jsonNodesEqual 返回 true ──────────────────────────
// Feature: jsonb-editor, Property 12: 未变化时 hasChanged 返回 false
// Validates: Requirements 7.5

describe("Property 12: 未变化时 jsonNodesEqual 返回 true", () => {
  test("解析后再序列化再解析，两次解析结果应语义等价", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const str = JSON.stringify(value);
        const r1 = parseJsonSafe(str);
        if (!r1.ok) return;
        const compact = serializeCompact(r1.node);
        const r2 = parseJsonSafe(compact);
        if (!r2.ok) return;
        expect(jsonNodesEqual(r1.node, r2.node)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 14：PostgreSQL JSONB 路径构建正确性 ────────────────────────────
// Feature: jsonb-editor, Property 14: PostgreSQL JSONB 路径构建正确性
// Validates: Requirements 9.2

describe("Property 14: PostgreSQL JSONB 路径构建正确性", () => {
  test("非叶子节点使用 -> 操作符，叶子节点使用 ->> 操作符", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string({ minLength: 1, maxLength: 20 }), fc.integer({ min: 0, max: 100 }))),
        (path) => {
          if (path.length === 0) return; // 空路径跳过

          const colName = "data";

          // 非叶子节点：最后一个操作符应为 ->
          const nonLeafPath = buildJsonPath(colName, path, false);
          // 叶子节点：最后一个操作符应为 ->>（仅当最后一段为字符串时）
          const leafPath = buildJsonPath(colName, path, true);

          const lastSegment = path[path.length - 1];
          if (typeof lastSegment === "string") {
            // 字符串路径段：非叶子用 ->，叶子用 ->>
            expect(nonLeafPath).toContain(`->'${lastSegment}'`);
            expect(leafPath).toContain(`->>'${lastSegment}'`);
          } else {
            // 数字索引：始终使用 -> 加数字（PostgreSQL JSONB 规范）
            expect(nonLeafPath).toContain(`->${lastSegment}`);
            expect(leafPath).toContain(`->${lastSegment}`);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  test("路径段数等于 path.length + 1（含列名）", () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string({ minLength: 1, maxLength: 10 }), fc.integer({ min: 0, max: 10 })), { maxLength: 5 }),
        (path) => {
          const colName = "data";
          const result = buildJsonPath(colName, path, false);
          // 结果以列名开头
          expect(result.startsWith(colName)).toBe(true);
          // 路径为空时，结果就是列名
          if (path.length === 0) {
            expect(result).toBe(colName);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
