import { describe, expect, test } from "bun:test";
import { extractNamedParams } from "./sqlserver-strategy-effect";

describe("extractNamedParams（SQL Server 命名参数提取）", () => {
  test("按出现顺序提取，去重", () => {
    expect(extractNamedParams("SELECT * FROM t WHERE a = @sch AND b = @tbl")).toEqual(["sch", "tbl"]);
    expect(extractNamedParams("WHERE a = @x OR b = @x")).toEqual(["x"]);
  });

  test("跳过单引号字符串字面量内的 @（含 '' 转义）", () => {
    expect(extractNamedParams("SELECT '@sch' AS literal WHERE t = @tbl")).toEqual(["tbl"]);
    expect(extractNamedParams("SELECT 'it''s @sch ok' WHERE t = @tbl")).toEqual(["tbl"]);
  });

  test("无参数时返回空数组", () => {
    expect(extractNamedParams("SELECT 1")).toEqual([]);
    expect(extractNamedParams("SELECT @@ROWCOUNT")).toEqual(["ROWCOUNT"]);
  });

  test("@ 后非标识符字符时不匹配", () => {
    expect(extractNamedParams("a = @1invalid")).toEqual([]);
    expect(extractNamedParams("a = @")).toEqual([]);
    expect(extractNamedParams("a = @-b")).toEqual([]);
  });

  test("系统变量 @@ROWCOUNT 被识别（仅在传入参数时才会注册，无参查询不绑定）", () => {
    expect(extractNamedParams("SELECT @@ROWCOUNT")).toEqual(["ROWCOUNT"]);
  });

  test("N'...' unicode 字符串字面量同样跳过", () => {
    expect(extractNamedParams("WHERE name = N'@sch' AND s = @sch")).toEqual(["sch"]);
  });
});
