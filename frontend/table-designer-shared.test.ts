/**
 * 表设计器共享逻辑单元测试
 * 测试 buildDdlStatements、validateDesignerState、autoIndexName 等核心函数
 */

import { describe, test, expect } from "bun:test";
import {
  needsLength,
  needsPrecision,
  autoIndexName,
  validateDesignerState,
  buildDdlStatements,
  formatDefaultValue,
  type TableColumn,
  type IndexDef,
  type ForeignKeyDef,
  type UniqueConstraintDef,
  type CheckConstraintDef,
  type OriginalState,
} from "./table-designer-shared";

// ─── Helper factories ─────────────────────────────────────────────────────────

function makeColumn(overrides: Partial<TableColumn> = {}): TableColumn {
  return {
    name: "col1",
    dataType: "text",
    nullable: true,
    primaryKey: false,
    defaultValue: "",
    ...overrides,
  };
}

function emptyOriginal(): OriginalState {
  return {
    tableName: "",
    tableComment: "",
    columns: [],
    indexes: [],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
  };
}

// ─── needsLength ──────────────────────────────────────────────────────────────

describe("needsLength", () => {
  test("returns true for varchar", () => expect(needsLength("varchar")).toBe(true));
  test("returns true for char", () => expect(needsLength("char")).toBe(true));
  test("returns true for character varying", () => expect(needsLength("character varying")).toBe(true));
  test("returns false for text", () => expect(needsLength("text")).toBe(false));
  test("returns false for integer", () => expect(needsLength("integer")).toBe(false));
  test("returns false for numeric", () => expect(needsLength("numeric")).toBe(false));
});

// ─── needsPrecision ───────────────────────────────────────────────────────────

describe("needsPrecision", () => {
  test("returns true for numeric", () => expect(needsPrecision("numeric")).toBe(true));
  test("returns true for decimal", () => expect(needsPrecision("decimal")).toBe(true));
  test("returns false for varchar", () => expect(needsPrecision("varchar")).toBe(false));
  test("returns false for text", () => expect(needsPrecision("text")).toBe(false));
  test("returns false for integer", () => expect(needsPrecision("integer")).toBe(false));
});

// ─── autoIndexName ────────────────────────────────────────────────────────────

describe("autoIndexName", () => {
  test("single column", () => {
    expect(autoIndexName("users", ["email"])).toBe("idx_users_email");
  });
  test("multiple columns joined with underscore", () => {
    expect(autoIndexName("orders", ["user_id", "status"])).toBe("idx_orders_user_id_status");
  });
  test("filters empty column names", () => {
    expect(autoIndexName("t", ["a", "", "b"])).toBe("idx_t_a_b");
  });
  test("format: idx_{tableName}_{colName}", () => {
    const result = autoIndexName("my_table", ["my_col"]);
    expect(result).toMatch(/^idx_my_table_my_col$/);
  });
});

// ─── formatDefaultValue ───────────────────────────────────────────────────────

describe("formatDefaultValue", () => {
  test("numeric literal stays raw", () => expect(formatDefaultValue("42")).toBe("42"));
  test("now() stays raw", () => expect(formatDefaultValue("now()")).toBe("now()"));
  test("true stays raw", () => expect(formatDefaultValue("true")).toBe("true"));
  test("null stays raw", () => expect(formatDefaultValue("null")).toBe("null"));
  test("string value gets quoted", () => expect(formatDefaultValue("hello")).toBe("'hello'"));
  test("string with single quote gets escaped", () => expect(formatDefaultValue("it's")).toBe("'it''s'"));
});

// ─── validateDesignerState ────────────────────────────────────────────────────

