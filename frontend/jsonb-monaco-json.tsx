/**
 * JSONB 代码模式：Monaco + JSON Worker；错误行整行淡色底 + 自带波浪线；
 * 说明文案用 ContentWidget 贴在行尾（纯展示层，非 model 文本、不可选、不影响列偏移）。
 */
import { onMount, onCleanup } from "solid-js";
import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import "./monaco-environment";
import { buildAndDefineVscodeTheme, VSCODE_MONACO_THEME } from "./monaco-vscode-theme";
import { getTheme, subscribe } from "./theme-sync";
import { attachMonacoLayoutOnResize } from "./monaco-resize-layout";

function ensureJsonbMonacoStyles() {
  if (document.getElementById("jsonb-monaco-diag-style")) return;
  const el = document.createElement("style");
  el.id = "jsonb-monaco-diag-style";
  el.textContent = `
    .jsonb-monaco-error-line-bg {
      background-color: rgba(244, 67, 54, 0.14);
    }
    .jsonb-monaco-diag-widget {
      color: var(--vscode-errorForeground, #f14c4c);
      font-size: 12px;
      line-height: 1.25;
      white-space: nowrap;
      margin-left: 28px;
      padding: 0 2px;
      user-select: none;
      pointer-events: none;
      font-family: var(--vscode-editor-font-family, var(--monaco-monospace-font, monospace));
    }
  `;
  document.head.appendChild(el);
}

export interface JsonbMonacoJsonProps {
  initialValue: string;
  isReadOnly: boolean;
  onChange: (text: string) => void;
  onValidationChange?: (hasError: boolean) => void;
  onEditorReady?: (api: { format: () => Promise<void> }) => void;
}

export default function JsonbMonacoJson(props: JsonbMonacoJsonProps) {
  let container!: HTMLDivElement;

  onMount(() => {
    ensureJsonbMonacoStyles();

    const themeInfo = getTheme();
    const initialTheme = themeInfo?.monacoTheme ?? "vs-dark";
    if (initialTheme === VSCODE_MONACO_THEME && themeInfo) {
      buildAndDefineVscodeTheme(monaco, themeInfo.themeKind);
    }

    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      schemas: [],
    });

    const editor = monaco.editor.create(container, {
      value: props.initialValue,
      language: "json",
      theme: initialTheme,
      readOnly: props.isReadOnly,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: "on",
      wordWrap: "on",
      automaticLayout: false,
      tabSize: 2,
      renderValidationDecorations: "on",
      glyphMargin: true,
    });
    const detachMonacoLayout = attachMonacoLayoutOnResize(container, editor);

    const model = editor.getModel();
    if (!model) return;

    let lineBgDecoIds: string[] = [];
    const lineDiagWidgets = new Map<number, monaco.editor.IContentWidget>();

    function disposeLineDiagWidgets() {
      for (const w of lineDiagWidgets.values()) {
        editor.removeContentWidget(w);
      }
      lineDiagWidgets.clear();
    }

    function truncate(s: string, max = 96) {
      const t = s.replace(/\s+/g, " ").trim();
      return t.length <= max ? t : `${t.slice(0, max)}…`;
    }

    function syncDiagnosticsUi() {
      const uri = model.uri;
      const markers = monaco.editor.getModelMarkers({ resource: uri }).filter(
        (m) => m.severity === monaco.MarkerSeverity.Error
      );
      props.onValidationChange?.(markers.length > 0);

      const byLine = new Map<number, string>();
      for (const m of markers) {
        const line = m.startLineNumber;
        if (!byLine.has(line)) byLine.set(line, m.message);
      }

      disposeLineDiagWidgets();

      const newLineBgs: monaco.editor.IModelDeltaDecoration[] = [];
      for (const line of byLine.keys()) {
        const maxCol = model.getLineMaxColumn(line);
        newLineBgs.push({
          range: new monaco.Range(line, 1, line, maxCol),
          options: {
            description: "jsonb-error-line-bg",
            isWholeLine: true,
            className: "jsonb-monaco-error-line-bg",
          },
        });
      }
      lineBgDecoIds = model.deltaDecorations(lineBgDecoIds, newLineBgs);

      for (const [line, message] of byLine) {
        const dom = document.createElement("span");
        dom.className = "jsonb-monaco-diag-widget";
        dom.textContent = truncate(message);

        const anchorLine = line;
        const widget: monaco.editor.IContentWidget = {
          getId: () => `jsonb.diag.line.${anchorLine}`,
          getDomNode: () => dom,
          getPosition: () => ({
            position: {
              lineNumber: anchorLine,
              column: model.getLineMaxColumn(anchorLine),
            },
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          }),
          allowEditorOverflow: true,
          suppressMouseDown: true,
        };
        editor.addContentWidget(widget);
        lineDiagWidgets.set(line, widget);
      }
    }

    const subMarkers = monaco.editor.onDidChangeMarkers((uris) => {
      if (uris.some((u) => u.toString() === model.uri.toString())) {
        syncDiagnosticsUi();
      }
    });

    editor.onDidChangeModelContent(() => {
      props.onChange(editor.getValue());
    });

    syncDiagnosticsUi();

    props.onEditorReady?.({
      format: async () => {
        await editor.getAction("editor.action.formatDocument")?.run();
      },
    });

    const unsubTheme = subscribe((t) => {
      try {
        if (t.monacoTheme === VSCODE_MONACO_THEME) {
          buildAndDefineVscodeTheme(monaco, t.themeKind);
        }
        monaco.editor.setTheme(t.monacoTheme);
        requestAnimationFrame(() => editor.layout());
      } catch {
        /* ignore */
      }
    });

    onCleanup(() => {
      subMarkers.dispose();
      unsubTheme();
      disposeLineDiagWidgets();
      lineBgDecoIds = model.deltaDecorations(lineBgDecoIds, []);
      detachMonacoLayout();
      editor.dispose();
    });
  });

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px", height: "100%", "min-height": "300px" }}>
      <div
        ref={(el) => {
          container = el;
        }}
        style={{ flex: "1", "min-height": "280px", border: "1px solid var(--vscode-panel-border, #3c3c3c)" }}
      />
    </div>
  );
}
