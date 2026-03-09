/**
 * 数据库连接持久化 - 调用服务端 API（服务端加密存储）
 */

import type { PostgresLoginParams } from "../shared/src";
import { getTransport } from "./transport";

export interface StoredConnection {
  id: string;
  label: string;
  enc?: string;
}

/** 加载已保存连接列表 */
export async function loadStoredConnections(): Promise<StoredConnection[]> {
  try {
    const arr = await getTransport().request("connections/list", {});
    return Array.isArray(arr) ? (arr as StoredConnection[]) : [];
  } catch {
    return [];
  }
}

/** 保存连接到服务端（服务端加密存储） */
export async function saveConnection(id: string, params: PostgresLoginParams): Promise<void> {
  const data = await getTransport().request("connections/save", { id, ...params }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "保存失败");
}

/** 从服务端删除已保存连接 */
export async function removeStoredConnection(id: string): Promise<void> {
  const data = await getTransport().request("connections/delete", { id }) as { success?: boolean; error?: string };
  if (!data?.success) throw new Error(data?.error || "删除失败");
}

/** 使用已保存连接进行连接（服务端解密并建立连接，密码不经过前端） */
export async function connectFromSaved(id: string): Promise<{ success: boolean; connectionId?: string; error?: string }> {
  const data = await getTransport().request("connections/connect", { id }) as {
    sucess?: boolean;
    success?: boolean;
    connectionId?: string;
    error?: string;
  };
  if (data.sucess || data.success) return { success: true, connectionId: data.connectionId };
  return { success: false, error: data.error || "连接失败" };
}
