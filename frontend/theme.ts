/**
 * VS Code 风格主题色
 * 参考 Dark+ 主题
 */
export const vscode = {
  // 主背景 - use CSS variable references so inline styles update when vars change
  editorBg: "var(--vscode-editor-background, #1e1e1e)",
  sidebarBg: "var(--vscode-sideBar-background, #252526)",
  activityBarBg: "var(--vscode-activityBar-background, #333333)",
  tabBarBg: "var(--vscode-tab-inactiveBackground, #2d2d2d)",
  tabActiveBg: "var(--vscode-tab-activeBackground, #1e1e1e)",
  titleBarBg: "var(--vscode-titleBar-activeBackground, #323233)",

  // 边框
  border: "var(--vscode-border, #3c3c3c)",
  borderLight: "var(--vscode-borderLight, #454545)",

  // 列表/树
  listHover: "var(--vscode-list-hoverBackground, #2a2d2e)",
  listSelect: "var(--vscode-list-focusBackground, #094771)",
  listSelectInactive: "var(--vscode-list-inactiveSelectionBackground, #37373d)",

  // 文字
  foreground: "var(--vscode-editor-foreground, #cccccc)",
  foregroundDim: "var(--vscode-descriptionForeground, #858585)",
  foregroundMuted: "var(--vscode-editor-foreground, #6e6e6e)",

  // 强调
  accent: "var(--vscode-editor-selectionBackground, #007acc)",
  accentHover: "var(--vscode-editorHoverWidget-background, #1a8ad4)",
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
  inputFg: "var(--vscode-input-foreground, #cccccc)",
} as const;

function getCssVar(name: string, fallback: string) {
  try {
    if (typeof window !== 'undefined' && window.getComputedStyle) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name);
      if (v && v.trim()) return v.trim();
    }
  } catch (e) {}
  return fallback;
}
