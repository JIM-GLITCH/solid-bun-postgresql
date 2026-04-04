/**
 * 对齐 VS Code / Monaco：无选区复制整行时带内存标记，粘贴时按「整行」插到当前行行首（与光标列无关）。
 * 见 monaco `PasteOperation._simplePaste`（pasteOnNewLine + 唯一换行在末尾）及 vscode `InMemoryClipboardMetadataManager`。
 */
import type * as monaco from "monaco-editor";

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
export function tryVsCodeStyleEmptySelectionLinePaste(
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
