import type { DatabaseCapabilities } from "../shared/src";
import { defaultDatabaseCapabilities } from "../shared/src";
import { getRegisteredDbType } from "./db-session-meta";

/** 服务端 `db/capabilities` 快照；断开连接时清除 */
const serverCapabilitiesByConnection = new Map<string, DatabaseCapabilities>();

export function registerServerCapabilities(connectionId: string, caps: DatabaseCapabilities): void {
  serverCapabilitiesByConnection.set(connectionId, caps);
}

export function clearServerCapabilities(connectionId: string): void {
  serverCapabilitiesByConnection.delete(connectionId);
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
