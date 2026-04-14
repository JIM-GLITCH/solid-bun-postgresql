/**
 * 编辑器相关 VS Code CSS 变量映射（CodeMirror 主题等复用）
 * fallback 与 VS Code Dark 默认编辑器色一致
 */
export type MonacoColorKey =
  | "editor.background"
  | "editor.foreground"
  | "editorCursor.foreground"
  | "editor.selectionBackground"
  | "editor.selectionForeground"
  | "editor.inactiveSelectionBackground"
  | "editor.lineHighlightBackground"
  | "editorLineNumber.foreground"
  | "editorLineNumber.activeForeground"
  | "editorIndentGuide.background"
  | "editorIndentGuide.activeBackground"
  | "editorWidget.background"
  | "editorWidget.border"
  | "editorSuggestWidget.background"
  | "editorSuggestWidget.border"
  | "editorSuggestWidget.foreground"
  | "editorSuggestWidget.selectedBackground"
  | "editorHoverWidget.background"
  | "editorHoverWidget.border"
  | "editorGutter.background";

export const EDITOR_THEME_MAP: Record<MonacoColorKey, { var: string; fallback: string }> = {
  "editor.background": { var: "--vscode-editor-background", fallback: "#1E1E1E" },
  "editor.foreground": { var: "--vscode-editor-foreground", fallback: "#D4D4D4" },
  "editorCursor.foreground": { var: "--vscode-editorCursor-foreground", fallback: "#AEAFAD" },
  "editor.selectionBackground": { var: "--vscode-editor-selectionBackground", fallback: "#264F78" },
  "editor.selectionForeground": { var: "--vscode-editor-selectionForeground", fallback: "#ffffff" },
  "editor.inactiveSelectionBackground": {
    var: "--vscode-editor-inactiveSelectionBackground",
    fallback: "#3a3d41",
  },
  "editor.lineHighlightBackground": {
    var: "--vscode-editor-lineHighlightBackground",
    fallback: "#2a2d2e",
  },
  "editorLineNumber.foreground": { var: "--vscode-editorLineNumber-foreground", fallback: "#858585" },
  "editorLineNumber.activeForeground": {
    var: "--vscode-editorLineNumber-activeForeground",
    fallback: "#c6c6c6",
  },
  "editorIndentGuide.background": {
    var: "--vscode-editorIndentGuide-background",
    fallback: "#404040",
  },
  "editorIndentGuide.activeBackground": {
    var: "--vscode-editorIndentGuide-activeBackground",
    fallback: "#707070",
  },
  "editorWidget.background": { var: "--vscode-editorWidget-background", fallback: "#252526" },
  "editorWidget.border": { var: "--vscode-editorWidget-border", fallback: "#454545" },
  "editorSuggestWidget.background": {
    var: "--vscode-editorSuggestWidget-background",
    fallback: "#252526",
  },
  "editorSuggestWidget.border": {
    var: "--vscode-editorSuggestWidget-border",
    fallback: "#454545",
  },
  "editorSuggestWidget.foreground": {
    var: "--vscode-editorSuggestWidget-foreground",
    fallback: "#D4D4D4",
  },
  "editorSuggestWidget.selectedBackground": {
    var: "--vscode-editorSuggestWidget-selectedBackground",
    fallback: "#094771",
  },
  "editorHoverWidget.background": {
    var: "--vscode-editorHoverWidget-background",
    fallback: "#252526",
  },
  "editorHoverWidget.border": {
    var: "--vscode-editorHoverWidget-border",
    fallback: "#454545",
  },
  "editorGutter.background": { var: "--vscode-editorGutter-background", fallback: "#1E1E1E" },
};

export const EDITOR_THEME_KEYS = Object.keys(EDITOR_THEME_MAP) as MonacoColorKey[];
