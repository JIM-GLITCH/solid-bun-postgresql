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
import { getSqlEditorForElement } from "./monaco-paste-registry";

setTransport(new VsCodeTransport());

// start listening for theme messages from extension
initWebviewThemeListener();

// Webview 中 paste 受限，通过扩展的 clipboard 桥接
document.addEventListener(
  "paste",
  (e) => {
    const target = e.target as HTMLElement;
    const inMonaco = target.closest("[data-sql-editor]") || target.closest(".monaco-editor");
    if (inMonaco) {
      e.preventDefault();
      e.stopPropagation();
      const editor =
        getSqlEditorForElement(target) ??
        (document.activeElement && getSqlEditorForElement(document.activeElement as HTMLElement));
      if (editor) {
        const model = editor.getModel();
        const sel = editor.getSelection();
        if (model && sel) {
          readClipboardText().then((text) => {
            if (!text) return;
            if (sel.isEmpty()) {
              const lineNumber = sel.startLineNumber;
              const endCol = model.getLineMaxColumn(lineNumber);
              editor.executeEdits("paste", [
                {
                  range: {
                    startLineNumber: lineNumber,
                    startColumn: endCol,
                    endLineNumber: lineNumber,
                    endColumn: endCol,
                  },
                  text: "\n" + text,
                },
              ]);
              editor.setPosition({ lineNumber: lineNumber + 1, column: 1 });
              editor.revealLineInCenter(lineNumber + 1);
            } else {
              editor.executeEdits("paste", [
                {
                  range: {
                    startLineNumber: sel.startLineNumber,
                    startColumn: sel.startColumn,
                    endLineNumber: sel.endLineNumber,
                    endColumn: sel.endColumn,
                  },
                  text,
                },
              ]);
            }
          });
        }
      }
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
