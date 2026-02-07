/**
 * 传输层入口：提供默认 HttpTransport，可替换为 VsCodeTransport 等
 */

import type { IApiTransport } from "@project/shared";
import { HttpTransport } from "./http-transport";

let transport: IApiTransport = new HttpTransport();

export function getTransport(): IApiTransport {
  return transport;
}

export function setTransport(t: IApiTransport): void {
  transport = t;
}

export { HttpTransport } from "./http-transport";
