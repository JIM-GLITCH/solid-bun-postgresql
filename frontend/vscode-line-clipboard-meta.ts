/**
 * 对齐 VS Code / Monaco：无选区复制整行时带内存标记，粘贴时按「整行」插到当前行行首（与光标列无关）。
 * 见 monaco `PasteOperation._simplePaste`（pasteOnNewLine + 唯一换行在末尾）及 vscode `InMemoryClipboardMetadataManager`。
 */
import type * as monaco from "monaco-editor";
import { Range } from "monaco-editor";

export function normalizeClipboardNewlines(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

let lastEmptySelectionLineCopyNormalized: string | undefined;

export function recordEmptySelectionLineCopyForWebview(normalizedLinePlusLf: string) {
  lastEmptySelectionLineCopyNormalized = normalizedLinePlusLf;
}

export function clearEmptySelectionLineCopyMeta() {
  lastEmptySelectionLineCopyNormalized = undefined;
}

/** 是否与最近一次「无选区复制行」一致，且内容为「单行 + 尾随 \\n」（与 Monaco 判定一致） */
function isPasteAsLineFromRecordedEmptyCopy(textNormalized: string): boolean {
  if (lastEmptySelectionLineCopyNormalized === undefined) return false;
  if (textNormalized !== lastEmptySelectionLineCopyNormalized) return false;
  if (textNormalized.indexOf("\n") !== textNormalized.length - 1) return false;
  return true;
}

/**
 * 若满足 VS Code 式整行粘贴，在**当前行行首**插入并返回 true；否则返回 false（由调用方走普通粘贴）。
 */
function tryVsCodeStyleEmptySelectionLinePaste(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  sel: monaco.Selection,
  textRaw: string
): boolean {
  const text = normalizeClipboardNewlines(textRaw);
  if (!sel.isEmpty() || !isPasteAsLineFromRecordedEmptyCopy(text)) return false;

  const line = sel.startLineNumber;
  editor.executeEdits("paste", [
    {
      range: {
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: 1,
      },
      text,
    },
  ]);
  const endCol = model.getLineMaxColumn(line);
  const pos = { lineNumber: line, column: endCol };
  editor.setPosition(pos);
  editor.revealPositionInCenter(pos);
  return true;
}

function applySingleMonacoPasteEdit(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  sel: monaco.Selection,
  norm: string
): void {
  if (sel.isEmpty()) {
    const line = sel.startLineNumber;
    const col = sel.startColumn;
    const startOffset = model.getOffsetAt({ lineNumber: line, column: col });
    editor.executeEdits("paste", [
      {
        range: { startLineNumber: line, startColumn: col, endLineNumber: line, endColumn: col },
        text: norm,
      },
    ]);
    const endPos = model.getPositionAt(startOffset + norm.length);
    editor.setPosition(endPos);
    editor.revealPositionInCenter(endPos);
  } else {
    editor.executeEdits("paste", [
      {
        range: {
          startLineNumber: sel.startLineNumber,
          startColumn: sel.startColumn,
          endLineNumber: sel.endLineNumber,
          endColumn: sel.endColumn,
        },
        text: norm,
      },
    ]);
  }
}

/**
 * Webview 剪贴板桥接：必须用 `getSelections()`，否则多光标时只会处理主选区。
 * 多光标按文档位置从后往前一次 executeEdits，避免偏移错乱；单光标仍支持 VS Code 式行首整行粘贴。
 */
export function applyWebviewMonacoPaste(
  editor: monaco.editor.IStandaloneCodeEditor,
  model: monaco.editor.ITextModel,
  textRaw: string
): void {
  const norm = normalizeClipboardNewlines(textRaw);
  const sels = editor.getSelections();
  if (!sels?.length) return;

  if (sels.length === 1) {
    const sel = sels[0]!;
    if (tryVsCodeStyleEmptySelectionLinePaste(editor, model, sel, textRaw)) return;
    applySingleMonacoPasteEdit(editor, model, sel, norm);
    return;
  }

  const sorted = [...sels].sort((a, b) => Range.compareRangesUsingStarts(b, a));
  const edits = sorted.map((s) =>
    s.isEmpty()
      ? {
          range: {
            startLineNumber: s.startLineNumber,
            startColumn: s.startColumn,
            endLineNumber: s.startLineNumber,
            endColumn: s.startColumn,
          },
          text: norm,
        }
      : {
          range: {
            startLineNumber: s.startLineNumber,
            startColumn: s.startColumn,
            endLineNumber: s.endLineNumber,
            endColumn: s.endColumn,
          },
          text: norm,
        }
  );
  editor.executeEdits("paste", edits);
}
