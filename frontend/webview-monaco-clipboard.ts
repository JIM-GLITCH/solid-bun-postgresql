/**
 * VS Code Webview：Monaco 无法直接使用系统剪贴板时，经扩展 `vscode.env.clipboard` 桥接。
 * 仅挂在编辑器 DOM 上（捕获阶段 + onKeyDown），不污染 document 级监听。
 */
import * as monaco from "monaco-editor";
import { readClipboardText, writeClipboardText } from "./clipboard";
import {
  applyWebviewMonacoPaste,
  clearEmptySelectionLineCopyMeta,
  normalizeClipboardNewlines,
  recordEmptySelectionLineCopyForWebview,
} from "./vscode-line-clipboard-meta";

const isVsCodeWebview = () => typeof (window as unknown as { acquireVsCodeApi?: () => unknown }).acquireVsCodeApi === "function";

export type WebviewMonacoClipboardDelegates = {
  /** 为 true 时不拦截，交给浏览器默认行为（如 AI 指令框内粘贴） */
  shouldDelegatePaste?: (ev: ClipboardEvent) => boolean;
  shouldDelegateCopyCut?: (ev: ClipboardEvent) => boolean;
  /** Ctrl/Cmd+V：为 true 时不走桥接 */
  shouldSkipPasteShortcut?: () => boolean;
  /** Ctrl/Cmd+X：为 true 时不走桥接 */
  shouldSkipCutShortcut?: () => boolean;
};

/** 静态委托，或每次事件时解析（便于 create 早于 AI 面板等依赖存在） */
export type WebviewMonacoClipboardDelegatesInput =
  | WebviewMonacoClipboardDelegates
  | (() => WebviewMonacoClipboardDelegates | undefined);

function resolveClipboardDelegates(
  input: WebviewMonacoClipboardDelegatesInput | undefined
): WebviewMonacoClipboardDelegates {
  if (input === undefined) return {};
  if (typeof input === "function") return input() ?? {};
  return input;
}

/**
 * `monaco.editor.create` + Webview 剪贴板桥接；`disposeClipboardBridge` 须在 `editor.dispose()` 之前调用。
 */
export function createWebviewMonacoEditorWithClipboardBridge(
  container: HTMLElement,
  options: monaco.editor.IStandaloneEditorConstructionOptions,
  clipboardDelegates?: WebviewMonacoClipboardDelegatesInput
): {
  editor: monaco.editor.IStandaloneCodeEditor;
  disposeClipboardBridge: () => void;
} {
  const editor = monaco.editor.create(container, options);
  const disposeClipboardBridge = attachWebviewMonacoClipboardBridge(editor, clipboardDelegates);
  return { editor, disposeClipboardBridge };
}

/**
 * @returns 卸载函数；非 Webview 环境为空操作。
 */
