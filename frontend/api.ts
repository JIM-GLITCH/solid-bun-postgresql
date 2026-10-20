/**
 * 前端「会话」模块。
 *
 * 说明：业务 RPC 已全部迁到 tRPC，组件直接调用 `trpc.db.xxx` / `trpc.ai.xxx`
 * （见 `./trpc-client`）；宿主能力同样走 tRPC（`trpc.host.*`），
 * 由扩展宿主在 `backend/vscode-messenger-bridge` 里覆盖实现。
 *
 * 本文件只保留**带副作用的会话生命周期**：
 *   - 建连登记方言 / 预取能力缓存 / 断开清理
 *   - 数据库事件订阅（tRPC subscription）
 *
 * `dbConn()` 是 db/* 请求的入参构造器（补 `dbType`），供各组件直接调用 tRPC 时复用。
 */

import { trpc } from "./trpc-client";
import type {
  PostgresLoginParams,
  SSEMessage,
  DatabaseCapabilities,
  DbKind,
} from "../shared/src";
import { getRegisteredDbType, registerConnectionDbType, unregisterConnectionDbType } from "./db-session-meta";
import {
  clearServerCapabilities,
  registerServerCapabilities,
  registerServerDataTypes,
} from "./db-capabilities-cache";
import { defaultDatabaseCapabilities } from "../shared/src";
import { normalizeDbDataTypesList } from "./table-designer-shared";
import { isVsCodeWebview } from "./platform";

/** 与当前会话一致：db/* 请求须带 dbType，与 connectionMap 中方言一致。 */
export function dbConn(connectionId: string) {
  return { connectionId, dbType: getRegisteredDbType(connectionId) };
}

/** 连接数据库（params 与 PG/MySQL 共用形状）；dbType 由调用方指定并在成功后登记。 */
export async function connectPostgres(
  connectionId: string,
  params: PostgresLoginParams,
  dbType: DbKind = "postgres"
) {
  const res = await trpc.db.connect.mutate({
    ...params,
    connectionId,
    dbType,
  });
  if (res.success) {
    registerConnectionDbType(connectionId, res.dbType ?? dbType);
    void prefetchDbCapabilities(connectionId);
    void prefetchDbDataTypes(connectionId);
  }
  return res as { success: boolean; error?: unknown };
}

/** 断开指定连接 */
export async function disconnectPostgres(connectionId: string) {
  try {
    return await trpc.db.disconnect.mutate(dbConn(connectionId));
  } finally {
    clearServerCapabilities(connectionId);
    unregisterConnectionDbType(connectionId);
  }
}

/** 建连后拉取并缓存能力（失败则写入与方言一致的默认矩阵） */
export async function prefetchDbCapabilities(connectionId: string): Promise<void> {
  try {
    const { capabilities } = await trpc.db.capabilities.query(
      dbConn(connectionId)
    ) as { capabilities: DatabaseCapabilities };
    registerServerCapabilities(connectionId, capabilities);
  } catch {
    registerServerCapabilities(
      connectionId,
      defaultDatabaseCapabilities(getRegisteredDbType(connectionId))
    );
  }
}

/** 建连后拉取 `db/data-types` 并缓存（仅库返回类型；失败则表设计器内再请求） */
export async function prefetchDbDataTypes(connectionId: string): Promise<void> {
  try {
    const { types } = await trpc.db.dataTypes.query(dbConn(connectionId));
    const list = normalizeDbDataTypesList(types);
    if (list.length > 0) registerServerDataTypes(connectionId, list);
  } catch {
    /* 忽略 */
  }
}

/**
 * 页面关闭/隐藏且即将卸载时调用：释放服务端 connectionMap。
 * Web 使用 keepalive fetch，避免关页时普通请求被取消；VSCode webview 走宿主 link。
 *
 * 注：keepalive 需同步发起普通 fetch，无法走 tRPC 批量协议，故保留专用的
 * keepalive 端点 `/api/db/disconnect`（见 `backend/api-handlers-http`）。
 */
export function disconnectPostgresOnPageUnload(connectionId: string): void {
  if (isVsCodeWebview()) {
    void disconnectPostgres(connectionId);
    return;
  }
  const payload = dbConn(connectionId);
  try {
    void fetch(`/api/db/disconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    void disconnectPostgres(connectionId);
  }
  clearServerCapabilities(connectionId);
  unregisterConnectionDbType(connectionId);
}

/**
 * 订阅指定连接的会话事件（NOTICE/ERROR/…），由 tRPC subscription 承载。
 * 返回取消订阅函数。
 */
export function subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
  const subscription = trpc.db.onConnectionEvents.subscribe(
    { connectionId },
    {
      onData: (msg) => callback(msg as SSEMessage),
      onError: (err) => {
        // 连接不存在等错误静默处理（订阅失败不影响主流程）
        void err;
      },
    }
  );
  return () => subscription.unsubscribe();
}
