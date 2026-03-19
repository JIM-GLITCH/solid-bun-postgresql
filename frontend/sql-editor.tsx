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
    .monaco-sql-exec-highlight { background: rgba(33, 150, 243, 0.4) !important; border-radius: 2px; }
    .monaco-sql-codelens {
      display: flex; align-items: center; gap: 0;       padding: 0;
      width: 100%; box-sizing: border-box; min-height: 12px;
      font-size: 11px; font-family: var(--monaco-monospace-font, "Menlo", "Monaco", "Consolas", monospace);
      pointer-events: auto; user-select: none; position: relative; z-index: 10;
      color: var(--vscode-editorCodeLens-foreground, #999);
    }
    .monaco-sql-codelens .sql-codelens-link {
      cursor: pointer; border: none; background: none; padding: 0 6px 0 0;
      color: inherit; font: inherit; display: inline-flex; align-items: center; gap: 2px;
      text-decoration: none; pointer-events: auto;
    }
    .monaco-sql-codelens .sql-codelens-link:hover { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: underline; }
    .monaco-sql-codelens .sql-codelens-link .sql-codelens-icon { font-size: 9px; opacity: 0.9; }
    .monaco-sql-codelens .sql-codelens-sep { color: var(--vscode-editorCodeLens-foreground, #999); opacity: 0.6; padding: 0 6px; user-select: none; }
  `;
  document.head.appendChild(el);
}
import { getTheme, subscribe } from "./theme-sync";
import { getSqlSegments } from "../shared/src";
import { registerSqlEditor } from "./monaco-paste-registry";
import { readClipboardText, writeClipboardText } from "./clipboard";

/** 光标所在块的文本及起止偏移（与后端 getStatements 同一套分块规则，前端多「空行」边界）。 */
function getSqlBlockAtCursor(
  text: string,
  offset: number
): { text: string; start: number; end: number } {
  const empty = { text: "", start: 0, end: 0 };
  if (!text.length) return empty;
  const parts = getSqlSegments(text, { blankLineSeparator: true });
  const segment = parts.find((p) => offset >= p.start && offset <= p.end)
    ?? parts[0]
    ?? { start: 0, end: 0 };
  return {
    text: text.slice(segment.start, segment.end).trim(),
    start: segment.start,
    end: segment.end,
  };
}

/** 全文所有块的 [start, end]，与 getSqlBlockAtCursor 一致。 */
function getAllBlocks(text: string): { start: number; end: number }[] {
  return getSqlSegments(text, { blankLineSeparator: true });
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
  /** 执行 EXPLAIN 时传入要分析的 SQL */
  onExplain?: (sqlToRun: string) => void;
  /** 格式化函数：传入当前 SQL 返回格式化后的 SQL，在编辑器内用 executeEdits 应用以便支持 Ctrl+Z */
  onFormat?: (sql: string) => string | void;
  /** 编辑器就绪后回调，可调用 api.format() 触发格式化（供工具栏按钮用） */
  onEditorReady?: (api: { format: () => void }) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  style?: string | Record<string, string>;
}

export default function SqlEditor(props: SqlEditorProps) {
  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  /** 刚通过 executeEdits 应用的格式化结果，effect 里若 val 等于它则跳过 setValue，避免清空撤销栈 */
  let lastFormattedValue: string | null = null;

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

    const blockRunZoneIds: string[] = [];
    const highlightDecorations = editor.createDecorationsCollection();

    const runBlockWithHighlight = (startOffset: number, endOffset: number) => {
      const model = editor?.getModel();
      if (!model || startOffset >= endOffset) return;
      const sql = model.getValue().slice(startOffset, endOffset).trim();
      if (!sql) return;
      const startPos = model.getPositionAt(startOffset);
      const endPos = model.getPositionAt(endOffset);
      if (!startPos || !endPos) return;
      highlightDecorations.clear();
      highlightDecorations.set([
        {
          range: { startLineNumber: startPos.lineNumber, startColumn: startPos.column, endLineNumber: endPos.lineNumber, endColumn: endPos.column },
          options: { className: "monaco-sql-exec-highlight" },
        },
      ]);
      editor?.revealRangeInCenter({ startLineNumber: startPos.lineNumber, startColumn: startPos.column, endLineNumber: endPos.lineNumber, endColumn: endPos.column });
      props.onRun?.(sql);
      setTimeout(() => highlightDecorations.clear(), 200);
    };

    const createToolbarDomNodeForBlocks = (text: string, blocks: { start: number; end: number }[]): HTMLElement => {
      const dom = document.createElement("div");
      dom.className = "monaco-sql-codelens";
      dom.style.pointerEvents = "auto";
      const stop = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      dom.addEventListener("mousedown", stop, true);
      dom.addEventListener("mouseup", stop, true);
      blocks.forEach((b, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "sql-codelens-sep";
          sep.textContent = "|";
          dom.appendChild(sep);
        }
        const runBtn = document.createElement("button");
        runBtn.type = "button";
        runBtn.className = "sql-codelens-link";
        runBtn.innerHTML = '<span class="sql-codelens-icon">▶</span> Run';
        runBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          runBlockWithHighlight(b.start, b.end);
        });
        dom.appendChild(runBtn);
        if (props.onExplain) {
          const explainSep = document.createElement("span");
          explainSep.className = "sql-codelens-sep";
          explainSep.textContent = "|";
          dom.appendChild(explainSep);
          const explainBtn = document.createElement("button");
          explainBtn.type = "button";
          explainBtn.className = "sql-codelens-link";
          explainBtn.innerHTML = '<span class="sql-codelens-icon">📊</span> Explain';
          explainBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sql = text.slice(b.start, b.end).trim();
            if (sql) props.onExplain!(sql);
          });
          dom.appendChild(explainBtn);
        }
      });
      return dom;
    };

    const updateBlockRunZones = () => {
      const model = editor!.getModel();
      if (!model) return;
      editor!.changeViewZones((accessor) => {
        blockRunZoneIds.forEach((id) => accessor.removeZone(id));
        blockRunZoneIds.length = 0;
        const text = model.getValue();
        const blocks = getAllBlocks(text).filter((b) => text.slice(b.start, b.end).trim());
        const byLine = new Map<number, { start: number; end: number }[]>();
        blocks.forEach((b) => {
          const pos = model.getPositionAt(b.start);
          if (!pos) return;
          const line = pos.lineNumber;
          if (!byLine.has(line)) byLine.set(line, []);
          byLine.get(line)!.push({ start: b.start, end: b.end });
        });
        byLine.forEach((blocksOnLine, lineNumber) => {
          const afterLine = Math.max(0, lineNumber - 1);
          const zoneId = accessor.addZone({
            afterLineNumber: afterLine,
            heightInPx: 12,
            minWidthInPx: 200,
            domNode: createToolbarDomNodeForBlocks(text, blocksOnLine),
            suppressMouseDown: true,
          });
          blockRunZoneIds.push(zoneId);
        });
      });
    };

    editor.onDidChangeModelContent(() => {
      const val = editor!.getValue();
      if (props.onChange && val !== props.value) {
        props.onChange(val);
      }
      updateBlockRunZones();
    });

    updateBlockRunZones();

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (!editor) return;
      const model = editor.getModel();
      const selection = editor.getSelection();
      const hasSelection = selection && !selection.isEmpty();

      if (hasSelection && model) {
        const sqlToRun = model.getValueInRange(selection!).trim();
        if (sqlToRun) {
          const start = model.getOffsetAt(selection!.getStartPosition());
          const end = model.getOffsetAt(selection!.getEndPosition());
          runBlockWithHighlight(start, end);
          return;
        }
      }
      if (model) {
        const position = editor.getPosition();
        const full = model.getValue();
        const offset = position ? model.getOffsetAt(position) : 0;
        const block = getSqlBlockAtCursor(full, offset);
        if (block.text) {
          runBlockWithHighlight(block.start, block.end);
        } else {
          props.onRun?.();
        }
      } else {
        props.onRun?.();
      }
    });

    const doFormat = () => {
      const model = editor?.getModel();
      if (!model || !props.onFormat) return;
      const current = model.getValue();
      const formatted = props.onFormat(current);
      if (typeof formatted === "string" && formatted !== current) {
        editor!.executeEdits("format", [
          { range: model.getFullModelRange(), text: formatted },
        ]);
        lastFormattedValue = formatted;
        props.onChange?.(formatted);
      }
    };

    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, doFormat);

    // Webview 中 clipboard 受限：统一用 vscode.env.clipboard 桥接，保持单一剪贴板状态
    const doPaste = () => {
      const model = editor?.getModel();
      const sel = editor?.getSelection();
      if (!model || !sel) return;
      readClipboardText().then((text) => {
        if (!text) return;
        if (sel.isEmpty()) {
          // 无选区：与 VSCode 一致，粘贴到下一行并自动加换行
          const lineNumber = sel.startLineNumber;
          const endCol = model.getLineMaxColumn(lineNumber);
          const range = {
            startLineNumber: lineNumber,
            startColumn: endCol,
            endLineNumber: lineNumber,
            endColumn: endCol,
          };
          editor!.executeEdits("paste", [{ range, text: "\n" + text }]);
          editor!.setPosition({ lineNumber: lineNumber + 1, column: 1 });
          editor!.revealLineInCenter(lineNumber + 1);
        } else {
          // 有选区：在光标处替换选区
          const range = {
            startLineNumber: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLineNumber: sel.endLineNumber,
            endColumn: sel.endColumn,
          };
          editor!.executeEdits("paste", [{ range, text }]);
        }
      });
    };
    // copy/cut：仅同步到 vscode 剪贴板（副作用），不阻止 Monaco 默认行为
    const syncCopyToVscode = () => {
      const model = editor?.getModel();
      const sel = editor?.getSelection();
      if (!model || !sel) return;
      const text = sel.isEmpty()
        ? model.getLineContent(sel.startLineNumber)
        : model.getValueInRange(sel);
      writeClipboardText(text);
    };
    let keyDownDispose: monaco.IDisposable | undefined;
    let pasteDom: HTMLElement | null = null;
    const onPaste = (ev: ClipboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      doPaste();
    };
    const onCopy = (ev: ClipboardEvent) => {
      syncCopyToVscode();
      // 不 preventDefault，让 Monaco 保持默认复制行为
    };
    const onCut = (ev: ClipboardEvent) => {
      syncCopyToVscode();
      // 不 preventDefault，让 Monaco 保持默认剪切行为（删除选区）
    };
    if (typeof (window as any).acquireVsCodeApi === "function") {
      keyDownDispose = editor.onKeyDown((e) => {
        if ((e.ctrlKey || e.metaKey) && (e.browserEvent?.key?.toLowerCase() === "v" || e.keyCode === monaco.KeyCode.KeyV)) {
          e.preventDefault();
          e.stopPropagation();
          doPaste();
        }
        if ((e.ctrlKey || e.metaKey) && (e.browserEvent?.key?.toLowerCase() === "x" || e.keyCode === monaco.KeyCode.KeyX)) {
          e.preventDefault();
          e.stopPropagation();
          const model = editor?.getModel();
          const sel = editor?.getSelection();
          if (!model || !sel) return;
          const text = sel.isEmpty()
            ? model.getLineContent(sel.startLineNumber)
            : model.getValueInRange(sel);
          writeClipboardText(text);
          if (sel.isEmpty()) {
            // cut whole line: delete line including newline
            const lineNumber = sel.startLineNumber;
            const lineCount = model.getLineCount();
            const range = lineNumber < lineCount
              ? { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber + 1, endColumn: 1 }
              : { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: model.getLineMaxColumn(lineNumber) };
            editor!.executeEdits("cut", [{ range, text: "" }]);
          } else {
            editor!.executeEdits("cut", [{ range: sel, text: "" }]);
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
    }

    registerSqlEditor(container, editor);

    props.onEditorReady?.({ format: doFormat });

    onCleanup(() => {
      if (pasteDom) {
        pasteDom.removeEventListener("paste", onPaste, true);
        pasteDom.removeEventListener("copy", onCopy, true);
        pasteDom.removeEventListener("cut", onCut, true);
      }
      keyDownDispose?.dispose();
      registerSqlEditor(container, null);
      unsub();
    });
  });

  createEffect(() => {
    const val = props.value;
    if (!editor) return;
    if (val === lastFormattedValue) {
      lastFormattedValue = null;
      return;
    }
    if (editor.getValue() !== val) {
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
