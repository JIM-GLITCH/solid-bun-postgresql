/**
 * Monaco Editor SQL 编辑器 - Solid.js 封装
 * 静态导入，Monaco 会随主包一起打包；Workers 从 ./vs 加载（需复制或提供）
 */
import { onMount, onCleanup, createEffect } from "solid-js";
import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { getTheme, subscribe } from "./theme-sync";

// Workers 从 ./vs 加载（Monaco 0.55.1 min hashed 文件名）
// When running inside the VS Code webview we allow overriding via window.__MONACO_BASE__
const MONACO_BASE = (typeof window !== 'undefined' && (window as any).__MONACO_BASE__) || "./vs";
if (typeof self !== "undefined") {
  (self as any).MonacoEnvironment = {
    getWorkerUrl: (_: string, label: string) => {
      if (label === "json") return `${MONACO_BASE}/assets/json.worker-DKiEKt88.js`;
      if (label === "css" || label === "scss" || label === "less") return `${MONACO_BASE}/assets/css.worker-HnVq6Ewq.js`;
      if (label === "html" || label === "handlebars" || label === "razor") return `${MONACO_BASE}/assets/html.worker-B51mlPHg.js`;
      if (label === "typescript" || label === "javascript") return `${MONACO_BASE}/assets/ts.worker-CMbG-7ft.js`;
      return `${MONACO_BASE}/assets/editor.worker-Be8ye1pW.js`;
    },
  };
}

export interface SqlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onRun?: () => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  style?: string | Record<string, string>;
}

export default function SqlEditor(props: SqlEditorProps) {
  let container: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(() => {
    const initialTheme = getTheme()?.monacoTheme ?? 'vs-dark';
    editor = monaco.editor.create(container, {
      value: props.value,
      language: "sql",
      theme: initialTheme,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: "on",
      wordWrap: "on",
      automaticLayout: true,
    });

    // subscribe to theme changes
    const unsub = subscribe((t) => {
      try {
        monaco.editor.setTheme(t.monacoTheme);
      } catch (e) {}
    });

    editor.onDidChangeModelContent(() => {
      const val = editor!.getValue();
      if (props.onChange && val !== props.value) {
        props.onChange(val);
      }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      props.onRun?.();
    });
    onCleanup(() => unsub());
  });

  createEffect(() => {
    const val = props.value;
    if (editor && editor.getValue() !== val) {
      editor.setValue(val);
    }
  });

  onCleanup(() => {
    editor?.dispose();
  });

  return (
    <div
      ref={container!}
      class={props.class}
      style={{
        height: "100%",
        width: "100%",
        ...(typeof props.style === "object" ? props.style : {}),
      }}
    />
  );
}
