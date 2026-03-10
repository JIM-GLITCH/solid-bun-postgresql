/**
 * VS Code 风格主题色
 * fallback 与 Monaco vs-dark 一致（见 monaco-editor themes.js + editorColors.js）
 */
export const vscode = {
  // 主背景
  editorBg: "var(--vscode-editor-background, #1E1E1E)",
  sidebarBg: "var(--vscode-sideBar-background, #252526)",
  activityBarBg: "var(--vscode-activityBar-background, #333333)",
  tabBarBg: "var(--vscode-tab-inactiveBackground, #2D2D2D)",
  tabActiveBg: "var(--vscode-tab-activeBackground, #1E1E1E)",
  titleBarBg: "var(--vscode-titleBar-activeBackground, #323233)",

  // 边框
  border: "var(--vscode-border, #3c3c3c)",
  borderLight: "var(--vscode-borderLight, #454545)",

  // 列表/树
  listHover: "var(--vscode-list-hoverBackground, #2a2d2e)",
  listSelect: "var(--vscode-list-focusBackground, #094771)",
  listSelectInactive: "var(--vscode-list-inactiveSelectionBackground, #37373d)",

  // 文字 - vs-dark token foreground #D4D4D4
  foreground: "var(--vscode-editor-foreground, #D4D4D4)",
  foregroundDim: "var(--vscode-descriptionForeground, #858585)",
  foregroundMuted: "var(--vscode-editor-foreground, #6e6e6e)",

  // 强调 - Monaco editorColors editor.selectionBackground dark: #264F78
  accent: "var(--vscode-editor-selectionBackground, #264F78)",
  accentHover: "var(--vscode-editorHoverWidget-background, #252526)",
  success: "var(--vscode-charts-green, #4ec9b0)",
  error: "var(--vscode-charts-red, #f48771)",
  warning: "var(--vscode-charts-yellow, #dcdcaa)",

  // 按钮
  buttonBg: "var(--vscode-button-background, #0e639c)",
  buttonHover: "var(--vscode-button-hoverBackground, #1177bb)",
  buttonSecondary: "var(--vscode-button-secondaryBackground, #3c3c3c)",
  buttonSecondaryHover: "var(--vscode-button-secondaryHoverBackground, #505050)",

  // 输入框
  inputBg: "var(--vscode-input-background, #3c3c3c)",
  inputBorder: "var(--vscode-input-border, #3c3c3c)",
  inputFg: "var(--vscode-input-foreground, #D4D4D4)",
} as const;
