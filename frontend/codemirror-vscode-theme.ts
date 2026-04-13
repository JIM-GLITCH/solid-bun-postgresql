import { EditorView } from "@codemirror/view";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Extension } from "@codemirror/state";

function cssVar(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`;
}

export function buildVsCodeCodeMirrorTheme(themeKind: "light" | "dark" | "high-contrast"): Extension[] {
  const isDark = themeKind === "dark" || themeKind === "high-contrast";
  const fontFamily = cssVar("--vscode-editor-font-family", "Consolas, monospace");
  const darkModern = {
    fg: "#cccccc",
    bg: "#1f1f1f",
    cursor: "#d4d4d4",
    selection: "rgba(33, 150, 243, 0.4)",
    lineHighlight: "rgba(255, 255, 255, 0.06)",
    lineNumber: "#858585",
    lineNumberActive: "#c6c6c6",
    border: "#3a3d41",
    widgetBg: "#252526",
    widgetBorder: "#454545",
    keyword: "#569cd6",
    function: "#dcdcaa",
    constant: "#4fc1ff",
    type: "#4ec9b0",
    number: "#b5cea8",
    string: "#ce9178",
    comment: "#6a9955",
    error: "#f14c4c",
  };

  const editorTheme = EditorView.theme(
    {
      "&": {
        color: cssVar("--vscode-editor-foreground", isDark ? darkModern.fg : "#1f2328"),
        backgroundColor: cssVar("--vscode-editor-background", isDark ? darkModern.bg : "#ffffff"),
        fontFamily,
        fontSize: cssVar("--vscode-editor-font-size", "13px"),
        fontWeight: cssVar("--vscode-editor-font-weight", "400"),
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily,
        overflow: "auto",
        maxHeight: "100%",
        scrollbarWidth: "thin",
        scrollbarColor: `${cssVar("--vscode-scrollbarSlider-background", "rgba(121, 121, 121, 0.4)")} transparent`,
      },
      ".cm-scroller::-webkit-scrollbar": {
        width: "14px",
        height: "14px",
      },
      ".cm-scroller::-webkit-scrollbar-track": {
        background: "transparent",
      },
      ".cm-scroller::-webkit-scrollbar-thumb": {
        backgroundColor: cssVar("--vscode-scrollbarSlider-background", "rgba(121, 121, 121, 0.4)"),
        borderRadius: "999px",
        border: "2px solid transparent",
        backgroundClip: "content-box",
      },
      ".cm-scroller::-webkit-scrollbar-thumb:hover": {
        backgroundColor: cssVar("--vscode-scrollbarSlider-hoverBackground", "rgba(100, 100, 100, 0.7)"),
      },
      ".cm-scroller::-webkit-scrollbar-thumb:active": {
        backgroundColor: cssVar("--vscode-scrollbarSlider-activeBackground", "rgba(191, 191, 191, 0.4)"),
      },
      ".cm-content": {
        caretColor: cssVar("--vscode-editorCursor-foreground", isDark ? darkModern.cursor : "#111111"),
        fontFamily,
        fontSize: "inherit",
        fontWeight: "inherit",
        lineHeight: cssVar("--vscode-editor-line-height", "1.6"),
        fontVariantLigatures: cssVar("--vscode-editor-font-ligatures", "none"),
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: cssVar("--vscode-editorCursor-foreground", isDark ? darkModern.cursor : "#111111"),
      },
      ".cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: `${isDark ? "rgba(33, 150, 243, 0.4)" : "rgba(33, 150, 243, 0.28)"} !important`,
      },
      ".cm-focused .cm-selectionLayer .cm-selectionBackground": {
        backgroundColor: `${isDark ? "rgba(33, 150, 243, 0.4)" : "rgba(33, 150, 243, 0.28)"} !important`,
      },
      ".cm-activeLine": {
        backgroundColor: cssVar(
          "--vscode-editor-lineHighlightBackground",
          isDark ? darkModern.lineHighlight : "rgba(0, 0, 0, 0.04)"
        ),
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
        color: cssVar("--vscode-editorLineNumber-activeForeground", isDark ? darkModern.lineNumberActive : "#1f2328"),
      },
      ".cm-gutters": {
        color: cssVar("--vscode-editorLineNumber-foreground", isDark ? darkModern.lineNumber : "#6e7681"),
        backgroundColor: "transparent",
        borderRight: "0 !important",
        boxShadow: "none",
        fontFamily: "inherit",
        fontSize: "inherit",
        fontWeight: "inherit",
        lineHeight: cssVar("--vscode-editor-line-height", "1.6"),
      },
      ".cm-gutter": {
        backgroundColor: "transparent",
        border: "none",
      },
      ".cm-gutters::after": {
        display: "none",
      },
      ".cm-lineNumbers .cm-gutterElement": {
        padding: "0 8px 0 6px",
        fontFamily,
        fontWeight: cssVar("--vscode-editor-font-weight", "400"),
        fontSize: cssVar("--vscode-editor-font-size", "13px"),
      },
      ".cm-tooltip": {
        border: `1px solid ${cssVar("--vscode-editorWidget-border", isDark ? darkModern.widgetBorder : "#c9c9c9")}`,
        backgroundColor: cssVar("--vscode-editorWidget-background", isDark ? darkModern.widgetBg : "#f3f3f3"),
      },
      ".cm-panels": {
        borderTop: `1px solid ${cssVar("--vscode-panel-border", isDark ? darkModern.border : "#d0d7de")}`,
        borderBottom: `1px solid ${cssVar("--vscode-panel-border", isDark ? darkModern.border : "#d0d7de")}`,
      },
    },
    { dark: isDark }
  );

  const highlight = HighlightStyle.define([
    { tag: tags.keyword, color: cssVar("--vscode-editorKeyword-foreground", isDark ? darkModern.keyword : "#0000ff") },
    { tag: [tags.name, tags.deleted, tags.character, tags.propertyName], color: cssVar("--vscode-editor-foreground", isDark ? darkModern.fg : "#1f2328") },
    { tag: [tags.function(tags.variableName), tags.labelName], color: cssVar("--vscode-editorFunction-foreground", isDark ? darkModern.function : "#795e26") },
    { tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)], color: cssVar("--vscode-editorConstant-foreground", isDark ? darkModern.constant : "#0070c1") },
    { tag: [tags.definition(tags.name), tags.separator], color: cssVar("--vscode-editor-foreground", isDark ? darkModern.fg : "#1f2328") },
    { tag: [tags.className], color: cssVar("--vscode-editorType-foreground", isDark ? darkModern.type : "#267f99") },
    { tag: [tags.number, tags.changed, tags.annotation, tags.modifier, tags.self, tags.namespace], color: cssVar("--vscode-editorNumericLiteral-foreground", isDark ? darkModern.number : "#098658") },
    { tag: [tags.typeName], color: cssVar("--vscode-editorType-foreground", isDark ? darkModern.type : "#267f99") },
    { tag: [tags.operator, tags.operatorKeyword], color: cssVar("--vscode-editor-foreground", isDark ? darkModern.fg : "#1f2328") },
    { tag: [tags.string, tags.special(tags.brace)], color: cssVar("--vscode-editorString-foreground", isDark ? darkModern.string : "#a31515") },
    { tag: [tags.meta, tags.comment], color: cssVar("--vscode-editorLineNumber-foreground", isDark ? darkModern.comment : "#008000") },
    { tag: tags.invalid, color: cssVar("--vscode-editorError-foreground", darkModern.error) },
  ]);

  return [editorTheme, syntaxHighlighting(highlight)];
}
