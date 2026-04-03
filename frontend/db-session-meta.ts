import { type DbKind, isMysqlFamily } from "../shared/src";

const STORAGE_KEY = "solid-db-conn-kinds";

function readStorage(): Map<string, DbKind> {
  if (typeof sessionStorage === "undefined") return new Map();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, DbKind>;
    return new Map(
      Object.entries(obj).filter(
        ([, v]) => v === "postgres" || v === "mysql" || v === "mariadb" || v === "sqlserver"
      )
    );
  } catch {
    return new Map();
  }
}

function persist(): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(connectionDbKind)));
  } catch {
    /* quota / 隐私模式 */
  }
}

const connectionDbKind = readStorage();

export function registerConnectionDbType(connectionId: string, dbType: DbKind): void {
  connectionDbKind.set(connectionId, dbType);
  persist();
}

export function unregisterConnectionDbType(connectionId: string): void {
  connectionDbKind.delete(connectionId);
  persist();
}

export function getRegisteredDbType(connectionId: string): DbKind {
  return connectionDbKind.get(connectionId) ?? "postgres";
}
