/**
 * AppServer —— 非 db/* 的应用级 RPC（connections / query-history / subscription / ai）。
 * 对齐 react-datatable 的 handler 注册模式：每个方法经 `rpc.onRequest(TYPE, handler)` 挂载，
 * 不再有 api-core 式的巨型 switch 分发。
 */

import { ResponseError, type MessageConnection } from "vscode-jsonrpc";
import {
  AI_CONFIG_GET,
  AI_CONFIG_SET,
  AI_KEY_DELETE,
  AI_PROMPT_BUILD,
  AI_PROMPT_BUILD_DIFF,
  AI_SQL_EDIT,
  AI_TEST_CONNECTION,
  CONNECTIONS_CONNECT,
  CONNECTIONS_DELETE,
  CONNECTIONS_GET_PARAMS,
  CONNECTIONS_LIST,
  CONNECTIONS_REORDER,
  CONNECTIONS_SAVE,
  CONNECTIONS_UPDATE_META,
  QUERY_HISTORY_ADD,
  QUERY_HISTORY_CLEAR,
  QUERY_HISTORY_DELETE,
  QUERY_HISTORY_SEARCH,
  SUBSCRIPTION_ACCOUNT,
  SUBSCRIPTION_ASSERT,
  SUBSCRIPTION_REQUIRED_ERROR_CODE,
  isMysqlFamily,
  isSqlServer,
  type ApiRequestPayload,
  type ConnectionSavePayload,
  type StoredConnectionParams,
} from "../shared/src";
import type { RpcMultiSessionServer } from "./rpc/rpc-session";
import type { DbServer } from "./db-server";
import {
  getConnectionParams,
  listConnections,
  removeConnection,
  reorderConnections,
  saveConnection,
  updateConnectionMeta,
} from "./connections-store";
import {
  addQuery as addQueryHistory,
  clearHistory as clearQueryHistory,
  deleteEntry as deleteHistoryEntry,
  searchHistory,
} from "./query-history-store";
import { getStoredSubscriptionToken } from "./subscription-token-store";
import {
  assertSubscriptionLicensed,
  getSubscriptionApiBaseFromEnv,
  SubscriptionRequiredError,
} from "./subscription-license";
import {
  handleAiConfigGet,
  handleAiConfigSet,
  handleAiKeyDelete,
  handleAiPromptBuild,
  handleAiPromptBuildDiff,
  handleAiSqlEdit,
  handleAiTestConnection,
} from "./ai-service";

export type AppServerOptions = {
  /**
   * 订阅校验实现（默认：用载荷 accessToken 调 assertSubscriptionLicensed）。
   * vscode / electrobun 宿主可注入自己的 token 来源与 apiBase。
   */
  assertLicensed?: (accessToken: string | null) => Promise<void>;
  /**
   * 账号态查询实现（默认：服务端 token store + /api/me）。
   * vscode 宿主的 token 存 SecretStorage，由宿主注入。
   */
  getSubscriptionAccount?: () => Promise<{
    loggedIn: boolean;
    user?: { id?: number; email?: string | null };
  }>;
};

