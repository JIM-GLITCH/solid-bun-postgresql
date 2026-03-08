/**
 * 数据库连接持久化 - 调用服务端 API（服务端加密存储）
 */

import type { PostgresLoginParams } from "../shared/src";

export interface StoredConnection {
  id: string;
  label: string;
  enc?: string;
}

const API_BASE = "";

/** 加载已保存连接列表 */
export async function loadStoredConnections(): Promise<StoredConnection[]> {
  try {
    const res = await fetch(`${API_BASE}/api/connections/list`);
    if (!res.ok) return [];
    const arr = await res.json();
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 保存连接到服务端（服务端加密存储） */
export async function saveConnection(id: string, params: PostgresLoginParams): Promise<void> {
  const res = await fetch(`${API_BASE}/api/connections/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...params }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "保存失败");
}

/** 从服务端删除已保存连接 */
export async function removeStoredConnection(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/connections/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "删除失败");
}

/** 使用已保存连接进行连接（服务端解密并建立连接，密码不经过前端） */
export async function connectFromSaved(id: string): Promise<{ success: boolean; connectionId?: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/connections/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await res.json();
  if (data.sucess) return { success: true, connectionId: data.connectionId };
  return { success: false, error: data.error || "连接失败" };
}
