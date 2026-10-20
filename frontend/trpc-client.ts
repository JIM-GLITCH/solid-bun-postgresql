/**
 * tRPC Client 配置
 *
 * - 查询 / 变更：`httpBatchLink`（批量 HTTP）
 * - 订阅：`httpSubscriptionLink`（SSE，替代旧的 `/api/events`）
 * - 可插拔传输：宿主（VSCode / Electrobun）可注入自定义 link（见 `setTrpcTransportLink`）
 */

import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  type OperationLink,
  type TRPCLink,
} from '@trpc/client';
import { observable } from '@trpc/server/observable';
import type { AppRouter } from '../backend/trpc';

const API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) ?? '';

/** 把 tRPC 错误映射为前端 Error。 */
export function mapTrpcError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** 统一错误映射 link：包裹后续 link，把服务端错误规范化后抛给调用方。 */
const errorMappingLink: TRPCLink<AppRouter> = () => (props) =>
  observable((observer) => {
    const sub = props.next(props.op).subscribe({
      next: (value) => observer.next(value),
      error: (err) => observer.error(mapTrpcError(err) as never),
      complete: () => observer.complete(),
    });
    return () => sub.unsubscribe();
  });

function webHeaders(): Record<string, string> {
  return { 'x-dbplayer-client': 'web' };
}

/** Web 默认传输 link：查询 / 变更走批量 HTTP，订阅走 SSE。 */
export function createWebTransportLink(): TRPCLink<AppRouter> {
  const url = `${API_BASE}/api/trpc`;
  return splitLink({
    condition: (op) => op.type === 'subscription',
    true: httpSubscriptionLink({ url }),
    false: httpBatchLink({ url, headers: webHeaders }),
  });
}

let overrideLinkFactory: TRPCLink<AppRouter> | null = null;

/**
 * 宿主注入自定义传输 link（如 VSCode 的 postMessage link）。
 * 传入 `null` 恢复 Web 默认（HTTP + SSE）。
 */
export function setTrpcTransportLink(factory: TRPCLink<AppRouter> | null): void {
  overrideLinkFactory = factory;
}

/** 动态传输 link：按需在默认 Web link 与宿主注入 link 之间切换。 */
const dynamicTransportLink: TRPCLink<AppRouter> = (runtime) => {
  const fallback = createWebTransportLink()(runtime);
  let override: OperationLink<AppRouter> | null = null;
  return (props) => {
    if (overrideLinkFactory) {
      override ??= overrideLinkFactory(runtime);
      return override(props);
    }
    return fallback(props);
  };
};

export const trpc = createTRPCClient<AppRouter>({
  links: [errorMappingLink, dynamicTransportLink],
});
