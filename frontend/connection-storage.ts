/**
 * 数据库连接持久化 - 调用服务端 API（服务端加密存储）
 */

import type { PostgresLoginParams } from "../shared/src";
import { getTransport } from "./transport";

export interface StoredConnection {
  id: string;
  label: string;
  enc?: string;
  name?: string;
  group?: string;
}

/** 单条连接（嵌套结构中的项） */
export interface StoredConnectionItem {
  id: string;
  label: string;
  enc?: string;
  name?: string;
}

/** 分组 */
export interface StoredConnectionGroup {
  group: string;
  connections: StoredConnectionItem[];
}

/** 连接列表：顶层连接 + 分组 */
export type ConnectionList = (StoredConnectionItem | StoredConnectionGroup)[];

function isGroupNode(node: unknown): node is StoredConnectionGroup {
  const o = node as Record<string, unknown>;
  return o != null && Array.isArray(o.connections) && typeof o.group === "string";
}

/** 从嵌套结构中查找连接（含 group） */
export function findStoredConnection(list: ConnectionList, id: string): StoredConnection | undefined {
  for (const node of list) {
    if (isGroupNode(node)) {
      const c = node.connections.find((x) => x.id === id);
      if (c) return { ...c, group: node.group };
    } else if (node.id === id) {
      return { ...node };
    }
  }
  return undefined;
}

/** 检查连接是否在列表中 */
export function hasStoredConnection(list: ConnectionList, id: string): boolean {
  return findStoredConnection(list, id) != null;
}

/** 加载已保存连接列表（嵌套结构） */
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
  params: PostgresLoginParams,
  meta?: { name?: string; group?: string }
): Promise<void> {
  const data = await getTransport().request("connections/save", { id, ...params, ...meta }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "保存失败");
}

/** 新建空分组 */
export async function createGroup(groupName: string): Promise<void> {
  const data = await getTransport().request("connections/add-group", { group: groupName }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "创建分组失败");
}

/** 获取已保存连接的完整参数（用于编辑，含密码） */
export async function getStoredConnectionParams(id: string): Promise<PostgresLoginParams | null> {
  try {
    const params = await getTransport().request("connections/get-params", { id });
    return params != null ? (params as PostgresLoginParams) : null;
  } catch {
    return null;
  }
}

/** 更新已保存连接的显示名称和分组 */
export async function updateStoredConnectionMeta(id: string, meta: { name?: string; group?: string }): Promise<void> {
  const data = await getTransport().request("connections/update-meta", { id, ...meta }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "更新失败");
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
    error?: string;
  };
  if (data.sucess || data.success) return { success: true, connectionId: data.connectionId };
  return { success: false, error: data.error || "连接失败" };
}
