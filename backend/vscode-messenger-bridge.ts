/**
 * Extension Host 侧的 vscode-messenger 桥。
 *
 * 与 `frontend/trpc-vscode-link.ts` 成对：把 Webview 经 messenger 发来的
 * 「tRPC 调用」（path / type / input 全在 params 里）还原成对 `appRouter` 的调用。
 *
 * messenger 只是传输层——请求/响应配对由库完成；本文件只做 params → procedure 的分派。
 *
 * 宿主差异全部通过 `procedureOverrides` 表达：
 * - `host.*`：文件、剪贴板、AI Key 等真实 VS Code API
 */

import type { Messenger } from "vscode-messenger";
import type { WebviewIdMessageParticipant } from "vscode-messenger-common";
import { appRouter, type Context } from "./trpc";
import {
  RPC_CALL,
  SUBSCRIBE,
  SUBSCRIBE_COMPLETE,
  SUBSCRIBE_DATA,
  SUBSCRIBE_ERROR,
  UNSUBSCRIBE,
} from "../shared/src/vscode-messenger-rpc";

/** messenger 的 ResponseError 形状（普通对象，可携带 data）。 */
export interface TransportError {
  message: string;
  data?: unknown;
}

/** 构造可被 messenger 原样序列化（并保留 data）的错误对象。 */
export function transportError(message: string, data?: unknown): TransportError {
  return data === undefined ? { message } : { message, data };
}

export type WebviewRpcBridgeOptions = {
  messenger: Messenger;
  /** 目标 Webview（`registerWebviewPanel` 的返回值） */
  receiver: WebviewIdMessageParticipant;
  /** 每次 tRPC 调用前构建 context（可用于注入 token 等） */
  getContext: () => Context | Promise<Context>;
  /**
   * 覆盖特定 tRPC path 的宿主实现。命中时不再走 router。
   * - 查询 / 变更：返回结果数据
   * - 订阅：返回可 `subscribe` 的对象（`observable(...)`）或 `AsyncIterable`
   */
  procedureOverrides?: Record<string, (input: unknown) => Promise<unknown> | unknown>;
};

export interface WebviewRpcBridge {
  dispose(): void;
}

/** 沿 tRPC caller 代理逐级取值（caller 为递归代理，任意路径都返回可调用对象）。 */
function resolveProcedure(caller: unknown, path: string): (input: unknown) => Promise<unknown> {
  let node: any = caller;
  for (const segment of path.split(".")) node = node?.[segment];
  return node as (input: unknown) => Promise<unknown>;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

export function createWebviewRpcBridge(options: WebviewRpcBridgeOptions): WebviewRpcBridge {
  const { messenger, receiver, getContext, procedureOverrides } = options;
  const caller = appRouter.createCaller(() => getContext());
  /** 活跃订阅：opId → 取消函数 */
  const subscriptions = new Map<number, () => void>();

  const handlerScope = { sender: receiver };

  /** 统一的 procedure 求值：宿主 override 优先，其次走 appRouter。 */
  function invokeProcedure(path: string, input: unknown): Promise<unknown> | unknown {
    const override = procedureOverrides?.[path];
    if (override) return override(input);
    return resolveProcedure(caller, path)(input);
  }

  async function handleRpc(params: { path: string; input: unknown }): Promise<unknown> {
    return await invokeProcedure(params.path, params.input);
  }

  function handleSubscribe(params: { opId: number; path: string; input: unknown }): void {
    const { opId, path, input } = params;
    const emitData = (value: unknown) => messenger.sendNotification(SUBSCRIBE_DATA, receiver, { opId, value });
    const emitError = (err: unknown) => {
      subscriptions.delete(opId);
      const e = err as { message?: string; data?: unknown } | undefined;
      messenger.sendNotification(SUBSCRIBE_ERROR, receiver, {
        opId,
        ...transportError(e?.message ?? String(err), e?.data),
      });
    };
    const emitComplete = () => {
      subscriptions.delete(opId);
      messenger.sendNotification(SUBSCRIBE_COMPLETE, receiver, { opId });
    };

    // 建立订阅是异步的（observable / asyncIterable 均需 await 一次），失败经通知回传
    void (async () => {
      try {
        const result = (await invokeProcedure(path, input)) as {
          subscribe?: (observer: {
            next: (value: unknown) => void;
            error: (err: unknown) => void;
            complete: () => void;
          }) => { unsubscribe(): void };
        };

        if (typeof result?.subscribe === "function") {
          const subscription = result.subscribe({ next: emitData, error: emitError, complete: emitComplete });
          subscriptions.set(opId, () => subscription.unsubscribe());
          return;
        }

        if (isAsyncIterable(result)) {
          let stopped = false;
          subscriptions.set(opId, () => {
            stopped = true;
          });
          for await (const value of result) {
            if (stopped) return;
            emitData(value);
          }
          if (!stopped) emitComplete();
          return;
        }

        emitError(new Error(`procedure "${path}" 不是订阅`));
      } catch (err) {
        emitError(err);
      }
    })();
  }

  const disposables = [
    messenger.onRequest(RPC_CALL, (params) => handleRpc(params), handlerScope),
    messenger.onRequest(SUBSCRIBE, (params) => handleSubscribe(params), handlerScope),
    messenger.onNotification(
      UNSUBSCRIBE,
      ({ opId }) => {
        subscriptions.get(opId)?.();
        subscriptions.delete(opId);
      },
      handlerScope
    ),
  ];

  return {
    dispose() {
      for (const disposable of disposables) disposable.dispose();
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    },
  };
}
