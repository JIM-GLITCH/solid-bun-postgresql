/**
 * tRPC over vscode-messenger 自定义传输层
 * vscode-messenger 只作为纯传输层，不涉及具体业务逻辑
 */

import { observable } from '@trpc/server/observable';
import { TRPCClientError, type TRPCLink } from '@trpc/client';
import type { AppRouter } from '../../shared/src';
import { Messenger } from 'vscode-messenger-webview';
import { HOST_EXTENSION } from 'vscode-messenger-common';
import { getVsCodeWebviewApi } from '../transport/vscode-api';

export interface VscodeMessengerOptions {
  /** Messenger 实例，如果不提供则自动创建 */
  messenger?: Messenger;
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number;
}

// Messenger 单例
let messengerSingleton: Messenger | null = null;

/**
 * 获取 Messenger 实例（单例）
 */
function getMessenger(): Messenger {
  if (messengerSingleton) {
    console.log('[vscode-messenger-link] Reusing existing messenger instance');
    return messengerSingleton;
  }

  const vscode = getVsCodeWebviewApi();
  if (!vscode) {
    throw new Error('VSCode Webview API not available');
  }

  console.log('[vscode-messenger-link] Creating new messenger instance');
  messengerSingleton = new Messenger(vscode);
  // 必须调用 start()，否则不会监听 window message 事件，导致响应永远收不到（请求卡死直到超时）
  messengerSingleton.start();
  console.log('[vscode-messenger-link] Messenger instance created successfully');
  return messengerSingleton;
}

/**
 * 创建 tRPC over vscode-messenger 的自定义 link
 *
 * 这个 link 将 tRPC 的请求通过 vscode-messenger 传输到后端，
 * vscode-messenger 只作为传输层，业务逻辑完全由 tRPC router 定义。
 *
 * 注意：TRPCLink 必须返回一个 Observable（tRPC 客户端 link 链会调用
 * `obs$.subscribe(observer)`），因此这里用 `observable()` 包裹异步请求，
 * 而不是返回普通对象。
 */
export function createVscodeMessengerLink(
  options: VscodeMessengerOptions = {}
): TRPCLink<AppRouter> {
  const { messenger: externalMessenger, timeout = 30000 } = options;

  // 使用传入的 Messenger 实例或单例
  const messenger = externalMessenger ?? getMessenger();

  return () =>
    ({ op }) =>
      observable((observer) => {
        // tRPC v11 中 op.path 已是点分字符串（如 "connections.list"）
        const tprocPath = Array.isArray(op.path) ? op.path.join('.') : op.path;

        console.log('[vscode-messenger-link] Sending tRPC request:', {
          path: tprocPath,
          input: op.input,
          type: op.type,
        });

        // settled 防止超时与响应竞态导致重复 emit
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          console.error('[vscode-messenger-link] Request timeout after', timeout, 'ms for path:', tprocPath);
          observer.error(new TRPCClientError(`VscodeMessenger: 请求超时 (${timeout}ms) - ${tprocPath}`));
        }, timeout);

        // 通过 vscode-messenger 发送 tRPC 请求
        // 由于 vscode-messenger 不支持正则匹配，method 保持为 'trpc'
        // 具体路径放在 payload 的 path 字段中
        messenger
          .sendRequest({ method: 'trpc' } as any, HOST_EXTENSION, { path: tprocPath, input: op.input })
          .then((envelope: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);

            console.log('[vscode-messenger-link] Received response for path:', tprocPath, envelope);

            // 后端返回 tRPC batch 结果的第一项：
            //   成功 => { result: { data } }；失败 => { error: { message, code, data } }
            if (envelope && envelope.error) {
              console.error('[vscode-messenger-link] Response contains error:', envelope.error);
              observer.error(TRPCClientError.from(envelope));
              return;
            }

            observer.next({ result: envelope?.result });
            observer.complete();
          })
          .catch((err: any) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            console.error('[vscode-messenger-link] Request failed with error:', err);
            observer.error(TRPCClientError.from(err));
          });

        // 取消订阅时清理定时器
        return () => {
          settled = true;
          clearTimeout(timer);
        };
      });
}
