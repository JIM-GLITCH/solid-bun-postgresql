import { describe, test, expect } from "bun:test";
import * as fc from "fast-check";
import { formatSql } from "./sql-format";
import { formatSqlValue } from "./format-cell";

describe("formatSql", () => {
  test("preserves blank line between blocks", () => {
    const input = "SELECT a.id,  12315631\n\nSELECT a.id,  12315631";
    const result = formatSql(input, { "formatByBlock": true });
    expect(result).toBe("SELECT\n  a.id,\n  12315631\n\nSELECT\n  a.id,\n  12315631");
  });
});

// Property 13: JSONB SQL 格式化包含类型转换
// Validates: Requirements 10.3
describe("formatSqlValue - Property 13: JSONB SQL 格式化包含类型转换", () => {
  test("对任意合法 JSON 值，formatSqlValue(JSON.stringify(value), 3802) 输出包含 ::jsonb 后缀且 JSON 语义等价", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const jsonStr = JSON.stringify(value);
        const result = formatSqlValue(jsonStr, 3802);

        // 输出必须包含 ::jsonb 后缀
        expect(result.endsWith("::jsonb")).toBe(true);

        // 提取单引号内的 JSON 字符串部分（去掉首尾的 ' 和 ::jsonb）
        // 格式为 '...'::jsonb，需要还原转义的单引号 '' -> '
        const inner = result.slice(1, result.length - "::jsonb".length - 1).replace(/''/g, "'");
        const parsed = JSON.parse(inner);
        expect(parsed).toEqual(value);
      }),
      { numRuns: 100 }
    );
  });
});
