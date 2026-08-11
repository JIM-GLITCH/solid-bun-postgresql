/**
 * 传输层入口：默认 RpcTransport（jsonrpc 会话），可替换为 VsCodeTransport / ElectrobunTransport
 *
 * 与后端通信仅暴露两能力（见 `IApiTransport`）：
 * - `getTransport().request(...)`：RPC
 * - `getTransport().on({ event: "push" | "connection" | "account", ... })`：服务端推送（由实现封装）
 *
 * `frontend/api.ts` 中的 RPC 封装同样调用 `getTransport()`；业务侧需要自定义调用时请直接 `import { getTransport } from "./transport"`。
 */

import type { IApiTransport } from "../../shared/src";

let transport: IApiTransport | null = null;

/** 当前全局 Transport（Web / VSCode / Electrobun 在入口 `setTransport` 注入） */
export function getTransport(): IApiTransport {
  if (!transport) throw new Error("Transport 未初始化，请先调用 setTransport()");
  return transport;
}

/** 在应用入口注册具体 Transport 实现 */
export function setTransport(t: IApiTransport): void {
  transport = t;
}
