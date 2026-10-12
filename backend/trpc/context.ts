/**
 * tRPC Context 定义
 * 包含请求上下文信息，如原始请求（用于解析订阅令牌）等
 */

import type { SessionInfo } from '../api-core';
import { getSessionInfo } from '../api-core';

export interface Context {
  /** 原始 HTTP 请求（Web 端；VSCode/Electrobun 走自定义 link 时为 undefined） */
  req?: Request;
  /** 已建立会话的摘要（不含连接句柄；需要连接能力请在 procedure 内用 connectorFor） */
  session?: SessionInfo;
  connectionId?: string;
}

export type CreateContextFn = (opts: { req?: Request }) => Context | Promise<Context>;

export const createContext: CreateContextFn = async (opts) => {
  const connectionId = opts.req ? new URL(opts.req.url).searchParams.get('connectionId') ?? undefined : undefined;
  return {
    req: opts.req,
    connectionId,
    session: connectionId ? getSessionInfo(connectionId) : undefined,
  };
};
