type ThemeInfo = { themeKind: 'light' | 'dark' | 'high-contrast'; monacoTheme: string };

let current: ThemeInfo = { themeKind: 'light', monacoTheme: 'vs' };
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
      // map to monaco theme conservatively
      const mon = attr === 'dark' ? 'vs-dark' : attr === 'high-contrast' ? 'hc-black' : 'vs';
      setTheme({ themeKind: attr as ThemeInfo['themeKind'], monacoTheme: mon });
    }
  } catch (e) {}

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) return;
    if (msg.type === 'theme' && msg.monacoTheme) {
      const kind = (msg.themeKind as ThemeInfo['themeKind']) || 'light';
      setTheme({ themeKind: kind, monacoTheme: msg.monacoTheme });
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
  // fallback
  setTheme({ themeKind: 'light', monacoTheme: 'vs' });
}

export function saveDefaultTheme(t: ThemeInfo) {
  try {
    localStorage.setItem('ft_default_theme', JSON.stringify(t));
  } catch (e) {}
}
