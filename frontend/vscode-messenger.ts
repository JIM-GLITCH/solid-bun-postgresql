/**
 * VSCode Webview 侧的 vscode-messenger（TypeFox）单例。
 *
 * 它是 Webview ↔ Extension Host 的**唯一传输通道**：业务调用（含宿主能力）全部是
 * tRPC，经 `trpc-vscode-link` 复用本实例，请求/响应配对由 messenger 负责。
 *
 * `acquireVsCodeApi()` 整个页面只能调用一次，故全局共用同一实例。
 */

import { Messenger } from "vscode-messenger-webview";
import { getVsCodeWebviewApi } from "./platform";

let messenger: Messenger | null = null;

/** 当前 Webview 的 Messenger（单例）。仅在 VSCode Webview 环境可用。 */
export function getWebviewMessenger(): Messenger {
  if (!messenger) {
    const vscode = getVsCodeWebviewApi();
    if (!vscode) throw new Error("vscode-messenger: 仅可在 VSCode Webview 中使用");
    messenger = new Messenger(vscode);
    messenger.start();
  }
  return messenger;
}
