/**
 * VSCode Webview 入口：使用 VsCodeTransport 与 Extension Host 通信，再渲染与 standalone 相同的前端
 */
import { render } from "solid-js/web";
import { setTransport } from "./transport";
import { VsCodeTransport } from "./transport/vscode-transport";
import App from "./app";
import { DialogProvider } from "./dialog-context";
import { initWebviewThemeListener } from "./theme-sync";
import { readClipboardText } from "./clipboard";
import { resolveMonacoEditorForPaste } from "./monaco-paste-registry";
import { applyWebviewMonacoPaste } from "./vscode-line-clipboard-meta";

setTransport(new VsCodeTransport());

// start listening for theme messages from extension
initWebviewThemeListener();

// Webview 中 paste 受限，通过扩展的 clipboard 桥接
document.addEventListener(
  "paste",
  (e) => {
    const target = e.target as HTMLElement;
    const editor =
      resolveMonacoEditorForPaste(target) ??
      (document.activeElement instanceof HTMLElement
        ? resolveMonacoEditorForPaste(document.activeElement)
        : null);
    if (editor) {
      const model = editor.getModel();
      if (model) {
        e.preventDefault();
        e.stopPropagation();
        readClipboardText().then((text) => {
          if (!text) return;
          applyWebviewMonacoPaste(editor, model, text);
        });
      }
      return;
    }
    // 仅 Monaco 自带隐藏 inputarea 在未命中 editor 路径时跳过：勿 splice 破坏输入层。
    // AI 指令框等落在 .monaco-editor 内的原生 input 仍应走下方剪贴板桥接。
    if (
      target instanceof HTMLTextAreaElement &&
      target.classList.contains("inputarea") &&
      target.closest(".monaco-editor")
    ) {
      return;
    }

    const editable =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target.isContentEditable;
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    readClipboardText().then((text) => {
      if (!text) return;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        const el = target;
        const start = el.selectionStart ?? 0;
        const end = el.selectionEnd ?? 0;
        const val = el.value;
        el.value = val.slice(0, start) + text + val.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      } else {
        target.focus();
        document.execCommand("insertText", false, text);
      }
    });
  },
  true
);

const root = document.getElementById("root");
if (root) {
  render(() => (
    <DialogProvider>
      <App />
    </DialogProvider>
  ), root);
}
