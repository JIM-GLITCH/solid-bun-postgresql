/**
 * 剪贴板
 * - VSCode webview：经 `trpc.host.clipboard*`（扩展宿主覆盖为 `vscode.env.clipboard`）
 * - 非 webview（HTTP/HTTPS）：直接用 execCommand / navigator.clipboard
 */

import { trpc } from "./trpc-client";
import { isVsCodeWebview } from "./platform";

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
  if (isVsCodeWebview()) {
    await trpc.host.clipboardWrite.mutate({ text });
    return;
  }
  execCommandCopy(text);
}

/** Webview 下供编辑器桥接读取系统剪贴板（经扩展 `vscode.env.clipboard`） */
export async function readClipboardText(): Promise<string> {
  if (isVsCodeWebview()) {
    const res = await trpc.host.clipboardRead.query();
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
