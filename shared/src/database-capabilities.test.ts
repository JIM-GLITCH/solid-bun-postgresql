import { describe, expect, test } from "bun:test";
import { defaultDatabaseCapabilities } from "./database-capabilities";

describe("defaultDatabaseCapabilities", () => {
  test("postgres 开启管理与流式", () => {
    const c = defaultDatabaseCapabilities("postgres");
    expect(c.dialect).toBe("postgres");
    expect(c.sessionMonitor).toBe(true);
    expect(c.pgExtensionCatalog).toBe(true);
    expect(c.streamingQuery).toBe(true);
    expect(c.cancelQuery).toBe(true);
    expect(c.explainAnalyzeJson).toBe(true);
  });

  test("mysql 会话监控开启、扩展目录关闭", () => {
    const c = defaultDatabaseCapabilities("mysql");
    expect(c.dialect).toBe("mysql");
    expect(c.sessionMonitor).toBe(true);
    expect(c.pgExtensionCatalog).toBe(false);
    expect(c.streamingQuery).toBe(true);
  });

  test("mariadb 与 mysql 能力矩阵一致、方言为 mariadb", () => {
    const c = defaultDatabaseCapabilities("mariadb");
    expect(c.dialect).toBe("mariadb");
    expect(c.sessionMonitor).toBe(true);
    expect(c.pgExtensionCatalog).toBe(false);
    expect(c.streamingQuery).toBe(true);
  });
});
