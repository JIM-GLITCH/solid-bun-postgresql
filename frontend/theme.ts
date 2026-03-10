/**
 * VS Code 风格主题色
 * 参考 Dark+ 主题
 */
export const vscode = {
  // 主背景 - prefer VS Code injected CSS variables when available
  editorBg: getCssVar('--vscode-editor-background', '#1e1e1e'),
  sidebarBg: getCssVar('--vscode-sideBar-background', '#252526'),
  activityBarBg: getCssVar('--vscode-activityBar-background', '#333333'),
  tabBarBg: getCssVar('--vscode-tab-inactiveBackground', '#2d2d2d'),
  tabActiveBg: getCssVar('--vscode-tab-activeBackground', '#1e1e1e'),
  titleBarBg: getCssVar('--vscode-titleBar-activeBackground', '#323233'),

  // 边框
  border: "#3c3c3c",
  borderLight: "#454545",

  // 列表/树
  listHover: "#2a2d2e",
  listSelect: "#094771",
  listSelectInactive: "#37373d",

  // 文字
  foreground: getCssVar('--vscode-editor-foreground', '#cccccc'),
  foregroundDim: getCssVar('--vscode-descriptionForeground', '#858585'),
  foregroundMuted: getCssVar('--vscode-editor-foreground', '#6e6e6e'),

  // 强调
  accent: "#007acc",
  accentHover: "#1a8ad4",
  success: "#4ec9b0",
  error: "#f48771",
  warning: "#dcdcaa",

  // 按钮
  buttonBg: getCssVar('--vscode-button-background', '#0e639c'),
  buttonHover: getCssVar('--vscode-button-hoverBackground', '#1177bb'),
  buttonSecondary: getCssVar('--vscode-button-secondaryBackground', '#3c3c3c'),
  buttonSecondaryHover: getCssVar('--vscode-button-secondaryHoverBackground', '#505050'),

  // 输入框
  inputBg: getCssVar('--vscode-input-background', '#3c3c3c'),
  inputBorder: getCssVar('--vscode-input-border', '#3c3c3c'),
  inputFg: getCssVar('--vscode-input-foreground', '#cccccc'),
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
