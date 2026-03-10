/**
 * 从 VSCode Webview 注入的 CSS 变量构建 Monaco 主题，使 webview 里的 Monaco 随 VSCode 主题切换
 * 颜色映射从 theme-mapping 共享
 */
import type * as Monaco from "monaco-editor";
import { EDITOR_THEME_KEYS, EDITOR_THEME_MAP } from "./theme-mapping";

export const VSCODE_MONACO_THEME = "vscode-editor-theme";

function readColorsFromVscode(): Record<string, string> {
  const colors: Record<string, string> = {};
  try {
    const styles = getComputedStyle(document.documentElement);
    for (const key of EDITOR_THEME_KEYS) {
      const { var: varName } = EDITOR_THEME_MAP[key];
      const value = styles.getPropertyValue(varName).trim();
      if (value) colors[key] = value;
    }
  } catch (e) {
    // ignore
  }
  return colors;
}

/** 根据 themeKind 选择 Monaco 的 base 主题（用于语法高亮 token colors） */
function getBaseTheme(themeKind: "light" | "dark" | "high-contrast"): "vs" | "vs-dark" | "hc-black" {
  if (themeKind === "dark") return "vs-dark";
  if (themeKind === "high-contrast") return "hc-black";
  return "vs";
}

/**
 * 从当前文档的 VSCode CSS 变量读取颜色，定义并应用 Monaco 主题
 * 在 webview 中调用，主题切换后会由 VSCode 更新 html 上的 --vscode-* 变量
 */
export function buildAndDefineVscodeTheme(
  monaco: typeof Monaco,
  themeKind: "light" | "dark" | "high-contrast"
): void {
  const colors = readColorsFromVscode();
  const base = getBaseTheme(themeKind);
  monaco.editor.defineTheme(VSCODE_MONACO_THEME, {
    base,
    inherit: true,
    rules: [],
    colors: Object.keys(colors).length > 0 ? colors : {},
  });
}
