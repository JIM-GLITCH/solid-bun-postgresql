/**
 * tRPC Context 定义
 * 包含请求上下文信息，如原始请求（用于解析订阅令牌）等
 */

import type { SessionConnection } from '../api-core';
import { getSession } from '../api-core';

export interface Context {
  /** 原始 HTTP 请求（Web 端；VSCode/Electrobun 走自定义 link 时为 undefined） */
  req?: Request;
  /** 已建立的会话（若载荷中带有 connectionId 可在 procedure 内按需获取） */
  session?: SessionConnection;
  connectionId?: string;
}

export type CreateContextFn = (opts: { req?: Request }) => Context | Promise<Context>;

export const createContext: CreateContextFn = async (opts) => {
  const connectionId = opts.req ? new URL(opts.req.url).searchParams.get('connectionId') ?? undefined : undefined;
  return {
    req: opts.req,
    connectionId,
    session: connectionId ? getSession(connectionId) : undefined,
  };
};
