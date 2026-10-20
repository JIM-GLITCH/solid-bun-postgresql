import { describe, expect, test } from "bun:test";
import { mysqlStrategy } from "./mysql-strategy-effect";
import { postgresStrategy } from "./postgres-strategy-effect";
import { sqlserverStrategy } from "./sqlserver-strategy-effect";

const columns = ["id", "name"];

describe("buildInsertSQL 多行插入", () => {
  const rows = [
    [1, "a"],
    [2, "b"],
    [3, "c"],
  ];

  test("postgres: 每行一组占位符，参数按行优先编号，限定表名分段加引号", () => {
    const { sql, values } = postgresStrategy.buildInsertSQL({
      table: "public.users",
      columns,
      values: rows,
    });
    expect(sql).toBe('INSERT INTO "public"."users" ("id", "name") VALUES ($1, $2), ($3, $4), ($5, $6)');
    expect(values).toEqual([1, "a", 2, "b", 3, "c"]);
  });

  test("mysql: ? 占位符按行展开，限定表名分段加反引号", () => {
    const { sql, values } = mysqlStrategy.buildInsertSQL({
      table: "app.users",
      columns,
      values: rows,
    });
    expect(sql).toBe("INSERT INTO `app`.`users` (`id`, `name`) VALUES (?, ?), (?, ?), (?, ?)");
    expect(values).toEqual([1, "a", 2, "b", 3, "c"]);
  });

  test("sqlserver: @paramN 按行优先编号，限定表名分段加方括号", () => {
    const { sql, values } = sqlserverStrategy.buildInsertSQL({
      table: "dbo.users",
      columns,
      values: rows,
    });
    expect(sql).toBe(
      "INSERT INTO [dbo].[users] ([id], [name]) VALUES (@param0, @param1), (@param2, @param3), (@param4, @param5)"
    );
    expect(values).toEqual([1, "a", 2, "b", 3, "c"]);
  });

  test("占位符数量与 values 数量严格一致（修复 import-rows 参数错配回归）", () => {
    for (const strategy of [postgresStrategy, mysqlStrategy, sqlserverStrategy]) {
      const { sql, values } = strategy.buildInsertSQL({ table: "s.t", columns, values: rows });
      const placeholders = sql.match(/\$\d+|\?|@param\d+/g) ?? [];
      expect(placeholders.length).toBe(values.length);
      expect(values.length).toBe(rows.length * columns.length);
    }
  });

  test("过滤列数不完整的行", () => {
    const { sql, values } = postgresStrategy.buildInsertSQL({
      table: "t",
      columns,
      values: [[1, "a"], [2]],
    });
    expect(sql).toBe('INSERT INTO "t" ("id", "name") VALUES ($1, $2)');
    expect(values).toEqual([1, "a"]);
  });

  test("单行行为兼容旧调用方", () => {
    const { sql, values } = postgresStrategy.buildInsertSQL({ table: "t", columns, values: [[1, "a"]] });
    expect(sql).toBe('INSERT INTO "t" ("id", "name") VALUES ($1, $2)');
    expect(values).toEqual([1, "a"]);
  });

  test("含特殊字符的段内转义，不破坏限定名", () => {
    const { sql } = postgresStrategy.buildInsertSQL({
      table: 'public.my"table',
      columns,
      values: [[1, "a"]],
    });
    expect(sql).toBe('INSERT INTO "public"."my""table" ("id", "name") VALUES ($1, $2)');
  });
});
