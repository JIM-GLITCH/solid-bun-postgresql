/**
 * tRPC Client 工厂
 * 根据不同环境创建相应的 tRPC client
 */

import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '../../shared/src';
import { createVscodeMessengerLink } from './vscode-messenger-link';
import { getVsCodeWebviewApi } from '../transport/vscode-api';

export type TrpcClientEnvironment = 'web' | 'vscode' | 'electrobun';

export interface TrpcClientOptions {
  /** 环境类型，默认自动检测 */
  environment?: TrpcClientEnvironment;
  /** Web 环境的 HTTP 选项 */
  httpOptions?: {
    baseUrl?: string;
    getBearerToken?: () => string | null;
    timeout?: number;
  };
  /** VSCode 环境的 messenger 选项 */
  vscodeOptions?: Parameters<typeof createVscodeMessengerLink>[0];
}

/**
 * 自动检测当前运行环境
 */
function detectEnvironment(): TrpcClientEnvironment {
  // 检测 VSCode 环境
  if (typeof window !== 'undefined' && getVsCodeWebviewApi()) {
    return 'vscode';
  }

  // 检测 Electrobun 环境
  if (typeof window !== 'undefined' && (window as any).__electrobunApiRequest) {
    return 'electrobun';
  }

  // 默认为 Web 环境
  return 'web';
}

/**
 * 创建 tRPC client
 *
 * 根据环境自动选择合适的传输层：
 * - VSCode: 使用 VSCode Webview postMessage link
 * - Web: 使用标准 tRPC httpBatchLink
 * - Electrobun: 使用标准 tRPC httpBatchLink
 */
export function createTrpcClient(options: TrpcClientOptions = {}) {
  const environment = options.environment ?? detectEnvironment();

  let links: any[];

  switch (environment) {
    case 'vscode': {
      // 使用 VSCode messenger link，增加超时时间到 60 秒
      links = [createVscodeMessengerLink({
        timeout: 60000, // 60 seconds for VSCode environment
        ...options.vscodeOptions,
      })];
      break;
    }
    case 'web':
    case 'electrobun':
      // 使用标准的 tRPC httpBatchLink
      const {
        baseUrl = '',
        getBearerToken,
        timeout = 30000,
      } = options.httpOptions || {};

      links = [httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        headers: () => {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'x-dbplayer-client': environment === 'electrobun' ? 'electrobun' : 'web',
          };

          const token = getBearerToken?.();
          if (token) {
            headers.Authorization = `Bearer ${token}`;
          }

          return headers;
        },
        // 添加超时处理
        fetch(url, options) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);

          return fetch(url, {
            ...options,
            signal: controller.signal,
          }).finally(() => {
            clearTimeout(timeoutId);
          });
        },
      })];
      break;
    default:
      links = [httpBatchLink({
        url: '/api/trpc',
      })];
  }

  return createTRPCClient<AppRouter>({
    links,
  });
}

// 导出单例 client（可选）
let trpcClient: ReturnType<typeof createTrpcClient> | null = null;

export function getTrpcClient(options?: TrpcClientOptions) {
  if (!trpcClient) {
    trpcClient = createTrpcClient(options);
  }
  return trpcClient;
}

export function resetTrpcClient() {
  trpcClient = null;
}