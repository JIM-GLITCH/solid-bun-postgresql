/**
 * Monaco Editor SQL 编辑器 - Solid.js 封装
 * 静态导入，Monaco 会随主包一起打包；Workers 从 ./vs 加载（需复制或提供）
 * Ctrl+Enter：有选区则执行选区，否则按 ; 或空行分块（引号内 ; 不分），执行光标所在块。
 */
import { onMount, onCleanup, createEffect } from "solid-js";
import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { buildAndDefineVscodeTheme, VSCODE_MONACO_THEME } from "./monaco-vscode-theme";

function ensureExecHighlightStyle() {
  if (document.getElementById("monaco-sql-exec-highlight-style")) return;
  const el = document.createElement("style");
  el.id = "monaco-sql-exec-highlight-style";
  el.textContent = `
    .monaco-sql-exec-highlight { background: rgba(255, 193, 7, 0.4) !important; border-radius: 2px; }
  `;
  document.head.appendChild(el);
}
import { getTheme, subscribe } from "./theme-sync";

/**
 * 按「分号」或「空行」分块：任一到就结束当前块（方便不写分号的写法）。
 * 分号在引号内不视为分隔符。空行 = 仅空白的一行，块在空行前结束，下一块从空行后开始。
 * 返回光标所在块的文本及在全文中的起止偏移。
 */
function getSqlBlockAtCursor(
  text: string,
  offset: number
): { text: string; start: number; end: number } {
  const empty = { text: "", start: 0, end: 0 };
  if (!text.length) return empty;

  const parts: { start: number; end: number }[] = [];
  let blockStart = 0;
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < text.length) {
    const c = text[i];

    if (inSingle) {
      if (c === "'") {
        if (i + 1 < text.length && text[i + 1] === "'") i++;
        else inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"' && (i === 0 || text[i - 1] !== "\\")) inDouble = false;
      i++;
      continue;
    }

    if (c === ";") {
      if (blockStart < i) parts.push({ start: blockStart, end: i + 1 });
      blockStart = i + 1;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i++;
      continue;
    }

    if (c === "\n") {
      let j = i + 1;
      while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\r")) j++;
      const nextIsNewlineOrEnd = j >= text.length || text[j] === "\n";
      if (nextIsNewlineOrEnd) {
        if (blockStart < i) parts.push({ start: blockStart, end: i + 1 });
        while (j < text.length) {
          if (text[j] === "\n") {
            j++;
            while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\r")) j++;
          } else break;
        }
        blockStart = j;
        i = j - 1;
      }
    }
    i++;
  }

  if (blockStart < text.length) parts.push({ start: blockStart, end: text.length });

  const segment = parts.find((p) => offset >= p.start && offset <= p.end)
    ?? parts[0]
    ?? { start: 0, end: 0 };
  const textTrimmed = text.slice(segment.start, segment.end).trim();
  return { text: textTrimmed, start: segment.start, end: segment.end };
}

// Workers 从 ./vs 加载（Monaco 0.55.1 min hashed 文件名）
// When running inside the VS Code webview we allow overriding via window.__MONACO_BASE__
const MONACO_BASE = (typeof window !== 'undefined' && (window as any).__MONACO_BASE__) || "./vs";
if (typeof self !== "undefined") {
  (self as any).MonacoEnvironment = {
    getWorkerUrl: (_: string, label: string) => {
      if (label === "json") return `${MONACO_BASE}/assets/json.worker-DKiEKt88.js`;
      if (label === "css" || label === "scss" || label === "less") return `${MONACO_BASE}/assets/css.worker-HnVq6Ewq.js`;
      if (label === "html" || label === "handlebars" || label === "razor") return `${MONACO_BASE}/assets/html.worker-B51mlPHg.js`;
      if (label === "typescript" || label === "javascript") return `${MONACO_BASE}/assets/ts.worker-CMbG-7ft.js`;
      return `${MONACO_BASE}/assets/editor.worker-Be8ye1pW.js`;
    },
  };
}

export interface SqlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** 执行时传入要运行的 SQL（选区或光标所在块）；不传则由调用方决定（如执行全部） */
  onRun?: (sqlToRun?: string) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  style?: string | Record<string, string>;
}

export default function SqlEditor(props: SqlEditorProps) {
  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(() => {
    ensureExecHighlightStyle();
    (window as any).monaco = monaco;
    const themeInfo = getTheme();
    const initialTheme = themeInfo?.monacoTheme ?? 'vs-dark';
    if (initialTheme === VSCODE_MONACO_THEME && themeInfo) {
      buildAndDefineVscodeTheme(monaco, themeInfo.themeKind);
    }
    editor = monaco.editor.create(container, {
      value: props.value,
      language: "sql",
      theme: initialTheme,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: "on",
      wordWrap: "on",
      automaticLayout: true,
    });

    // subscribe to theme changes
    const unsub = subscribe((t) => {
      try {
        if (t.monacoTheme === VSCODE_MONACO_THEME) {
          buildAndDefineVscodeTheme(monaco, t.themeKind);
        }
        monaco.editor.setTheme(t.monacoTheme);
      } catch (e) {}
    });

    editor.onDidChangeModelContent(() => {
      const val = editor!.getValue();
      if (props.onChange && val !== props.value) {
        props.onChange(val);
      }
    });

    const HIGHLIGHT_DECORATION_KEY = "sql-exec-highlight";
    let highlightDecorationIds: string[] = [];

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      const model = editor.getModel();
      const selection = editor.getSelection();
      const hasSelection = selection && !selection.isEmpty();

      const clearHighlight = () => {
        if (highlightDecorationIds.length) {
          highlightDecorationIds = editor!.deltaDecorations(highlightDecorationIds, []);
        }
      };

      const highlightRange = (startOffset: number, endOffset: number) => {
        if (!model || startOffset >= endOffset) return;
        const start = model.getPositionAt(startOffset);
        const end = model.getPositionAt(endOffset);
        if (!start || !end) return;
        clearHighlight();
        highlightDecorationIds = editor!.deltaDecorations([], [
          {
            range: { startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column },
            options: { className: "monaco-sql-exec-highlight" },
          },
        ]);
        editor!.revealRangeInCenter({ startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column });
        setTimeout(clearHighlight, 1200);
      };

      if (hasSelection && model) {
        const sqlToRun = model.getValueInRange(selection!).trim();
        if (sqlToRun) {
          const start = model.getOffsetAt(selection!.getStartPosition());
          const end = model.getOffsetAt(selection!.getEndPosition());
          highlightRange(start, end);
          props.onRun?.(sqlToRun);
          return;
        }
      }
      if (model) {
        const position = editor.getPosition();
        const full = model.getValue();
        const offset = position ? model.getOffsetAt(position) : 0;
        const block = getSqlBlockAtCursor(full, offset);
        if (block.text) {
          highlightRange(block.start, block.end);
          props.onRun?.(block.text);
        } else {
          props.onRun?.();
        }
      } else {
        props.onRun?.();
      }
    });
    onCleanup(() => unsub());
  });

  createEffect(() => {
    const val = props.value;
    if (editor && editor.getValue() !== val) {
      editor.setValue(val);
    }
  });

  onCleanup(() => {
    editor?.dispose();
  });

  return (
    <div
      ref={container!}
      data-sql-editor
      class={props.class}
      style={{
        height: "100%",
        width: "100%",
        ...(typeof props.style === "object" ? props.style : {}),
      }}
    />
  );
}
