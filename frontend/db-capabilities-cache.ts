import type { DatabaseCapabilities } from "../shared/src";
import { defaultDatabaseCapabilities } from "../shared/src";
import { getRegisteredDbType } from "./db-session-meta";

/** 服务端 `db/capabilities` 快照；断开连接时清除 */
const serverCapabilitiesByConnection = new Map<string, DatabaseCapabilities>();

/** 建连后 `db/data-types` 预取结果，供表设计器等复用 */
const serverDataTypesByConnection = new Map<string, string[]>();

export function registerServerCapabilities(connectionId: string, caps: DatabaseCapabilities): void {
  serverCapabilitiesByConnection.set(connectionId, caps);
}

export function registerServerDataTypes(connectionId: string, types: string[]): void {
  if (types.length > 0) serverDataTypesByConnection.set(connectionId, types);
}

/** 已预取或曾写入缓存的类型列表；无则 undefined */
export function getCachedDataTypes(connectionId: string): string[] | undefined {
  const t = serverDataTypesByConnection.get(connectionId);
  return t && t.length > 0 ? t : undefined;
}

export function clearServerCapabilities(connectionId: string): void {
  serverCapabilitiesByConnection.delete(connectionId);
  serverDataTypesByConnection.delete(connectionId);
}

/** 优先用服务端返回；未拉取到则用当前登记方言的默认矩阵 */
export function getEffectiveDbCapabilities(connectionId: string | null | undefined): DatabaseCapabilities {
  if (!connectionId) {
    return defaultDatabaseCapabilities("postgres");
  }
  const hit = serverCapabilitiesByConnection.get(connectionId);
  if (hit) return hit;
  return defaultDatabaseCapabilities(getRegisteredDbType(connectionId));
}
