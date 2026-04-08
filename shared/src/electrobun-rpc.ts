/**
 * Electrobun RPC 类型定义：主进程与渲染进程间的 API 通信
 * 供 electrobun-app 主进程和 frontend ElectrobunTransport 共享
 */

import type { RPCSchema } from "electrobun";
import type { SSEMessage } from "./types";

/** 主进程执行的 api_request：浏览器调用，返回后端结果 */
export type ApiRequestParams = {
  method: string;
  payload: Record<string, unknown> & { sessionId?: string };
  /** 订阅 JWT；主进程在校验通过后才执行 handleApiRequest */
  licenseJwt?: string | null;
};

/** 主进程推送给浏览器的后端事件 */
export type BackendEventPayload = {
  sessionId?: string;
  data?: SSEMessage;
  error?: string;
};

export type AppRPCType = {
  /** 在 Bun 主进程执行的函数 */
  bun: RPCSchema<{
    requests: {
      api_request: {
        params: ApiRequestParams;
        response: unknown;
      };
    };
    messages: Record<string, never>;
  }>;
  /** 在浏览器执行的函数 / 接收的消息 */
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      backend_event: BackendEventPayload;
    };
  }>;
};
