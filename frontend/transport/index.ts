/**
 * 传输层入口：提供默认 HttpTransport，可替换为 VsCodeTransport 等
 *
 * 与后端通信仅暴露两能力（见 `IApiTransport`）：
 * - `getTransport().request(...)`：RPC
 * - `getTransport().on({ event: "push" | "connection" | "account", ... })`：服务端推送（SSE/postMessage 等由实现封装）
 *
 * `frontend/api.ts` 中的 RPC 封装同样调用 `getTransport()`；业务侧需要自定义调用时请直接 `import { getTransport } from "./transport"`。
 */

import type { IApiTransport } from "../../shared/src";
import { HttpTransport } from "./http-transport";

let transport: IApiTransport = new HttpTransport();

/** 当前全局 Transport（Web / VSCode / Electrobun 在入口 `setTransport` 注入） */
export function getTransport(): IApiTransport {
  return transport;
}

/** 在应用入口注册具体 Transport 实现 */
export function setTransport(t: IApiTransport): void {
  transport = t;
}

export { HttpTransport } from "./http-transport";
export { ElectrobunTransport } from "./electrobun-transport";
