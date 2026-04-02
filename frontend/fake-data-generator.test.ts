import { describe, test, expect } from "bun:test";
import {
  generateValueForColumn,
  isGeneratedStoredColumn,
  type TableColumn,
} from "./fake-data-generator";

function col(p: Partial<TableColumn> & Pick<TableColumn, "column_name" | "data_type">): TableColumn {
  return {
    is_nullable: "YES",
    ...p,
  };
}

describe("isGeneratedStoredColumn", () => {
  test("MySQL VIRTUAL GENERATED", () => {
    expect(isGeneratedStoredColumn(col({ column_name: "x", data_type: "int", identity_generation: "VIRTUAL GENERATED" }))).toBe(true);
  });
  test("MySQL STORED GENERATED", () => {
    expect(isGeneratedStoredColumn(col({ column_name: "x", data_type: "int", identity_generation: "STORED GENERATED" }))).toBe(true);
  });
  test("auto_increment is not skipped", () => {
    expect(isGeneratedStoredColumn(col({ column_name: "id", data_type: "bigint", identity_generation: "auto_increment" }))).toBe(false);
  });
});

describe("generateValueForColumn (MySQL-oriented)", () => {
  test("AUTO_INCREMENT returns null", () => {
    const v = generateValueForColumn(
      col({
        column_name: "id",
        data_type: "bigint",
        is_nullable: "NO",
        identity_generation: "auto_increment",
      }),
      0,
      { uniqueColumns: new Set(["id"]) }
    );
    expect(v).toBeNull();
  });

  test("datetime yields YYYY-MM-DD HH:mm:ss", () => {
    const v = generateValueForColumn(col({ column_name: "created", data_type: "datetime" }), 3) as string;
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  test("double type", () => {
    const v = generateValueForColumn(col({ column_name: "amt", data_type: "double" }), 0);
    expect(typeof v).toBe("number");
  });

  test("json type", () => {
    const v = generateValueForColumn(col({ column_name: "meta", data_type: "json" }), 1) as string;
    expect(() => JSON.parse(v)).not.toThrow();
  });

  test("year type", () => {
    const v = generateValueForColumn(col({ column_name: "y", data_type: "year" }), 0);
    expect(typeof v).toBe("number");
    expect(v).toBeGreaterThanOrEqual(2000);
  });
});
