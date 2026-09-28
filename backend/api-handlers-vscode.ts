/**
 * 后端 API 处理器 - VSCode 实现：vscode-messenger 作为纯传输层
 * 
 * vscode-messenger 只负责传输，业务逻辑完全由 tRPC router 定义
 */

import * as vscode from "vscode";
import { Messenger } from "vscode-messenger";
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter, setTrpcRuntime } from './trpc/server';
import { VscodeAppRuntime } from './runtime/vscode-runtime';

export interface VscodeMessengerOptions {
  /** 在 RPC 前执行（Extension Host 从 Secret 取 token 并调订阅服务） */
  assertLicensed?: () => Promise<void>;
  /** 返回 true 时才执行 assertLicensed；默认全部校验（向后兼容） */
  shouldAssertLicensed?: (method: string) => boolean;
}

/**
 * 注册统一的 tRPC handler 到 vscode-messenger
 *
 * 这个函数只注册一个 handler，所有 tRPC 请求都通过这个 handler 处理
 * vscode-messenger 只作为传输层，不涉及具体业务逻辑
 */
export function registerTrpcHandler(
  messenger: Messenger,
  options: VscodeMessengerOptions = {}
) {
  const { assertLicensed, shouldAssertLicensed = () => true } = options;

  // VSCode 环境使用 SecretStorage 运行时（AI key 存于扩展 SecretStorage）
  setTrpcRuntime(VscodeAppRuntime);

  console.log('[backend] Registering tRPC handler with messenger');

  // 只注册一个统一的 tRPC handler
  messenger.onRequest({ method: 'trpc' } as any, async (params: { path: string; input: any }) => {
    console.log('[backend] ========================================');
    console.log('[backend] Received tRPC request');
    console.log('[backend] Path:', params?.path);
    console.log('[backend] Input:', JSON.stringify(params?.input, null, 2));
    console.log('[backend] ========================================');

    const { path, input } = params;
    
    try {
      // 可选的订阅校验
      if (assertLicensed && shouldAssertLicensed(path)) {
        await assertLicensed();
      }

      // 创建模拟的 Request 对象：fetchRequestHandler 从 URL path 解析 tRPC 过程路径，
      // 从 body 解析 batch 输入（{0: input}），而不是从 body 里的 path 字段
      const request = new Request(`http://localhost/api/trpc/${path}?batch=1`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 0: input }),
      });

      console.log('[backend] Processing tRPC request with fetchRequestHandler');

      // 使用 tRPC 的 fetch handler 处理请求
      // allowMethodOverride：query 过程默认只接受 GET，这里统一用 POST 发送，需要放开限制
      const response = await fetchRequestHandler({
        endpoint: '/api/trpc',
        req: request,
        router: appRouter,
        createContext: () => ({}),
        allowMethodOverride: true,
      });

      console.log('[backend] fetchRequestHandler completed, response status:', response.status);

      const result = await response.json();
      console.log('[backend] ========================================');
      console.log('[backend] tRPC response result:');
      console.log('[backend] Result:', JSON.stringify(result, null, 2));
      console.log('[backend] Returning first item:', JSON.stringify(result[0], null, 2));
      console.log('[backend] ========================================');

      // tRPC batch 格式返回，取第一个结果（完整信封，含 error 分支）
      // 成功 => { result: { data } }；失败 => { error: { message, code, data } }
      return result[0];
    } catch (error) {
      console.error('[backend] ========================================');
      console.error('[backend] tRPC handler error:', error);
      console.error('[backend] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      console.error('[backend] ========================================');
      throw error;
    }
  });

  console.log('[backend] tRPC handler registration complete');
}
