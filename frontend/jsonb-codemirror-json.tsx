import { Compartment, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { onCleanup, onMount, createEffect } from "solid-js";
import { getTheme, subscribe } from "./theme-sync";
import { buildVsCodeCodeMirrorTheme } from "./codemirror-vscode-theme";

export interface JsonbCodeMirrorJsonProps {
  initialValue: string;
  isReadOnly: boolean;
  onChange: (text: string) => void;
  onValidationChange?: (hasError: boolean) => void;
  onEditorReady?: (api: { format: () => Promise<void> }) => void;
}

export default function JsonbCodeMirrorJson(props: JsonbCodeMirrorJsonProps) {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;
  let applyingExternalValue = false;
  let unsubscribeTheme: (() => void) | undefined;

  const themeCompartment = new Compartment();
  const setJsonErrorEffect = StateEffect.define<{ line: number; message: string } | null>();
  const buildThemeExtension = (themeKind: "light" | "dark" | "high-contrast"): Extension[] =>
    buildVsCodeCodeMirrorTheme(themeKind);

  class JsonErrorWidget extends WidgetType {
    constructor(private message: string) {
      super();
    }
    eq(other: JsonErrorWidget) {
      return this.message === other.message;
    }
    toDOM() {
      const dom = document.createElement("span");
      dom.className = "cm-json-inline-error";
      dom.textContent = this.message;
      return dom;
    }
  }

  const jsonErrorField = StateField.define({
    create: () => Decoration.none,
    update: (deco, tr) => {
      for (const e of tr.effects) {
        if (!e.is(setJsonErrorEffect)) continue;
        if (!e.value) return Decoration.none;
        const lineNo = Math.max(1, Math.min(e.value.line, tr.state.doc.lines));
        const line = tr.state.doc.line(lineNo);
        return Decoration.set([
          Decoration.line({ class: "cm-json-error-line" }).range(line.from),
          Decoration.widget({ widget: new JsonErrorWidget(e.value.message), side: 1 }).range(line.to),
        ]);
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f),
  });

  const parseJsonError = (text: string): { line: number; message: string } | null => {
    try {
      JSON.parse(text);
      return null;
    } catch (err: any) {
      const msg = String(err?.message ?? "JSON 解析失败");
      const m = msg.match(/position\s+(\d+)/i);
      if (!m) return { line: 1, message: msg };
      const pos = Number(m[1]);
      if (!Number.isFinite(pos)) return { line: 1, message: msg };
      const safe = Math.max(0, Math.min(pos, text.length));
      const line = text.slice(0, safe).split("\n").length;
      return { line, message: msg };
    }
  };

  const validate = (text: string) => {
    const parsed = parseJsonError(text);
    if (view) {
      view.dispatch({ effects: setJsonErrorEffect.of(parsed) });
    }
    try {
      JSON.parse(text);
      props.onValidationChange?.(false);
    } catch {
      props.onValidationChange?.(true);
    }
  };

  const format = async () => {
    if (!view) return;
    const current = view.state.doc.toString();
    try {
      const formatted = JSON.stringify(JSON.parse(current), null, 2);
      if (formatted === current) return;
      view.dispatch({ changes: { from: 0, to: current.length, insert: formatted } });
      validate(formatted);
    } catch {
      validate(current);
    }
  };

  onMount(() => {
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      history(),
      json(),
      EditorView.lineWrapping,
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        {
          key: "Shift-Alt-f",
          run: () => {
            void format();
            return true;
          },
        },
        {
          key: "Mod-Shift-i",
          run: () => {
            void format();
            return true;
          },
        },
      ]),
      jsonErrorField,
      EditorView.baseTheme({
        ".cm-json-error-line": {
          background: "rgba(244, 67, 54, 0.14)",
        },
        ".cm-json-inline-error": {
          color: "var(--vscode-errorForeground, #f14c4c)",
          fontSize: "12px",
          marginLeft: "10px",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          userSelect: "none",
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingExternalValue) return;
        const text = update.state.doc.toString();
        props.onChange(text);
        validate(text);
      }),
      EditorState.readOnly.of(props.isReadOnly),
      themeCompartment.of(buildThemeExtension(getTheme().themeKind)),
    ];
    view = new EditorView({
      state: EditorState.create({ doc: props.initialValue ?? "", extensions }),
      parent: container,
    });
    validate(props.initialValue ?? "");
    props.onEditorReady?.({ format });

    unsubscribeTheme = subscribe((t) => {
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.reconfigure(buildThemeExtension(t.themeKind)),
      });
    });
  });

  createEffect(() => {
    if (!view) return;
    const next = props.initialValue ?? "";
    const current = view.state.doc.toString();
    if (next === current) return;
    applyingExternalValue = true;
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
    applyingExternalValue = false;
    validate(next);
  });

  onCleanup(() => {
    unsubscribeTheme?.();
    view?.destroy();
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
