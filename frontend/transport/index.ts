/**
 * 传输层入口：提供默认 HttpTransport，可替换为 VsCodeTransport 等
 *
 * 注意：主要 API 调用已迁移到 tRPC，此 transport 系统暂时保留用于订阅功能
 *
 * 与后端通信仅暴露两能力（见 `IApiTransport`）：
 * - `getTransport().request(...)`：RPC（已被 tRPC 替代，仅订阅功能仍使用）
 * - `getTransport().on({ event: "push" | "connection" | "account", ... })`：服务端推送（SSE/postMessage 等由实现封装）
 *
 * `frontend/api.ts` 中的订阅功能仍调用 `getTransport()`；其他 API 调用已迁移到 tRPC。
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
