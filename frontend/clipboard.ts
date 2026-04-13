/**
 * 剪贴板
 * - VSCode webview：走扩展桥接
 * - 非 webview（HTTP/HTTPS）：直接用 execCommand，通用且简单
 */

import { getTransport } from "./transport";

const isWebview = () => typeof (window as any).acquireVsCodeApi === "function";

function execCommandCopy(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

export async function writeClipboardText(text: string): Promise<void> {
  if (isWebview()) {
    await getTransport().request("vscode/clipboard-write", { text });
    return;
  }
  execCommandCopy(text);
}

/** Webview 下供 Monaco 桥接读取系统剪贴板（经扩展 `vscode.env.clipboard`） */
export async function readClipboardText(): Promise<string> {
  if (isWebview()) {
    const res = (await getTransport().request("vscode/clipboard-read", {})) as { text?: string };
    return res?.text ?? "";
  }
  try {
    if (navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch {
    /* 非安全上下文 */
  }
  return "";
}
