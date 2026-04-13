import {
  Annotation,
  Compartment,
  EditorState,
  EditorSelection,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
  type Extension
} from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { sql } from "@codemirror/lang-sql";
import { onCleanup, onMount, createEffect } from "solid-js";
import { getSqlSegments } from "../shared/src";
import { getTheme, subscribe } from "./theme-sync";
import { buildVsCodeCodeMirrorTheme } from "./codemirror-vscode-theme";
import { EditorView, basicSetup } from "codemirror"
import { acceptCompletion } from "@codemirror/autocomplete";
import { indentMore, insertTab } from "@codemirror/commands";
import { Decoration, WidgetType, keymap } from "@codemirror/view";
import { createSignal } from "solid-js";
import { buildCursorStylePreview } from "./ai-inline-diff-hunks";

export interface SqlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onRun?: (sqlToRun?: string) => void;
  onExplain?: (sqlToRun: string) => void;
  onFormat?: (sql: string) => string | void;
  onAiOptimize?: (sqlToOptimize: string) => void;
  onAiEdit?: (...args: any[]) => any;
  onAiCopyPrompt?: (sql: string, instruction?: string) => void;
  onAiEditInstructionChange?: (value: string) => void;
  onAiEditPhaseChange?: (phase: "idle" | "instruct" | "loading" | "preview") => void;
  onAiPreviewDock?: (payload: null | { onAccept: () => void; onReject: () => void }) => void;
  onAiCopyDiffPrompt?: (sql: string) => void;
  onEditorReady?: (api: { format: () => void; insertQueryHistoryAtEnd: (sql: string) => void }) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  style?: string | Record<string, string>;
}

type SqlBlock = { start: number; end: number; sql: string; label: string };

function getSqlBlockAtCursor(text: string, offset: number): { text: string; start: number; end: number } {
  const parts = getSqlSegments(text, { blankLineSeparator: true });
  const hit = parts.find((p) => offset >= p.start && offset <= p.end) ?? parts[0] ?? { start: 0, end: text.length };
  return { text: text.slice(hit.start, hit.end).trim(), start: hit.start, end: hit.end };
}