export function attachWebviewMonacoClipboardBridge(
  editor: monaco.editor.IStandaloneCodeEditor,
  delegates?: WebviewMonacoClipboardDelegatesInput
): () => void {
  if (!isVsCodeWebview()) {
    return () => {};
  }

  const doPaste = () => {
    const ed = editor;
    const model = ed.getModel();
    if (!model) return;
    void readClipboardText().then((text) => {
      if (!text) return;
      applyWebviewMonacoPaste(ed, model, text);
    });
  };

  const syncCopyToVscode = () => {
    const model = editor.getModel();
    const sel = editor.getSelection();
    if (!model || !sel) return;
    if (sel.isEmpty()) {
      const t = normalizeClipboardNewlines(`${model.getLineContent(sel.startLineNumber)}\n`);
      recordEmptySelectionLineCopyForWebview(t);
      void writeClipboardText(t);
    } else {
      clearEmptySelectionLineCopyMeta();
      void writeClipboardText(model.getValueInRange(sel));
    }
  };

  let pasteDom: HTMLElement | null = null;
  const onPaste = (ev: ClipboardEvent) => {
    const d = resolveClipboardDelegates(delegates);
    const shouldDelegatePaste = d.shouldDelegatePaste ?? (() => false);
    if (shouldDelegatePaste(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    doPaste();
  };
  const onCopy = (ev: ClipboardEvent) => {
    const d = resolveClipboardDelegates(delegates);
    const shouldDelegateCopyCut = d.shouldDelegateCopyCut ?? (() => false);
    if (shouldDelegateCopyCut(ev)) {
      const t = ev.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
        const start = t.selectionStart ?? 0;
        const end = t.selectionEnd ?? 0;
        if (start !== end) {
          const text = t.value.slice(start, end);
          ev.preventDefault();
          ev.stopPropagation();
          clearEmptySelectionLineCopyMeta();
          void writeClipboardText(text);
          return;
        }
      }
    }
    syncCopyToVscode();
  };
  const onCut = (ev: ClipboardEvent) => {
    const d = resolveClipboardDelegates(delegates);
    const shouldDelegateCopyCut = d.shouldDelegateCopyCut ?? (() => false);
    if (shouldDelegateCopyCut(ev)) {
      const t = ev.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) {
        const start = t.selectionStart ?? 0;
        const end = t.selectionEnd ?? 0;
        if (start !== end) {
          const text = t.value.slice(start, end);
          ev.preventDefault();
          ev.stopPropagation();
          clearEmptySelectionLineCopyMeta();
          void writeClipboardText(text);
          t.value = t.value.slice(0, start) + t.value.slice(end);
          t.selectionStart = t.selectionEnd = start;
          t.dispatchEvent(new Event("input", { bubbles: true }));
          return;
        }
      }
    }
    syncCopyToVscode();
  };

  const keyDownDispose = editor.onKeyDown((e) => {
    const d = resolveClipboardDelegates(delegates);
    const shouldSkipPasteShortcut = d.shouldSkipPasteShortcut ?? (() => false);
    const shouldSkipCutShortcut = d.shouldSkipCutShortcut ?? (() => false);
    if ((e.ctrlKey || e.metaKey) && (e.browserEvent?.key?.toLowerCase() === "v" || e.keyCode === monaco.KeyCode.KeyV)) {
      if (shouldSkipPasteShortcut()) return;
      e.preventDefault();
      e.stopPropagation();
      doPaste();
    }
    if ((e.ctrlKey || e.metaKey) && (e.browserEvent?.key?.toLowerCase() === "x" || e.keyCode === monaco.KeyCode.KeyX)) {
      if (shouldSkipCutShortcut()) return;
      e.preventDefault();
      e.stopPropagation();
      const model = editor.getModel();
      const sel = editor.getSelection();
      if (!model || !sel) return;
      let text: string;
      if (sel.isEmpty()) {
        text = normalizeClipboardNewlines(`${model.getLineContent(sel.startLineNumber)}\n`);
        recordEmptySelectionLineCopyForWebview(text);
      } else {
        clearEmptySelectionLineCopyMeta();
        text = model.getValueInRange(sel);
      }
      void writeClipboardText(text);
      if (sel.isEmpty()) {
        const lineNumber = sel.startLineNumber;
        const lineCount = model.getLineCount();
        const range =
          lineNumber < lineCount
            ? { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber + 1, endColumn: 1 }
            : {
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: model.getLineMaxColumn(lineNumber),
              };
        editor.executeEdits("cut", [{ range, text: "" }]);
      } else {
        editor.executeEdits("cut", [{ range: sel, text: "" }]);
      }
    }
  });

  const dom = editor.getDomNode();
  if (dom) {
    pasteDom = dom;
    dom.addEventListener("paste", onPaste, true);
    dom.addEventListener("copy", onCopy, true);
    dom.addEventListener("cut", onCut, true);
  }

  return () => {
    if (pasteDom) {
      pasteDom.removeEventListener("paste", onPaste, true);
      pasteDom.removeEventListener("copy", onCopy, true);
      pasteDom.removeEventListener("cut", onCut, true);
    }
    keyDownDispose.dispose();
  };
}
