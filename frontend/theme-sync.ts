import { VSCODE_MONACO_THEME } from "./monaco-vscode-theme";

type ThemeInfo = { themeKind: 'light' | 'dark' | 'high-contrast'; monacoTheme: string };

let current: ThemeInfo = { themeKind: 'dark', monacoTheme: 'vs-dark' };
const subscribers: ((t: ThemeInfo) => void)[] = [];

export function getTheme(): ThemeInfo {
  return current;
}

export function subscribe(fn: (t: ThemeInfo) => void) {
  subscribers.push(fn);
  return () => {
    const i = subscribers.indexOf(fn);
    if (i >= 0) subscribers.splice(i, 1);
  };
}

export function setTheme(t: ThemeInfo) {
  current = t;
  // set attribute for CSS usage
  try {
    document.documentElement.setAttribute('data-vscode-theme', t.themeKind);
  } catch (e) {}
  for (const s of subscribers) s(current);
}

// Called in webview entry to listen to extension messages
export function initWebviewThemeListener() {
  // If the host already applied a theme attribute (extension may have posted before
  // the module initialized), read it and initialize accordingly.
  try {
    const attr = document.documentElement.getAttribute('data-vscode-theme');
    if (attr) {
      setTheme({ themeKind: attr as ThemeInfo['themeKind'], monacoTheme: VSCODE_MONACO_THEME });
    }
  } catch (e) {}

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === 'theme') {
      const kind = (msg.themeKind as ThemeInfo['themeKind']) || 'light';
      // 使用 VSCode CSS 变量构建的自定义主题，Monaco 会跟随 VSCode 主题切换
      setTheme({ themeKind: kind, monacoTheme: VSCODE_MONACO_THEME });
    }
  });
}

// load default theme (used by standalone)
export function loadDefaultTheme() {
  try {
    const raw = localStorage.getItem('ft_default_theme');
    if (raw) {
      const parsed = JSON.parse(raw) as ThemeInfo;
      setTheme(parsed);
      return;
    }
  } catch (e) {}
  // fallback：standalone 整体 UI 默认为黑色（theme.ts），Monaco 与之保持一致
  setTheme({ themeKind: 'dark', monacoTheme: 'vs-dark' });
}

export function saveDefaultTheme(t: ThemeInfo) {
  try {
    localStorage.setItem('ft_default_theme', JSON.stringify(t));
  } catch (e) {}
}
