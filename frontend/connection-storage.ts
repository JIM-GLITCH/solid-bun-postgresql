/**
 * 数据库连接持久化 - 调用服务端 API（服务端加密存储）
 */

import type { PostgresLoginParams, StoredConnectionParams, DbKind } from "../shared/src";
import { registerConnectionDbType } from "./db-session-meta";
import { getTransport } from "./transport";

export interface StoredConnection {
  id: string;
  label: string;
  enc?: string;
  name?: string;
}

/** 连接列表：扁平结构 */
export type ConnectionList = StoredConnection[];

/** 从列表中查找连接 */
export function findStoredConnection(list: ConnectionList, id: string): StoredConnection | undefined {
  return list.find((x) => x.id === id);
}

/** 检查连接是否在列表中 */
export function hasStoredConnection(list: ConnectionList, id: string): boolean {
  return list.some((x) => x.id === id);
}

/** 加载已保存连接列表 */
export async function loadStoredConnections(): Promise<ConnectionList> {
  try {
    const arr = await getTransport().request("connections/list", {});
    return Array.isArray(arr) ? (arr as ConnectionList) : [];
  } catch {
    return [];
  }
}

/** 保存连接到服务端（服务端加密存储） */
export async function saveConnection(
  id: string,
  params: PostgresLoginParams | StoredConnectionParams,
  meta?: { name?: string }
): Promise<void> {
  const dbType = (params as StoredConnectionParams).dbType ?? "postgres";
  const data = await getTransport().request("connections/save", { id, ...params, dbType, ...meta }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "保存失败");
}

/** 获取已保存连接的完整参数（用于编辑，含密码） */
export async function getStoredConnectionParams(id: string): Promise<StoredConnectionParams | null> {
  try {
    const params = await getTransport().request("connections/get-params", { id });
    return params != null ? (params as StoredConnectionParams) : null;
  } catch {
    return null;
  }
}

/** 更新已保存连接的显示名称 */
export async function updateStoredConnectionMeta(id: string, meta: { name?: string }): Promise<void> {
  const data = await getTransport().request("connections/update-meta", { id, ...meta }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "更新失败");
}

/** 原子性替换整个连接列表（用于拖拽排序） */
export async function reorderConnectionList(list: ConnectionList): Promise<void> {
  const data = await getTransport().request("connections/reorder", { list }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "排序失败");
}

/** 从服务端删除已保存连接 */
export async function removeStoredConnection(id: string): Promise<void> {
  const data = await getTransport().request("connections/delete", { id }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "删除失败");
}

/** 使用已保存连接进行连接（服务端解密并建立连接，密码不经过前端） */
export async function connectFromSaved(id: string, sessionId?: string): Promise<{ success: boolean; connectionId?: string; error?: string }> {
  const data = await getTransport().request("connections/connect", { id, sessionId }) as {
    sucess?: boolean;
    success?: boolean;
    connectionId?: string;
    dbType?: DbKind;
    error?: string;
  };
  if (data.sucess || data.success) {
    if (data.connectionId) registerConnectionDbType(data.connectionId, data.dbType ?? "postgres");
    return { success: true, connectionId: data.connectionId };
  }
  return { success: false, error: data.error || "连接失败" };
}
