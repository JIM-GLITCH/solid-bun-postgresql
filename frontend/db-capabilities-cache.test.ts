import { describe, expect, test, beforeAll } from "bun:test";
import { defaultDatabaseCapabilities, type DbKind } from "../shared/src";

function installSessionStorage(): void {
  const mem = new Map<string, string>();
  (globalThis as unknown as { sessionStorage: Storage }).sessionStorage = {
    get length() {
      return mem.size;
    },
    clear() {
      mem.clear();
    },
    getItem(key: string) {
      return mem.get(key) ?? null;
    },
    key(i: number) {
      return [...mem.keys()][i] ?? null;
    },
    removeItem(key: string) {
      mem.delete(key);
    },
    setItem(key: string, value: string) {
      mem.set(key, value);
    },
  };
}

describe("db-capabilities-cache", () => {
  let registerConnectionDbType: (id: string, k: DbKind) => void;
  let unregisterConnectionDbType: (id: string) => void;
  let registerServerCapabilities: (id: string, caps: import("../shared/src").DatabaseCapabilities) => void;
  let clearServerCapabilities: (id: string) => void;
  let getEffectiveDbCapabilities: (id: string | null | undefined) => import("../shared/src").DatabaseCapabilities;

  beforeAll(async () => {
    installSessionStorage();
    const cache = await import("./db-capabilities-cache");
    const meta = await import("./db-session-meta");
    registerConnectionDbType = meta.registerConnectionDbType;
    unregisterConnectionDbType = meta.unregisterConnectionDbType;
    registerServerCapabilities = cache.registerServerCapabilities;
    clearServerCapabilities = cache.clearServerCapabilities;
    getEffectiveDbCapabilities = cache.getEffectiveDbCapabilities;
  });

  test("无 connectionId 时回退 postgres 默认矩阵", () => {
    const c = getEffectiveDbCapabilities(null);
    expect(c.dialect).toBe("postgres");
    expect(c.sessionMonitor).toBe(true);
  });

  test("按 session 登记的 dbType 在未命中服务端快照时回退默认矩阵", () => {
    const id = "cap-test-mysql";
    registerConnectionDbType(id, "mysql");
    const c = getEffectiveDbCapabilities(id);
    expect(c.dialect).toBe("mysql");
    expect(c.sessionMonitor).toBe(true);
    unregisterConnectionDbType(id);
  });

  test("mariadb 登记后回退矩阵 dialect 为 mariadb", () => {
    const id = "cap-test-mariadb";
    registerConnectionDbType(id, "mariadb");
    expect(getEffectiveDbCapabilities(id).dialect).toBe("mariadb");
    unregisterConnectionDbType(id);
  });

  test("registerServerCapabilities 优先；clear 后回退登记方言默认矩阵", () => {
    const id = "cap-test-snap";
    registerConnectionDbType(id, "postgres");
    const snap = { ...defaultDatabaseCapabilities("postgres"), sessionMonitor: false };
    registerServerCapabilities(id, snap);
    expect(getEffectiveDbCapabilities(id).sessionMonitor).toBe(false);
    clearServerCapabilities(id);
    expect(getEffectiveDbCapabilities(id).sessionMonitor).toBe(true);
    unregisterConnectionDbType(id);
  });
});