export default function SqlEditor(props: SqlEditorProps) {
  let container!: HTMLDivElement;
  let view: EditorView | undefined;
  let applyingExternalValue = false;
  let unsubscribeTheme: (() => void) | undefined;
  const [aiBusy, setAiBusy] = createSignal(false);
  const [aiPanelOpen, setAiPanelOpen] = createSignal(false);
  const [aiInstruction, setAiInstruction] = createSignal("补全");
  const [aiTargetRange, setAiTargetRange] = createSignal<{ from: number; to: number } | null>(null);
  const [aiPanelMode, setAiPanelMode] = createSignal<"instruct" | "loading" | "preview">("instruct");
  const [aiPreviewOriginal, setAiPreviewOriginal] = createSignal("");
  const [aiPreviewEdited, setAiPreviewEdited] = createSignal("");
  const [aiPreviewRange, setAiPreviewRange] = createSignal<{ from: number; to: number } | null>(null);
  const [aiPreviewOriginalRange, setAiPreviewOriginalRange] = createSignal<{ from: number; to: number } | null>(null);
  const [aiStatusMessage, setAiStatusMessage] = createSignal("");
  let runHighlightTimer: ReturnType<typeof setTimeout> | null = null;

  const themeCompartment = new Compartment();
  const refreshWidgetEffect = StateEffect.define<void>();
  const setExecHighlightEffect = StateEffect.define<{ from: number; to: number } | null>();
  const setAiPreviewDecorEffect = StateEffect.define<{ from: number; to: number; original: string; edited: string } | null>();
  const buildThemeExtension = (themeKind: "light" | "dark" | "high-contrast"): Extension[] =>
    buildVsCodeCodeMirrorTheme(themeKind);

  const refreshInlineWidgets = () => {
    if (!view) return;
    view.dispatch({
      effects: refreshWidgetEffect.of(),
      annotations: [Transaction.addToHistory.of(false)],
    });
  };

  const getAiPanelInput = (): HTMLInputElement | null => {
    const host = view?.dom;
    if (!host) return null;
    return host.querySelector(".cm-ai-inline-input");
  };

  const focusAiPanelInput = (selectAll = true) => {
    requestAnimationFrame(() => {
      const input = getAiPanelInput();
      if (!input) return;
      input.focus();
      if (selectAll) input.select();
    });
  };

  const focusCodeEditor = () => {
    view?.focus();
  };

  const isFocusInAiPanel = () => {
    const ae = document.activeElement;
    return !!(ae instanceof Element && ae.closest(".cm-ai-inline-panel"));
  };

  const flashExecutionRange = (from: number, to: number) => {
    if (!view) return;
    const prev = view.state.selection.main;
    const safeFrom = Math.max(0, Math.min(from, view.state.doc.length));
    const safeTo = Math.max(safeFrom, Math.min(to, view.state.doc.length));
    view.dispatch({
      selection: EditorSelection.range(safeFrom, safeTo),
      annotations: [Transaction.addToHistory.of(false)],
    });
    if (runHighlightTimer) clearTimeout(runHighlightTimer);
    runHighlightTimer = setTimeout(() => {
      runHighlightTimer = null;
      if (!view) return;
      view.dispatch({
        selection: EditorSelection.range(prev.anchor, prev.head),
        annotations: [Transaction.addToHistory.of(false)],
      });
    }, 200);
  };

  const runSqlWithHighlight = (sql: string, from: number, to: number) => {
    if (!sql.trim()) return;
    flashExecutionRange(from, to);
    props.onRun?.(sql);
  };

  const runCurrent = () => {
    if (!view) return;
    const sel = view.state.selection.main;
    const text = view.state.doc.toString();
    if (!sel.empty) {
      const selected = text.slice(sel.from, sel.to).trim();
      if (selected) runSqlWithHighlight(selected, sel.from, sel.to);
      return;
    }
    const block = getSqlBlockAtCursor(text, sel.head);
    if (block.text) {
      runSqlWithHighlight(block.text, block.start, block.end);
      return;
    }
    props.onRun?.();
  };

  const buildSqlBlocks = (text: string): SqlBlock[] => {
    const parts = getSqlSegments(text, { blankLineSeparator: true });
    return parts
      .map((p, idx) => {
        const sql = text.slice(p.start, p.end).trim();
        const firstLine = sql.split("\n")[0] ?? "";
        return { start: p.start, end: p.end, sql, label: `${idx + 1}. ${firstLine.slice(0, 48)}` };
      })
      .filter((b) => b.sql.length > 0);
  };

  const createBlockToolbarExtension = (): Extension => {
    const emptyDeco = Decoration.none;
    class AiRedZoneWidget extends WidgetType {
      constructor(private lines: string[]) {
        super();
      }
      eq(other: AiRedZoneWidget) {
        if (this.lines.length !== other.lines.length) return false;
        for (let i = 0; i < this.lines.length; i++) if (this.lines[i] !== other.lines[i]) return false;
        return true;
      }
      toDOM() {
        const root = document.createElement("div");
        root.className = "cm-ai-red-zone";
        for (const line of this.lines) {
          const row = document.createElement("div");
          row.className = "cm-ai-red-line";
          row.textContent = line;
          root.appendChild(row);
        }
        return root;
      }
    }
    class SqlBlockToolbarWidget extends WidgetType {
      constructor(private block: SqlBlock, private busy: boolean) {
        super();
      }

      eq(other: SqlBlockToolbarWidget) {
        return (
          this.block.start === other.block.start
          && this.block.end === other.block.end
          && this.block.label === other.block.label
          && this.busy === other.busy
        );
      }

      toDOM() {
        const root = document.createElement("div");
        root.className = "cm-sql-block-toolbar";

        const mkBtn = (icon: string, text: string, onClick: () => void, disabled = false) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "cm-sql-block-toolbar-btn";
          btn.tabIndex = -1;
          const iconEl = document.createElement("span");
          iconEl.className = "cm-sql-block-toolbar-icon";
          iconEl.textContent = icon;
          const textEl = document.createElement("span");
          textEl.className = "cm-sql-block-toolbar-text";
          textEl.textContent = text;
          btn.append(iconEl, textEl);
          btn.disabled = disabled;
          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
          });
          return btn;
        };
        const appendAction = (text: string, onClick: () => void, disabled = false) => {
          if (root.childElementCount > 0) {
            const sep = document.createElement("span");
            sep.className = "cm-sql-block-toolbar-sep";
            sep.textContent = "|";
            root.appendChild(sep);
          }
          root.appendChild(mkBtn(
            text === "Run" ? "▶" : text === "Format" ? "✨" : text === "Explain" ? "📊" : "🤖",
            text,
            onClick,
            disabled
          ));
        };

        appendAction("Run", () => runSqlWithHighlight(this.block.sql, this.block.start, this.block.end));
        appendAction("Format", () => formatBlock(this.block), !props.onFormat);
        appendAction("Explain", () => props.onExplain?.(this.block.sql), !props.onExplain);
        appendAction(
          this.busy ? "AI Editing..." : "AI Edit",
          () => openAiPanel({ from: this.block.start, to: this.block.end }),
          !props.onAiEdit || this.busy
        );
        return root;
      }

      ignoreEvent() {
        return true;
      }
    }

    class AiInlinePanelWidget extends WidgetType {
      constructor(private anchorOffset: number) {
        super();
      }

      eq(other: AiInlinePanelWidget) {
        return false;
      }

      toDOM() {
        const root = document.createElement("div");
        root.className = "cm-ai-inline-panel";

        const row = document.createElement("div");
        row.className = "cm-ai-inline-row";

        if (aiPanelMode() === "instruct") {
          const badge = document.createElement("span");
          badge.className = "cm-ai-inline-label";
          badge.textContent = "AI 编辑要求";
          row.appendChild(badge);

          const input = document.createElement("input");
          input.className = "cm-ai-inline-input";
          input.placeholder = "输入 AI 编辑要求";
          input.value = aiInstruction();
          input.addEventListener("input", (e) => {
            const next = (e.target as HTMLInputElement).value;
            setAiInstruction(next);
            props.onAiEditInstructionChange?.(next);
          });
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const v = input.value.trim();
              if (!v) return;
              setAiInstruction(v);
              props.onAiEditInstructionChange?.(v);
              void aiEditCurrent(v);
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeAiPanel();
            } else if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
              e.preventDefault();
              focusCodeEditor();
            }
          });
          row.appendChild(input);

          const runBtn = document.createElement("button");
          runBtn.type = "button";
          runBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-primary";
          runBtn.textContent = aiBusy() ? "生成中..." : "确定";
          runBtn.disabled = aiBusy();
          runBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const v = input.value.trim();
            if (!v) return;
            setAiInstruction(v);
            props.onAiEditInstructionChange?.(v);
            void aiEditCurrent(v);
          });

          const copyBtn = document.createElement("button");
          copyBtn.type = "button";
          copyBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-ghost";
          copyBtn.textContent = "复制 Prompt";
          copyBtn.disabled = !props.onAiCopyPrompt;
          copyBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = aiTargetRange();
            const ctx = target ? getRangeSqlContext(target.from, target.to) : getCurrentSqlContext();
            const v = input.value.trim();
            if (ctx.sql) props.onAiCopyPrompt?.(ctx.sql, v || aiInstruction());
          });
          row.appendChild(copyBtn);
          row.appendChild(runBtn);

          const cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-ghost";
          cancelBtn.textContent = "取消";
          cancelBtn.disabled = aiBusy();
          cancelBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAiPanel();
          });
          row.appendChild(cancelBtn);
        } else if (aiPanelMode() === "preview") {
          const keepBtn = document.createElement("button");
          keepBtn.type = "button";
          keepBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-keep";
          keepBtn.textContent = "Keep";
          keepBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            applyAiPreview();
          });
          row.appendChild(keepBtn);

          const undoBtn = document.createElement("button");
          undoBtn.type = "button";
          undoBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-undo";
          undoBtn.textContent = "Undo";
          undoBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            rejectAiPreview();
          });
          row.appendChild(undoBtn);

          const hint = document.createElement("span");
          hint.className = "cm-ai-inline-hint";
          hint.textContent = "Ctrl/Cmd+N Undo · Ctrl/Cmd+Shift+Y Keep";
          row.appendChild(hint);
          const closeBtn = document.createElement("button");
          closeBtn.type = "button";
          closeBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-ghost";
          closeBtn.textContent = "取消";
          closeBtn.disabled = aiBusy();
          closeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAiPanel();
          });
          row.appendChild(closeBtn);
        } else {
          const loadingBtn = document.createElement("button");
          loadingBtn.type = "button";
          loadingBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-ghost";
          loadingBtn.textContent = "生成中...";
          loadingBtn.disabled = true;
          row.appendChild(loadingBtn);

          const cancelBtn = document.createElement("button");
          cancelBtn.type = "button";
          cancelBtn.className = "cm-ai-inline-btn cm-ai-inline-btn-ghost";
          cancelBtn.textContent = "取消";
          cancelBtn.disabled = aiBusy();
          cancelBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeAiPanel();
          });
          row.appendChild(cancelBtn);
        }
        root.appendChild(row);

        if (aiPanelMode() === "loading") {
          const loading = document.createElement("div");
          loading.className = "cm-ai-inline-hint";
          loading.textContent = "生成中...";
          root.appendChild(loading);
        } else if (aiStatusMessage()) {
          const msg = document.createElement("div");
          msg.className = "cm-ai-inline-hint";
          msg.textContent = aiStatusMessage();
          root.appendChild(msg);
        }

        return root;
      }

      ignoreEvent() {
        return true;
      }
    }

    const buildDecos = (state: EditorState) => {
      const text = state.doc.toString();
      const blocks = buildSqlBlocks(text);
      const builder = new RangeSetBuilder<Decoration>();
      for (const b of blocks) {
        const line = state.doc.lineAt(Math.min(state.doc.length, b.start + 1));
        builder.add(
          line.from,
          line.from,
          Decoration.widget({
            widget: new SqlBlockToolbarWidget(b, aiBusy()),
            block: true,
            side: -1,
          })
        );
      }
      if (aiPanelOpen()) {
        const target = aiTargetRange() ?? { from: 0, to: 0 };
        const safe = Math.min(state.doc.length, Math.max(0, target.from));
        const anchorLine = state.doc.lineAt(Math.min(state.doc.length, safe + 1));
        builder.add(
          anchorLine.from,
          anchorLine.from,
          Decoration.widget({
            widget: new AiInlinePanelWidget(safe),
            block: true,
            side: -1,
          })
        );
      }
      return builder.finish();
    };

    const field = StateField.define({
      create: (state) => buildDecos(state),
      update: (deco, tr) => (
        tr.docChanged || tr.effects.some((e) => e.is(refreshWidgetEffect))
          ? buildDecos(tr.state)
          : deco
      ),
      provide: (f) => EditorView.decorations.from(f),
    });

    const execHighlightField = StateField.define({
      create: () => emptyDeco,
      update: (deco, tr) => {
        for (const e of tr.effects) {
          if (!e.is(setExecHighlightEffect)) continue;
          const v = e.value;
          if (!v) return emptyDeco;
          const from = Math.max(0, Math.min(v.from, tr.state.doc.length));
          const to = Math.max(from, Math.min(v.to, tr.state.doc.length));
          const ranges: any[] = [];
          ranges.push(Decoration.mark({ class: "cm-exec-highlight" }).range(from, to));
          const firstLine = tr.state.doc.lineAt(from).number;
          const lastLine = tr.state.doc.lineAt(Math.max(from, to - 1)).number;
          for (let ln = firstLine; ln <= lastLine; ln++) {
            const line = tr.state.doc.line(ln);
            ranges.push(Decoration.line({ class: "cm-exec-highlight-line" }).range(line.from));
          }
          return Decoration.set(ranges, true);
        }
        return deco;
      },
      provide: (f) => EditorView.decorations.from(f),
    });

    const aiPreviewDecorField = StateField.define({
      create: () => emptyDeco,
      update: (deco, tr) => {
        for (const e of tr.effects) {
          if (!e.is(setAiPreviewDecorEffect)) continue;
          const payload = e.value;
          if (!payload) return emptyDeco;
          const from = Math.max(0, Math.min(payload.from, tr.state.doc.length));
          const to = Math.max(from, Math.min(payload.to, tr.state.doc.length));
          const startLine = tr.state.doc.lineAt(from).number;
          const { redZones, hunks } = buildCursorStylePreview(payload.original, payload.edited);
          const ranges: any[] = [];
          for (const rz of redZones) {
            const lineNo = Math.min(tr.state.doc.lines, Math.max(1, startLine + Math.max(0, rz.afterSnippetLine)));
            const line = tr.state.doc.line(lineNo);
            ranges.push(
              Decoration.widget({
                widget: new AiRedZoneWidget(rz.lines),
                block: true,
                side: -1,
              }).range(line.from)
            );
          }
          for (const h of hunks) {
            for (let sl = h.newStartLine1; sl < h.newEndLineExclusive; sl++) {
              const lineNo = startLine + sl - 1;
              if (lineNo < 1 || lineNo > tr.state.doc.lines) continue;
              ranges.push(Decoration.line({ class: "cm-ai-add-line" }).range(tr.state.doc.line(lineNo).from));
            }
          }
          // keep only preview for target block
          ranges.push(Decoration.mark({ class: "cm-ai-preview-range" }).range(from, to));
          return Decoration.set(ranges, true);
        }
        if (tr.docChanged && aiPanelMode() === "preview") return deco;
        return deco;
      },
      provide: (f) => EditorView.decorations.from(f),
    });

    return [
      field,
      execHighlightField,
      aiPreviewDecorField,
      EditorView.baseTheme({
        ".cm-sql-block-toolbar": {
          display: "flex",
          alignItems: "center",
          gap: "2px",
          minHeight: "12px",
          padding: "0",
          margin: "0",
          fontSize: "10px",
          color: "var(--vscode-editorCodeLens-foreground, #999)",
          background: "transparent",
        },
        ".cm-sql-block-toolbar-btn": {
          border: "none",
          background: "transparent",
          color: "inherit",
          padding: "0 2px",
          margin: "0",
          cursor: "pointer",
          font: "inherit",
          lineHeight: "1.1",
          borderRadius: "0",
          boxShadow: "none",
          display: "inline-flex",
          alignItems: "center",
          gap: "3px",
          verticalAlign: "middle",
        },
        ".cm-sql-block-toolbar-icon": {
          fontSize: "9px",
          lineHeight: "1",
          opacity: "0.9",
          display: "inline-flex",
          alignItems: "center",
        },
        ".cm-sql-block-toolbar-text": {
          lineHeight: "1.1",
          display: "inline-flex",
          alignItems: "center",
        },
        ".cm-sql-block-toolbar-sep": {
          opacity: "0.55",
          padding: "0 4px",
          userSelect: "none",
          lineHeight: "1.1",
          display: "inline-flex",
          alignItems: "center",
        },
        ".cm-sql-block-toolbar-btn:hover": {
          color: "var(--vscode-textLink-foreground, #3794ff)",
          textDecoration: "underline",
        },
        ".cm-ai-inline-panel": {
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          padding: "8px",
          margin: "0",
          border: "1px solid var(--vscode-widget-border, #454545)",
          borderRadius: "8px",
          background: "var(--vscode-editorWidget-background, #252526)",
          boxShadow: "none",
          boxSizing: "border-box",
          fontFamily: "var(--vscode-font-family, \"Segoe UI\", \"Microsoft YaHei\", sans-serif)",
          fontSize: "12px",
          fontWeight: "400",
          lineHeight: "var(--vscode-editor-line-height, 1.6)",
        },
        ".cm-ai-inline-row": {
          display: "flex",
          alignItems: "center",
          gap: "8px",
          flexWrap: "wrap",
        },
        ".cm-ai-inline-label": {
          fontSize: "12px",
          lineHeight: "inherit",
          color: "var(--vscode-foreground, #ddd)",
          whiteSpace: "nowrap",
        },
        ".cm-ai-inline-input": {
          flex: "1 1 240px",
          minWidth: "180px",
          height: "28px",
          padding: "0 8px",
          border: "1px solid var(--vscode-input-border, #3c3c3c)",
          borderRadius: "6px",
          background: "var(--vscode-input-background, #3c3c3c)",
          color: "var(--vscode-input-foreground, #ddd)",
          fontSize: "12px",
          fontFamily: "inherit",
          fontWeight: "400",
          lineHeight: "inherit",
          outline: "none",
          boxSizing: "border-box",
        },
        ".cm-ai-inline-btn": {
          appearance: "none",
          border: "1px solid var(--vscode-widget-border, #454545)",
          background: "transparent",
          color: "var(--vscode-foreground, #ddd)",
          borderRadius: "6px",
          boxShadow: "none",
          height: "28px",
          padding: "0 10px",
          fontSize: "12px",
          fontFamily: "inherit",
          fontWeight: "500",
          lineHeight: "inherit",
          cursor: "pointer",
          flexShrink: "0",
          display: "inline-flex",
          alignItems: "center",
        },
        ".cm-ai-inline-btn:hover": {
          borderColor: "var(--vscode-textLink-foreground, #3794ff)",
          color: "var(--vscode-textLink-foreground, #3794ff)",
        },
        ".cm-ai-inline-btn-primary": {
          border: "none !important",
          background: "var(--vscode-button-background, #0e639c) !important",
          color: "var(--vscode-button-foreground, #ffffff) !important",
        },
        ".cm-ai-inline-btn-primary:hover": {
          background: "var(--vscode-button-hoverBackground, #0090d8) !important",
          border: "none !important",
          color: "var(--vscode-button-foreground, #ffffff) !important",
        },
        ".cm-ai-inline-btn-undo": {
          border: "1px solid rgba(255, 255, 255, 0.08)",
          background: "#2c2c2c",
          color: "#ffffff",
        },
        ".cm-ai-inline-btn-undo:hover": {
          background: "#353535",
          borderColor: "rgba(255, 255, 255, 0.12)",
          color: "#ffffff",
        },
        ".cm-ai-inline-btn-keep": {
          border: "1px solid rgba(255, 255, 255, 0.12)",
          background: "#3d8f60",
          color: "#ffffff",
        },
        ".cm-ai-inline-btn-keep:hover": {
          background: "#44986a",
          borderColor: "rgba(255, 255, 255, 0.16)",
          color: "#ffffff",
        },
        ".cm-ai-inline-btn-ghost": {
          border: "1px solid var(--vscode-widget-border, #454545)",
          background: "transparent",
          color: "var(--vscode-foreground, #ddd)",
        },
        ".cm-ai-inline-btn:disabled": {
          opacity: "0.45",
          cursor: "not-allowed",
        },
        ".cm-ai-inline-hint": {
          fontSize: "12px",
          fontFamily: "inherit",
          fontWeight: "400",
          color: "var(--vscode-descriptionForeground, #999)",
        },
        ".cm-ai-inline-preview": {
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "8px",
          minHeight: "120px",
        },
        ".cm-ai-inline-pre": {
          margin: "0",
          padding: "8px",
          fontSize: "12px",
          fontFamily: "inherit",
          fontWeight: "400",
          maxHeight: "120px",
          overflow: "auto",
          background: "var(--vscode-editor-background, #1f1f1f)",
          border: "1px solid var(--vscode-panel-border, #3c3c3c)",
          whiteSpace: "pre-wrap",
        },
        ".cm-exec-highlight": {
          background: "rgba(33, 150, 243, 0.4)",
          borderRadius: "0",
          paddingTop: "1px",
          paddingBottom: "1px",
          marginTop: "-1px",
          marginBottom: "-1px",
          boxShadow: "0 -1px 0 rgba(33, 150, 243, 0.4), 0 1px 0 rgba(33, 150, 243, 0.4)",
          WebkitBoxDecorationBreak: "clone",
          boxDecorationBreak: "clone",
        },
        ".cm-exec-highlight-line": {
          background: "rgba(33, 150, 243, 0.16)",
        },
        ".cm-ai-add-line": {
          background: "color-mix(in srgb, var(--vscode-diffEditor-insertedTextBackground, rgba(60, 160, 90, 0.28)) 92%, transparent)",
        },
        ".cm-ai-red-zone": {
          boxSizing: "border-box",
          width: "100%",
          margin: "0",
          padding: "0",
          background: "color-mix(in srgb, var(--vscode-diffEditor-removedTextBackground, rgba(180, 60, 60, 0.35)) 88%, transparent)",
        },
        ".cm-ai-red-line": {
          boxSizing: "border-box",
          whiteSpace: "pre",
          overflow: "hidden",
          textOverflow: "ellipsis",
          padding: "0 8px 0 0",
          margin: "0",
          color: "var(--vscode-editor-foreground, #ccc)",
          textDecoration: "line-through",
          fontFamily: "var(--vscode-editor-font-family, Consolas, monospace)",
          fontSize: "var(--vscode-editor-font-size, 13px)",
          lineHeight: "var(--vscode-editor-line-height, 1.6)",
        },
        ".cm-ai-preview-range": {
          outline: "1px solid color-mix(in srgb, var(--vscode-focusBorder, #007fd4) 40%, transparent)",
          outlineOffset: "-1px",
        },
      }),
    ];
  };

  const getCurrentSqlContext = (): { sql: string; from: number; to: number } => {
    if (!view) return { sql: "", from: 0, to: 0 };
    const sel = view.state.selection.main;
    const text = view.state.doc.toString();
    if (!sel.empty) {
      return { sql: text.slice(sel.from, sel.to).trim(), from: sel.from, to: sel.to };
    }
    const block = getSqlBlockAtCursor(text, sel.head);
    return { sql: block.text, from: block.start, to: block.end };
  };

  const getRangeSqlContext = (from: number, to: number): { sql: string; from: number; to: number } => {
    if (!view) return { sql: "", from, to };
    const text = view.state.doc.toString();
    const safeFrom = Math.max(0, Math.min(from, text.length));
    const safeTo = Math.max(safeFrom, Math.min(to, text.length));
    return { sql: text.slice(safeFrom, safeTo).trim(), from: safeFrom, to: safeTo };
  };

  const formatAll = () => {
    if (!view || !props.onFormat) return;
    const current = view.state.doc.toString();
    const formatted = props.onFormat(current);
    if (typeof formatted !== "string" || formatted === current) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: formatted },
      selection: { anchor: Math.min(view.state.selection.main.head, formatted.length) },
    });
  };

  const explainCurrent = () => {
    if (!props.onExplain) return;
    const { sql } = getCurrentSqlContext();
    if (sql) props.onExplain(sql);
  };

  const formatBlock = (block: SqlBlock) => {
    if (!view || !props.onFormat || !block.sql) return;
    const formatted = props.onFormat(block.sql);
    if (typeof formatted !== "string" || formatted === block.sql) return;
    view.dispatch({
      changes: { from: block.start, to: block.end, insert: formatted },
      selection: { anchor: block.start + formatted.length },
    });
  };

  const optimizeCurrent = () => {
    if (!props.onAiOptimize) return;
    const { sql } = getCurrentSqlContext();
    if (sql) props.onAiOptimize(sql);
  };

  const openAiPanel = (target?: { from: number; to: number }) => {
    if (!props.onAiEdit || aiBusy()) return;
    const resolvedTarget = target ?? getCurrentSqlContext();
    setAiTargetRange({ from: resolvedTarget.from, to: resolvedTarget.to });
    setAiPanelMode("instruct");
    setAiPreviewOriginal("");
    setAiPreviewEdited("");
    setAiPreviewRange(null);
    setAiPreviewOriginalRange(null);
    setAiStatusMessage("");
    setAiPanelOpen(true);
    props.onAiEditPhaseChange?.("instruct");
    refreshInlineWidgets();
    focusAiPanelInput(true);
    if (view) {
      const from = Math.max(0, Math.min(resolvedTarget.from, view.state.doc.length));
      const to = Math.max(from, Math.min(resolvedTarget.to, view.state.doc.length));
      view.dispatch({
        selection: EditorSelection.range(from, to),
        annotations: [Transaction.addToHistory.of(false)],
      });
    }
  };

  const closeAiPanel = () => {
    const target = aiTargetRange();
    setAiPanelOpen(false);
    setAiTargetRange(null);
    setAiPanelMode("instruct");
    setAiPreviewOriginal("");
    setAiPreviewEdited("");
    setAiPreviewRange(null);
    setAiPreviewOriginalRange(null);
    setAiStatusMessage("");
    props.onAiPreviewDock?.(null);
    props.onAiEditPhaseChange?.("idle");
    refreshInlineWidgets();
    if (view) {
      view.dispatch({
        effects: setAiPreviewDecorEffect.of(null),
        annotations: [Transaction.addToHistory.of(false)],
      });
    }
    if (view && target) {
      const to = Math.max(0, Math.min(target.to, view.state.doc.length));
      view.dispatch({
        selection: EditorSelection.cursor(to),
        annotations: [Transaction.addToHistory.of(false)],
      });
    }
    focusCodeEditor();
  };

  const rejectAiPreview = () => {
    if (view && aiPanelMode() === "preview") {
      const cur = aiPreviewRange();
      const orig = aiPreviewOriginalRange();
      const originalText = aiPreviewOriginal();
      if (cur && orig) {
        view.dispatch({
          changes: { from: cur.from, to: cur.to, insert: originalText },
          selection: { anchor: orig.from + originalText.length },
        });
      }
    }
    closeAiPanel();
  };

  const applyAiPreview = () => {
    // Preview text is already applied into editor model.
    closeAiPanel();
  };

  const aiEditCurrent = async (instructionOverride?: string) => {
    if (!props.onAiEdit || aiBusy()) return;
    const target = aiTargetRange();
    const { sql, from, to } = target
      ? getRangeSqlContext(target.from, target.to)
      : getCurrentSqlContext();
    if (!sql) {
      setAiStatusMessage("当前 SQL 为空，无法生成");
      setAiPanelMode("instruct");
      refreshInlineWidgets();
      return;
    }
    const instruction = (instructionOverride ?? aiInstruction()).trim();
    if (!instruction) {
      setAiStatusMessage("请输入 AI 编辑要求");
      setAiPanelMode("instruct");
      refreshInlineWidgets();
      return;
    }
    try {
      setAiBusy(true);
      setAiStatusMessage("");
      setAiPanelMode("loading");
      refreshInlineWidgets();
      props.onAiEditPhaseChange?.("loading");
      let result: any;
      try {
        const timeoutMs = 45000;
        result = await Promise.race([
          Promise.resolve(props.onAiEdit(sql, instruction)),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("AI 生成超时，请稍后重试")), timeoutMs)
          ),
        ]);
      } catch {
        setAiStatusMessage("生成失败或超时，请重试");
        setAiPanelMode("instruct");
        refreshInlineWidgets();
        props.onAiEditPhaseChange?.("instruct");
        return;
      }
      let nextSql = "";
      if (typeof result === "string") nextSql = result.trim();
      else if (result && typeof result === "object" && "sql" in result && typeof (result as any).sql === "string") {
        nextSql = (result as any).sql.trim();
      }
      if (!nextSql) {
        setAiStatusMessage("未生成可应用的结果");
        setAiPanelMode("instruct");
        refreshInlineWidgets();
        props.onAiEditPhaseChange?.("instruct");
        return;
      }
      setAiPreviewOriginal(sql);
      setAiPreviewEdited(nextSql);
      setAiPreviewOriginalRange({ from, to });
      if (view) {
        view.dispatch({
          changes: { from, to, insert: nextSql },
          selection: { anchor: from + nextSql.length },
        });
      }
      const previewTo = from + nextSql.length;
      setAiPreviewRange({ from, to: previewTo });
      setAiStatusMessage("");
      setAiPanelMode("preview");
      refreshInlineWidgets();
      focusCodeEditor();
      view?.dispatch({
        effects: setAiPreviewDecorEffect.of({ from, to: previewTo, original: sql, edited: nextSql }),
        annotations: [Transaction.addToHistory.of(false)],
      });
      props.onAiEditInstructionChange?.(instruction);
      props.onAiEditPhaseChange?.("preview");
      props.onAiPreviewDock?.({
        onAccept: applyAiPreview,
        onReject: rejectAiPreview,
      });
    } finally {
      setAiBusy(false);
      refreshInlineWidgets();
    }
  };

  const insertQueryHistoryAtEnd = (sqlChunk: string) => {
    if (!view) return;
    const text = view.state.doc.toString();
    const trimmed = text.trimEnd();
    view.dispatch({
      changes: { from: trimmed.length, to: text.length, insert: `\n\n${sqlChunk}` },
      selection: { anchor: trimmed.length + sqlChunk.length + 2 },
    });
    view.focus();
  };

  onMount(() => {
    const extensions: Extension[] = [
      sql(),
      basicSetup,
      EditorState.tabSize.of(4),
      indentUnit.of("    "),
      EditorView.lineWrapping,
      createBlockToolbarExtension(),
      Prec.highest(
        keymap.of([
          {
            key: "Tab",
            run: (currentView) => {
              if (acceptCompletion(currentView)) return true;
              if (indentMore(currentView)) return true;
              return insertTab(currentView);
            },
          },
          {
            key: "Mod-Enter",
            run: () => {
              runCurrent();
              return true;
            },
          },
          {
            key: "Ctrl-Enter",
            run: () => {
              runCurrent();
              return true;
            },
          },
          {
            key: "Shift-Alt-f",
            run: () => {
              formatAll();
              return true;
            },
          },
          {
            key: "Mod-k",
            run: () => {
              if (!aiPanelOpen()) {
                openAiPanel();
                return true;
              }
              if (isFocusInAiPanel()) {
                focusCodeEditor();
                return true;
              }
              focusAiPanelInput(true);
              return true;
            },
          },
          {
            key: "Mod-n",
            run: () => {
              if (aiPanelOpen() && aiPanelMode() === "preview") {
                rejectAiPreview();
                return true;
              }
              return false;
            },
          },
          {
            key: "Mod-Shift-y",
            run: () => {
              if (aiPanelOpen() && aiPanelMode() === "preview") {
                applyAiPreview();
                return true;
              }
              return false;
            },
          },
        ])
      ),
      EditorView.domEventHandlers({
        keydown: (event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            runCurrent();
            return true;
          }
          return false;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingExternalValue) return;
        props.onChange?.(update.state.doc.toString());
      }),
      EditorState.readOnly.of(!!props.disabled),
      themeCompartment.of(buildThemeExtension(getTheme().themeKind)),
    ];

    view = new EditorView({
      state: EditorState.create({
        doc: props.value ?? "",
        extensions,
      }),
      parent: container,
    });

    props.onEditorReady?.({
      format: formatAll,
      insertQueryHistoryAtEnd,
    });

    unsubscribeTheme = subscribe((t) => {
      if (!view) return;
      view.dispatch({
        effects: themeCompartment.reconfigure(buildThemeExtension(t.themeKind)),
      });
    });
  });

  createEffect(() => {
    const next = props.value ?? "";
    if (!view) return;
    const current = view.state.doc.toString();
    if (next === current) return;
    applyingExternalValue = true;
    view.dispatch({ changes: { from: 0, to: current.length, insert: next } });
    applyingExternalValue = false;
  });

  onCleanup(() => {
    if (runHighlightTimer) {
      clearTimeout(runHighlightTimer);
      runHighlightTimer = null;
    }
    unsubscribeTheme?.();
    view?.destroy();
  });

  return (
    <div
      data-sql-editor
      class={props.class}
      style={{
        height: "100%",
        width: "100%",
        "min-height": "120px",
        background: "var(--vscode-editor-background, #1f1f1f)",
        border: "1px solid var(--vscode-panel-border, #3c3c3c)",
        position: "relative",
        ...(typeof props.style === "object" ? props.style : {}),
      }}
    >
      <div
        ref={container!}
        style={{
          height: "100%",
          width: "100%",
        }}
      />
    </div>
  );
}
