/**
 * Monaco SQL 编辑器引用注册，供 webview 中 paste 桥接使用
 */
import type * as monaco from "monaco-editor";

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
