/**
 * 剪贴板工具：在 VSCode webview 中 navigator.clipboard 受限，通过扩展的 vscode.env.clipboard 桥接
 */

import { getTransport } from "./transport";

function isVscodeWebview(): boolean {
  return typeof (window as any).acquireVsCodeApi === "function";
}

/** 写入剪贴板 */
export async function writeClipboardText(text: string): Promise<void> {
  if (isVscodeWebview()) {
    const transport = getTransport();
    await transport.request("vscode/clipboard-write", { text });
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // 降级：execCommand（已废弃但部分环境仍可用）
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

/** 读取剪贴板 */
export async function readClipboardText(): Promise<string> {
  if (isVscodeWebview()) {
    const transport = getTransport();
    const res = (await transport.request("vscode/clipboard-read", {})) as { text?: string };
    return res?.text ?? "";
  }
  if (navigator.clipboard?.readText) {
    return await navigator.clipboard.readText();
  }
  return "";
}
