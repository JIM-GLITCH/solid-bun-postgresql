import { describe, expect, test } from "bun:test";
import { formatSqlValue } from "./format-cell";

describe("formatSqlValue 不应把字符串 null 误判为 SQL NULL", () => {
  test("PostgreSQL：字符串 'null' 保留为字符串字面量", () => {
    expect(formatSqlValue("null", undefined, "postgres")).toBe("'null'");
    expect(formatSqlValue("NULL", undefined, "postgres")).toBe("'NULL'");
    expect(formatSqlValue("Null", undefined, "postgres")).toBe("'Null'");
  });

  test("MySQL/SQLServer：字符串 'null' 保留为字符串字面量", () => {
    expect(formatSqlValue("null", undefined, "mysql")).toBe("'null'");
    expect(formatSqlValue("null", undefined, "sqlserver")).toBe("'null'");
  });

  test("JS null / undefined 仍映射为 SQL NULL", () => {
    expect(formatSqlValue(null, undefined, "postgres")).toBe("NULL");
    expect(formatSqlValue(undefined, undefined, "mysql")).toBe("NULL");
  });

  test("JSONB/JSON 字符串 'null' 仍是 JSON 字面量（非 SQL NULL）", () => {
    expect(formatSqlValue("null", 3802, "postgres")).toBe("'null'::jsonb");
    expect(formatSqlValue("null", 114, "postgres")).toBe("'null'");
  });
});