export class AppServer {
  constructor(rpc: RpcMultiSessionServer, dbServer: DbServer, opts: AppServerOptions = {}) {
    // ─── connections/* ──────────────────────────────────────────────
    rpc.onRequest(CONNECTIONS_LIST, () => listConnections());

    rpc.onRequest(CONNECTIONS_SAVE, (payload: ApiRequestPayload["connections/save"]) => {
      const { id, name, group, dbType, ...params } = payload as ConnectionSavePayload;
      if (!id || !String(params.host ?? "").trim() || !String(params.username ?? "").trim()) {
        throw new Error("缺少必填字段");
      }
      const kind = dbType ?? "postgres";
      const defaultPort = isMysqlFamily(kind) ? "3306" : isSqlServer(kind) ? "1433" : "5432";
      const toSave: StoredConnectionParams = {
        host: params.host,
        port: params.port || defaultPort,
        database: String(params.database ?? "").trim(),
        username: params.username,
        password: params.password || "",
        dbType: kind,
      };
      if (params.sshEnabled) {
        toSave.sshEnabled = true;
        toSave.sshHost = params.sshHost;
        toSave.sshPort = params.sshPort || "22";
        toSave.sshUsername = params.sshUsername;
        toSave.sshPassword = params.sshPassword;
        toSave.sshPrivateKey = params.sshPrivateKey;
        if (params.connectionTimeoutSec != null && params.connectionTimeoutSec > 0) {
          toSave.connectionTimeoutSec = params.connectionTimeoutSec;
        }
      }
      saveConnection(id, toSave, { name, group });
      return { success: true };
    });

    rpc.onRequest(CONNECTIONS_DELETE, (payload: ApiRequestPayload["connections/delete"]) => {
      const { id } = payload;
      if (!id) throw new Error("缺少 id");
      removeConnection(id);
      return { success: true };
    });

    rpc.onRequest(CONNECTIONS_UPDATE_META, (payload: ApiRequestPayload["connections/update-meta"]) => {
      const { id, name } = payload;
      if (!id) throw new Error("缺少 id");
      updateConnectionMeta(id, { name });
      return { success: true };
    });

    rpc.onRequest(CONNECTIONS_REORDER, (payload: ApiRequestPayload["connections/reorder"]) => {
      const { list } = payload;
      if (!Array.isArray(list)) throw new Error("list 必须是数组");
      reorderConnections(list);
      return { success: true };
    });

    rpc.onRequest(CONNECTIONS_GET_PARAMS, (payload: ApiRequestPayload["connections/get-params"]) => {
      const { id } = payload;
      if (!id) throw new Error("缺少 id");
      const params = getConnectionParams(id);
      if (!params) return null;
      const { id: _id, ...rest } = params;
      return rest as StoredConnectionParams;
    });

    rpc.onRequest(
      CONNECTIONS_CONNECT,
      async (payload: ApiRequestPayload["connections/connect"], connection: MessageConnection) => {
        const { id } = payload;
        const params = getConnectionParams(id);
        if (!params) throw new Error("未找到已保存的连接");
        const { id: storedId, dbType, ...loginParams } = params;
        // 使用服务端分配的 rpc sessionId 区分不同标签页，会话销毁时随 jsonrpc session 释放资源
        const rpcSessionId = rpc.getSessionId(connection);
        const connectionId = rpcSessionId ? `${storedId}-${rpcSessionId}` : storedId;
        return dbServer.handleConnect(
          { ...loginParams, dbType: dbType ?? "postgres", connectionId },
          connection,
        );
      },
    );

    // ─── query-history/* ────────────────────────────────────────────
    rpc.onRequest(QUERY_HISTORY_ADD, (payload: ApiRequestPayload["query-history/add"]) => {
      addQueryHistory(payload.sql, payload.connectionId);
      return { success: true };
    });

    rpc.onRequest(QUERY_HISTORY_SEARCH, (payload: ApiRequestPayload["query-history/search"]) =>
      searchHistory({
        keyword: payload.keyword,
        since: payload.since,
        until: payload.until,
      }),
    );

    rpc.onRequest(QUERY_HISTORY_DELETE, (payload: ApiRequestPayload["query-history/delete"]) => {
      const { id } = payload;
      if (!id) throw new Error("缺少 id");
      deleteHistoryEntry(id);
      return { success: true };
    });

    rpc.onRequest(QUERY_HISTORY_CLEAR, () => {
      clearQueryHistory();
      return { success: true };
    });

    // ─── subscription/* ─────────────────────────────────────────────
    rpc.onRequest(SUBSCRIPTION_ASSERT, async (payload) => {
      const { feature, accessToken } = payload;
      const allowed = new Set(["visual-query-builder", "table-designer"]);
      if (!feature || !allowed.has(feature)) throw new Error("无效的功能标识");
      try {
        if (opts.assertLicensed) {
          await opts.assertLicensed(accessToken ?? null);
        } else {
          await assertSubscriptionLicensed(accessToken ?? null);
        }
      } catch (e) {
        // 保留旧 HTTP 403 语义标记，前端 RpcTransport 据此还原 SubscriptionRequiredError
        if (e instanceof SubscriptionRequiredError) {
          throw new ResponseError(SUBSCRIPTION_REQUIRED_ERROR_CODE, e.message, {
            subscriptionRequired: true,
          });
        }
        throw e;
      }
      return { success: true };
    });

    rpc.onRequest(SUBSCRIPTION_ACCOUNT, async () => {
      if (opts.getSubscriptionAccount) return opts.getSubscriptionAccount();
      const token = getStoredSubscriptionToken();
      if (!token) return { loggedIn: false };
      try {
        const apiBase = getSubscriptionApiBaseFromEnv();
        const res = await fetch(`${apiBase}/api/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return { loggedIn: true };
        const data = (await res.json()) as { user?: { id?: number; email?: string | null } };
        return { loggedIn: true, user: data.user };
      } catch {
        return { loggedIn: true };
      }
    });

    // ─── ai/*（实现与状态仍在 api-core，此处仅注册路由） ──────────────
    rpc.onRequest(AI_CONFIG_GET, () => handleAiConfigGet());
    rpc.onRequest(AI_CONFIG_SET, (payload) => handleAiConfigSet(payload));
    rpc.onRequest(AI_KEY_DELETE, (payload) => handleAiKeyDelete(payload));
    rpc.onRequest(AI_TEST_CONNECTION, (payload) => handleAiTestConnection(payload));
    rpc.onRequest(AI_SQL_EDIT, (payload) => handleAiSqlEdit(payload));
    rpc.onRequest(AI_PROMPT_BUILD, (payload) => handleAiPromptBuild(payload));
    rpc.onRequest(AI_PROMPT_BUILD_DIFF, (payload) => handleAiPromptBuildDiff(payload));
  }
}