describe("validateDesignerState", () => {
  test("create mode: empty table name returns error", () => {
    const errors = validateDesignerState({
      tableName: "",
      mode: "create",
      columns: [makeColumn({ name: "id" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors).toContain("表名不能为空");
  });

  test("edit mode: empty table name is allowed", () => {
    const errors = validateDesignerState({
      tableName: "",
      mode: "edit",
      columns: [makeColumn({ name: "id" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors).not.toContain("表名不能为空");
  });

  test("empty column name returns error", () => {
    const errors = validateDesignerState({
      tableName: "t",
      mode: "create",
      columns: [makeColumn({ name: "" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors).toContain("列名不能为空");
  });

  test("duplicate column names (case-insensitive) returns error", () => {
    const errors = validateDesignerState({
      tableName: "t",
      mode: "create",
      columns: [makeColumn({ name: "Col" }), makeColumn({ name: "col" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors.some((e) => e.includes("列名重复"))).toBe(true);
  });

  test("index with empty columns returns error", () => {
    const idx: IndexDef = { name: "idx_t_x", indexType: "BTREE", columns: [], unique: false, isNew: true };
    const errors = validateDesignerState({
      tableName: "t",
      mode: "create",
      columns: [makeColumn({ name: "id" })],
      indexes: [idx],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors.some((e) => e.includes("列不能为空"))).toBe(true);
  });

  test("index marked toDelete with empty columns does NOT error", () => {
    const idx: IndexDef = { name: "idx_t_x", indexType: "BTREE", columns: [], unique: false, toDelete: true };
    const errors = validateDesignerState({
      tableName: "t",
      mode: "edit",
      columns: [makeColumn({ name: "id" })],
      indexes: [idx],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors.some((e) => e.includes("列不能为空"))).toBe(false);
  });

  test("incomplete foreign key returns error", () => {
    const fk: ForeignKeyDef = {
      column: "user_id",
      refSchema: "public",
      refTable: "",
      refColumn: "",
      onDelete: "NO ACTION",
      onUpdate: "NO ACTION",
      isNew: true,
    };
    const errors = validateDesignerState({
      tableName: "t",
      mode: "create",
      columns: [makeColumn({ name: "user_id" })],
      indexes: [],
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors).toContain("外键定义不完整");
  });

  test("empty check constraint expression returns error", () => {
    const chk: CheckConstraintDef = { expression: "", isNew: true };
    const errors = validateDesignerState({
      tableName: "t",
      mode: "create",
      columns: [makeColumn({ name: "id" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [chk],
    });
    expect(errors).toContain("检查约束表达式不能为空");
  });

  test("valid state returns no errors", () => {
    const errors = validateDesignerState({
      tableName: "users",
      mode: "create",
      columns: [makeColumn({ name: "id" }), makeColumn({ name: "email" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(errors).toHaveLength(0);
  });
});

// ─── buildDdlStatements — create mode ────────────────────────────────────────

describe("buildDdlStatements (create mode)", () => {
  test("generates CREATE TABLE with columns", () => {
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "id", dataType: "integer", nullable: false, primaryKey: true })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts[0]).toMatch(/CREATE TABLE "public"\."users"/);
    expect(stmts[0]).toMatch(/"id" integer NOT NULL PRIMARY KEY/);
  });

  test("MySQL dialect: backticks, AUTO_INCREMENT, PRIMARY KEY clause", () => {
    const stmts = buildDdlStatements("mydb", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [
        makeColumn({
          name: "id",
          dataType: "bigint",
          nullable: false,
          primaryKey: true,
          autoIncrement: true,
        }),
      ],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    }, "mysql");
    expect(stmts[0]).toContain("CREATE TABLE `mydb`.`users`");
    expect(stmts[0]).toContain("`id` bigint NOT NULL AUTO_INCREMENT");
    expect(stmts[0]).toContain("PRIMARY KEY (`id`)");
    expect(stmts[0]).not.toContain("GENERATED ALWAYS AS IDENTITY");
  });

  test("generates COMMENT ON TABLE when tableComment is set", () => {
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "用户表",
      columns: [makeColumn({ name: "id" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("COMMENT ON TABLE") && s.includes("用户表"))).toBe(true);
  });

  test("generates COMMENT ON COLUMN when column has comment", () => {
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "email", comment: "邮箱" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("COMMENT ON COLUMN") && s.includes("邮箱"))).toBe(true);
  });

  test("no COMMENT ON COLUMN when column has no comment", () => {
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "email" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("COMMENT ON COLUMN"))).toBe(false);
  });

  test("generates CREATE INDEX for new index", () => {
    const idx: IndexDef = { name: "idx_users_email", indexType: "BTREE", columns: ["email"], unique: true, isNew: true };
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "email" })],
      indexes: [idx],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("CREATE UNIQUE INDEX") && s.includes("idx_users_email"))).toBe(true);
  });

  test("auto-generates index name when name is empty", () => {
    const idx: IndexDef = { name: "", indexType: "BTREE", columns: ["email"], unique: false, isNew: true };
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "email" })],
      indexes: [idx],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("idx_users_email"))).toBe(true);
  });

  test("generates ADD CONSTRAINT FOREIGN KEY for new FK", () => {
    const fk: ForeignKeyDef = {
      column: "user_id",
      refSchema: "public",
      refTable: "users",
      refColumn: "id",
      onDelete: "CASCADE",
      onUpdate: "NO ACTION",
      isNew: true,
    };
    const stmts = buildDdlStatements("public", "orders", "create", emptyOriginal(), {
      tableName: "orders",
      tableComment: "",
      columns: [makeColumn({ name: "user_id" })],
      indexes: [],
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("FOREIGN KEY") && s.includes("CASCADE"))).toBe(true);
  });

  test("generates ADD CONSTRAINT UNIQUE for unique constraint", () => {
    const uq: UniqueConstraintDef = { constraintName: "uq_users_email", columns: "email", isNew: true };
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "email" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [uq],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("UNIQUE") && s.includes("uq_users_email"))).toBe(true);
  });

  test("generates ADD CONSTRAINT CHECK for check constraint", () => {
    const chk: CheckConstraintDef = { constraintName: "chk_age", expression: "age > 0", isNew: true };
    const stmts = buildDdlStatements("public", "users", "create", emptyOriginal(), {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "age" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [chk],
    });
    expect(stmts.some((s) => s.includes("CHECK") && s.includes("age > 0"))).toBe(true);
  });
});

// ─── buildDdlStatements — edit mode ──────────────────────────────────────────

describe("buildDdlStatements (edit mode)", () => {
  test("returns empty array when nothing changed", () => {
    const col = makeColumn({ name: "id", dataType: "integer", isNew: false });
    const original: OriginalState = {
      tableName: "users",
      tableComment: "",
      columns: [col],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "users", "edit", original, {
      tableName: "users",
      tableComment: "",
      columns: [col],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts).toHaveLength(0);
  });

  test("generates ADD COLUMN for new column", () => {
    const original: OriginalState = {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "id" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "users", "edit", original, {
      tableName: "users",
      tableComment: "",
      columns: [
        makeColumn({ name: "id" }),
        makeColumn({ name: "email", dataType: "varchar", isNew: true }),
      ],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("ADD COLUMN") && s.includes('"email"'))).toBe(true);
  });

  test("generates DROP COLUMN for removed column", () => {
    const col = makeColumn({ name: "email" });
    const original: OriginalState = {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "id" }), col],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "users", "edit", original, {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "id" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("DROP COLUMN") && s.includes('"email"'))).toBe(true);
  });

  test("generates RENAME COLUMN when originalName differs from name", () => {
    const col = makeColumn({ name: "email_address", originalName: "email" });
    const original: OriginalState = {
      tableName: "users",
      tableComment: "",
      columns: [makeColumn({ name: "email" })],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "users", "edit", original, {
      tableName: "users",
      tableComment: "",
      columns: [col],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("RENAME COLUMN") && s.includes('"email"') && s.includes('"email_address"'))).toBe(true);
  });

  test("generates DROP INDEX for toDelete index", () => {
    const idx: IndexDef = { name: "idx_users_email", indexType: "BTREE", columns: ["email"], unique: false, isExisting: true, toDelete: true };
    const original: OriginalState = {
      tableName: "users",
      tableComment: "",
      columns: [],
      indexes: [idx],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "users", "edit", original, {
      tableName: "users",
      tableComment: "",
      columns: [],
      indexes: [idx],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("DROP INDEX") && s.includes("idx_users_email"))).toBe(true);
  });

  test("generates DROP CONSTRAINT for toDelete foreign key", () => {
    const fk: ForeignKeyDef = {
      constraintName: "fk_orders_user_id",
      column: "user_id",
      refSchema: "public",
      refTable: "users",
      refColumn: "id",
      onDelete: "NO ACTION",
      onUpdate: "NO ACTION",
      isExisting: true,
      toDelete: true,
    };
    const original: OriginalState = {
      tableName: "orders",
      tableComment: "",
      columns: [],
      indexes: [],
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "orders", "edit", original, {
      tableName: "orders",
      tableComment: "",
      columns: [],
      indexes: [],
      foreignKeys: [fk],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("DROP CONSTRAINT") && s.includes("fk_orders_user_id"))).toBe(true);
  });

  test("generates COMMENT ON TABLE when comment changes", () => {
    const original: OriginalState = {
      tableName: "users",
      tableComment: "",
      columns: [],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "users", "edit", original, {
      tableName: "users",
      tableComment: "用户表",
      columns: [],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("COMMENT ON TABLE") && s.includes("用户表"))).toBe(true);
  });

  test("generates COMMENT ON COLUMN IS NULL when comment cleared", () => {
    const col = makeColumn({ name: "email", comment: "邮箱" });
    const original: OriginalState = {
      tableName: "users",
      tableComment: "",
      columns: [col],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const updatedCol = { ...col, comment: "" };
    const stmts = buildDdlStatements("public", "users", "edit", original, {
      tableName: "users",
      tableComment: "",
      columns: [updatedCol],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    expect(stmts.some((s) => s.includes("COMMENT ON COLUMN") && s.includes("IS NULL"))).toBe(true);
  });

  test("DDL order: ADD COLUMN before RENAME COLUMN before DROP CONSTRAINT before ADD CONSTRAINT before DROP INDEX before ADD INDEX before COMMENT", () => {
    const existingCol = makeColumn({ name: "old_name" });
    const renamedCol = makeColumn({ name: "new_name", originalName: "old_name" });
    const newCol = makeColumn({ name: "extra", isNew: true });
    const newIdx: IndexDef = { name: "idx_t_extra", indexType: "BTREE", columns: ["extra"], unique: false, isNew: true };

    const original: OriginalState = {
      tableName: "t",
      tableComment: "",
      columns: [existingCol],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };

    const stmts = buildDdlStatements("public", "t", "edit", original, {
      tableName: "t",
      tableComment: "new comment",
      columns: [renamedCol, newCol],
      indexes: [newIdx],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });

    const addColIdx = stmts.findIndex((s) => s.includes("ADD COLUMN"));
    const renameIdx = stmts.findIndex((s) => s.includes("RENAME COLUMN"));
    const createIdxIdx = stmts.findIndex((s) => s.includes("CREATE") && s.includes("INDEX"));
    const commentIdx = stmts.findIndex((s) => s.includes("COMMENT ON TABLE"));

    expect(addColIdx).toBeGreaterThanOrEqual(0);
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(createIdxIdx).toBeGreaterThanOrEqual(0);
    expect(commentIdx).toBeGreaterThanOrEqual(0);

    // ADD COLUMN before RENAME COLUMN
    expect(addColIdx).toBeLessThan(renameIdx);
    // RENAME COLUMN before CREATE INDEX
    expect(renameIdx).toBeLessThan(createIdxIdx);
    // CREATE INDEX before COMMENT
    expect(createIdxIdx).toBeLessThan(commentIdx);
  });

  test("rename PK column only: no DROP/ADD PRIMARY KEY", () => {
    const original: OriginalState = {
      tableName: "deadlock_demo",
      tableComment: "",
      columns: [
        makeColumn({ name: "id", dataType: "integer", nullable: false, primaryKey: true }),
      ],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    };
    const stmts = buildDdlStatements("public", "deadlock_demo", "edit", original, {
      tableName: "deadlock_demo",
      tableComment: "",
      columns: [
        makeColumn({
          name: "id1",
          originalName: "id",
          dataType: "integer",
          nullable: false,
          primaryKey: true,
        }),
      ],
      indexes: [],
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
    });
    const renameIdx = stmts.findIndex((s) => s.includes("RENAME COLUMN") && s.includes('"id"') && s.includes('"id1"'));
    const addPkIdx = stmts.findIndex((s) => s.includes("ADD PRIMARY KEY"));
    const dropPkIdx = stmts.findIndex((s) => s.includes("DROP CONSTRAINT") && s.includes('"deadlock_demo_pkey"'));
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(addPkIdx).toBe(-1);
    expect(dropPkIdx).toBe(-1);
  });
});
