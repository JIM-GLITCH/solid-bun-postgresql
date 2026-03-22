import { describe, test, expect } from "bun:test";
import { formatSql } from "./sql-format";

describe("formatSql", () => {
  test("preserves blank line between blocks", () => {
    const input = "SELECTa.id,  12315631\n\nSELECTa.id,  12315631";
    const result = formatSql(input);
    expect(result).toBe("SELECT\n  a.id,\n  12315631\n\nSELECT\n  a.id,\n  12315631");
  });
});
