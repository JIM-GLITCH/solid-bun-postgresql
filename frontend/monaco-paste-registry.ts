/**
 * Monaco 实例解析，供 Webview 全局 paste 桥接使用（SQL 主编辑器 + JSONB Monaco 等）
 */
import type * as monaco from "monaco-editor";
import * as monacoApi from "monaco-editor";

const editorMap = new WeakMap<HTMLElement, monaco.editor.IStandaloneCodeEditor>();

export function registerSqlEditor(container: HTMLElement, editor: monaco.editor.IStandaloneCodeEditor | null) {
  if (editor) {
    editorMap.set(container, editor);
  } else {
    editorMap.delete(container);
  }
}

export function getSqlEditorForElement(el: HTMLElement): monaco.editor.IStandaloneCodeEditor | null {
  const container = el.closest("[data-sql-editor]") as HTMLElement | null;
  return container ? editorMap.get(container) ?? null : null;
}

/**
 * 从事件目标解析应接收粘贴的 Monaco 编辑器。
 * 先走已注册的 SQL 容器；否则在 `.monaco-editor` 内时用 `getEditors()` 匹配 DOM（覆盖 JSONB 等未单独注册的实例）。
 *
 * `data-sql-editor` 内的原生 `<input>` / 普通 `<textarea>`（如 Ctrl+K AI 指令框）须返回 null，
 * 否则 Webview 全局 paste 会把内容贴进主编辑器而非焦点控件。
 */
export function resolveMonacoEditorForPaste(el: HTMLElement): monaco.editor.IStandaloneCodeEditor | null {
  if (el instanceof HTMLInputElement) return null;
  if (el instanceof HTMLTextAreaElement && !el.classList.contains("inputarea")) return null;
  const registered = getSqlEditorForElement(el);
  if (registered) return registered;
  if (!el.closest(".monaco-editor")) return null;
  for (const ed of monacoApi.editor.getEditors()) {
    const dom = ed.getDomNode();
    if (dom?.contains(el)) return ed as monaco.editor.IStandaloneCodeEditor;
  }
  return null;
}
