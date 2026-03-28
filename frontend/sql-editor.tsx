/**
 * Monaco Editor SQL 编辑器 - Solid.js 封装
 * 静态导入，Monaco 会随主包一起打包；Workers 从 ./vs 加载（需复制或提供）
 * Ctrl+Enter：有选区则执行选区，否则按 ; 或空行分块（引号内 ; 不分），执行光标所在块。
 */
import { onMount, onCleanup, createEffect } from "solid-js";
import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { buildAndDefineVscodeTheme, VSCODE_MONACO_THEME } from "./monaco-vscode-theme";

function ensureExecHighlightStyle() {
  if (document.getElementById("monaco-sql-exec-highlight-style")) return;
  const el = document.createElement("style");
  el.id = "monaco-sql-exec-highlight-style";
  el.textContent = `
    .monaco-sql-exec-highlight { background: rgba(33, 150, 243, 0.4) !important; border-radius: 2px; }
    .monaco-sql-ai-sent-range {
      background: color-mix(in srgb, var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.55)) 70%, transparent) !important;
      border-radius: 2px;
    }
    .monaco-sql-codelens {
      display: flex; align-items: center; gap: 0;       padding: 0;
      width: 100%; box-sizing: border-box; min-height: 12px;
      font-size: 11px; font-family: var(--monaco-monospace-font, "Menlo", "Monaco", "Consolas", monospace);
      pointer-events: auto; user-select: none; position: relative; z-index: 10;
      color: var(--vscode-editorCodeLens-foreground, #999);
    }
    .monaco-sql-codelens .sql-codelens-link {
      cursor: pointer; border: none; background: none; padding: 0 6px 0 0;
      color: inherit; font: inherit; display: inline-flex; align-items: center; gap: 2px;
      text-decoration: none; pointer-events: auto;
    }
    .monaco-sql-codelens .sql-codelens-link:hover { color: var(--vscode-textLink-foreground, #3794ff); text-decoration: underline; }
    .monaco-sql-codelens .sql-codelens-link .sql-codelens-icon { font-size: 9px; opacity: 0.9; }
    .monaco-sql-codelens .sql-codelens-sep { color: var(--vscode-editorCodeLens-foreground, #999); opacity: 0.6; padding: 0 6px; user-select: none; }
    .monaco-sql-ai-panel .sql-ai-diff-host .monaco-editor { outline: none !important; }
    .monaco-sql-ai-panel .sql-ai-diff-host {
      background-color: var(--vscode-editor-background, #1e1e1e);
    }
  `;
  document.head.appendChild(el);
}
import { getTheme, subscribe } from "./theme-sync";
import "./monaco-environment";
import { getSqlSegments } from "../shared/src";
import { registerSqlEditor } from "./monaco-paste-registry";
import { readClipboardText, writeClipboardText } from "./clipboard";
import { attachMonacoLayoutOnResize, attachDiffEditorLayoutOnResize } from "./monaco-resize-layout";

/** 光标所在块的文本及起止偏移（与后端 getStatements 同一套分块规则，前端多「空行」边界）。 */
function getSqlBlockAtCursor(
  text: string,
  offset: number
): { text: string; start: number; end: number } {
  const empty = { text: "", start: 0, end: 0 };
  if (!text.length) return empty;
  const parts = getSqlSegments(text, { blankLineSeparator: true });
  const segment = parts.find((p) => offset >= p.start && offset <= p.end)
    ?? parts[0]
    ?? { start: 0, end: 0 };
  return {
    text: text.slice(segment.start, segment.end).trim(),
    start: segment.start,
    end: segment.end,
  };
}

/** 全文所有块的 [start, end]，与 getSqlBlockAtCursor 一致。 */
function getAllBlocks(text: string): { start: number; end: number }[] {
  return getSqlSegments(text, { blankLineSeparator: true });
}

/** 将选区扩展为所覆盖的完整行，返回 [start,end) 偏移（含行间换行；最后一行在文末则用文档长度） */
function fullLineOffsetsFromSelection(
  model: monaco.editor.ITextModel,
  sel: monaco.Selection
): { start: number; end: number } {
  const a = sel.getStartPosition();
  const b = sel.getEndPosition();
  const startLine = Math.min(a.lineNumber, b.lineNumber);
  const endLine = Math.max(a.lineNumber, b.lineNumber);
  const start = model.getOffsetAt({ lineNumber: startLine, column: 1 });
  const end =
    endLine < model.getLineCount()
      ? model.getOffsetAt({ lineNumber: endLine + 1, column: 1 })
      : model.getValueLength();
  return { start, end };
}

/** 某偏移所在行的行首偏移（对话框锚在「整段」上方时用首行行首） */
function lineStartOffsetForOffset(model: monaco.editor.ITextModel, offset: number): number {
  const len = model.getValueLength();
  const o = Math.min(Math.max(0, offset), len);
  const pos = model.getPositionAt(o);
  return model.getOffsetAt({ lineNumber: pos.lineNumber, column: 1 });
}

/** 面板宽度超过此值时使用并排 diff（与计划一致 ~560px） */
const AI_DIFF_SIDEBYSIDE_MIN_PX = 560;

function computeAiDiffHostHeightPx(original: string, modified: string): number {
  const linesA = original ? original.split("\n").length : 1;
  const linesB = modified ? modified.split("\n").length : 1;
  const lineCount = Math.max(linesA, linesB, 1);
  const cap = Math.min(Math.round(window.innerHeight * 0.55), 400);
  const minH = 160;
  const perLine = 18;
  return Math.min(cap, Math.max(minH, lineCount * perLine + 32));
}

export interface SqlEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** 执行时传入要运行的 SQL（选区或光标所在块）；不传则由调用方决定（如执行全部） */
  onRun?: (sqlToRun?: string) => void;
  /** 执行 EXPLAIN 时传入要分析的 SQL */
  onExplain?: (sqlToRun: string) => void;
  /** 格式化函数：传入当前 SQL 返回格式化后的 SQL，在编辑器内用 executeEdits 应用以便支持 Ctrl+Z */
  onFormat?: (sql: string) => string | void;
  /** 对当前块执行 AI 优化 */
  onAiOptimize?: (sqlToOptimize: string) => void;
  /** 对当前块执行 AI 编辑（通常由 Ctrl+K 触发） */
  onAiEdit?: (
    sql: string,
    instruction: string
  ) =>
    | Promise<
        | string
        | {
            sql: string;
            elapsedMs?: number;
            usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
            schemaInjected?: string[];
          }
        | void
      >
    | string
    | {
        sql: string;
        elapsedMs?: number;
        usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
        schemaInjected?: string[];
      }
    | void;
  /** 生成并复制可发给免费 AI 的 prompt；用户要求由父级 signal（onAiEditInstructionChange）实时同步 */
  onAiCopyPrompt?: (sql: string, instruction?: string) => void;
  /** AI 编辑栏输入变化时回调，供父组件 setSignal 与「复制 Prompt」共用同一份「用户要求」 */
  onAiEditInstructionChange?: (value: string) => void;
  /** Ctrl+K / AI 编辑流程阶段（loading 时父级可显示全局 loading） */
  onAiEditPhaseChange?: (phase: "idle" | "instruct" | "loading" | "preview") => void;
  /** 生成并复制 diff prompt（驱动免费 AI 输出 diff JSON） */
  onAiCopyDiffPrompt?: (sql: string) => void;
  /** 编辑器就绪后回调，可调用 api.format() 触发格式化（供工具栏按钮用） */
  onEditorReady?: (api: { format: () => void }) => void;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  style?: string | Record<string, string>;
}

export default function SqlEditor(props: SqlEditorProps) {
  let container!: HTMLDivElement;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let detachMonacoLayout: (() => void) | undefined;
  /** 刚通过 executeEdits 应用的格式化结果，effect 里若 val 等于它则跳过 setValue，避免清空撤销栈 */
  let lastFormattedValue: string | null = null;

  onMount(() => {
    ensureExecHighlightStyle();
    (window as any).monaco = monaco;
    const themeInfo = getTheme();
    const initialTheme = themeInfo?.monacoTheme ?? 'vs-dark';
    if (initialTheme === VSCODE_MONACO_THEME && themeInfo) {
      buildAndDefineVscodeTheme(monaco, themeInfo.themeKind);
    }
    editor = monaco.editor.create(container, {
      value: props.value,
      language: "sql",
      theme: initialTheme,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: "on",
      wordWrap: "on",
      automaticLayout: false,
    });
    detachMonacoLayout = attachMonacoLayoutOnResize(container, editor);

    // subscribe to theme changes
    const unsub = subscribe((t) => {
      try {
        if (t.monacoTheme === VSCODE_MONACO_THEME) {
          buildAndDefineVscodeTheme(monaco, t.themeKind);
        }
        monaco.editor.setTheme(t.monacoTheme);
        requestAnimationFrame(() => editor?.layout());
      } catch (e) {}
    });

    const blockRunZoneIds: string[] = [];
    const highlightDecorations = editor.createDecorationsCollection();
    const aiSentRangeDecorations = editor.createDecorationsCollection();
    let lastAiEditInstruction = "补全";

    type AiPanelPhase = "closed" | "instruct" | "loading" | "preview";
    let aiPanelPhase: AiPanelPhase = "closed";
    let aiRangeOffsets: { start: number; end: number } | null = null;
    /** 打开面板时主编辑器光标偏移；View Zone 插在「该行的上一行之后」（即对话框在该行上方） */
    let aiAnchorOffset: number | null = null;
    let aiOriginalSnippet = "";
    let aiSpacerZoneId: string | null = null;
    /** 与 addZone 传入的是同一对象引用，后续只改字段再 layoutZone，避免 remove+add 闪屏 */
    let aiViewZoneDelegate: monaco.editor.IViewZone | null = null;
    /** Cursor 式：整块 UI 挂在 View Zone 内（gutter 对齐 + 卡片） */
    let aiZoneOuter: HTMLDivElement | null = null;
    let aiZoneGutter: HTMLDivElement | null = null;
    let aiInstructionResolve: ((value: string | null) => void) | null = null;
    let aiPreviewResolve: ((accepted: boolean) => void) | null = null;
    const resolveAiPreview = (accepted: boolean) => {
      if (!aiPreviewResolve) return;
      const r = aiPreviewResolve;
      aiPreviewResolve = null;
      r(accepted);
    };
    let aiDiffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
    let aiOriginalModel: monaco.editor.ITextModel | null = null;
    let aiModifiedModel: monaco.editor.ITextModel | null = null;
    let panelResizeObs: ResizeObserver | null = null;
    /** 将 zone 同步移出 RO 回调；在回调里改尺寸会触发 undelivered notifications，用 macrotask 合批 */
    let aiPanelResizeFlushHandle: ReturnType<typeof setTimeout> | null = null;
    let detachDiffLayout: (() => void) | null = null;

    const emitAiPhaseToParent = (phase: "idle" | "instruct" | "loading" | "preview") => {
      props.onAiEditPhaseChange?.(phase);
    };

    const disposeAiDiff = () => {
      detachDiffLayout?.();
      detachDiffLayout = null;
      aiDiffEditor?.dispose();
      aiDiffEditor = null;
      aiOriginalModel?.dispose();
      aiOriginalModel = null;
      aiModifiedModel?.dispose();
      aiModifiedModel = null;
    };

    const removeAiSpacerZone = () => {
      if (!editor || !aiSpacerZoneId) {
        aiSpacerZoneId = null;
        return;
      }
      const id = aiSpacerZoneId;
      aiSpacerZoneId = null;
      editor.changeViewZones((accessor) => accessor.removeZone(id));
      aiViewZoneDelegate = null;
    };

    const setUiForInstruct = () => {
      instructionRow.style.display = "flex";
      diffSection.style.display = "none";
      loadingRow.style.display = "none";
      diffHost.style.display = "none";
      previewRow.style.display = "none";
    };

    const setUiForLoading = () => {
      instructionRow.style.display = "none";
      diffSection.style.display = "flex";
      loadingRow.style.display = "block";
      diffHost.style.display = "none";
      previewRow.style.display = "none";
    };

    const setUiForPreview = () => {
      instructionRow.style.display = "none";
      diffSection.style.display = "flex";
      loadingRow.style.display = "none";
      diffHost.style.display = "block";
      previewRow.style.display = "flex";
    };

    // Ctrl+K / AI Edit：Cursor 式 View Zone（撑开行距、随文档滚动）+ 内嵌 Diff
    container.style.position = "relative";
    const aiEditPanel = document.createElement("div");
    aiEditPanel.className = "monaco-sql-ai-panel";
    aiEditPanel.tabIndex = -1;
    aiEditPanel.style.cssText = [
      "position:absolute",
      "left:12px",
      "right:12px",
      "top:8px",
      "z-index:30",
      "display:none",
      "flex-direction:column",
      "gap:8px",
      "padding:8px",
      "border-radius:8px",
      "background:var(--vscode-editorWidget-background,#252526)",
      "border:1px solid var(--vscode-widget-border,#454545)",
      "box-shadow:0 4px 12px rgba(0,0,0,.25)",
      "max-height:55vh",
      "min-width:0",
      "box-sizing:border-box",
    ].join(";");

    const instructionRow = document.createElement("div");
    instructionRow.style.cssText = "display:flex;align-items:center;gap:8px;flex-shrink:0;min-width:0";
    const aiEditLabel = document.createElement("span");
    aiEditLabel.textContent = "AI 编辑要求";
    aiEditLabel.style.cssText = "font-size:12px;color:var(--vscode-foreground,#ddd);white-space:nowrap;";
    const aiEditInputWrapper = document.createElement("div");
    aiEditInputWrapper.style.cssText = "flex:1;min-width:120px";
    const aiEditInput = document.createElement("input");
    aiEditInput.type = "text";
    aiEditInput.style.cssText = [
      "width:100%",
      "box-sizing:border-box",
      "height:28px",
      "padding:0 8px",
      "border-radius:6px",
      "border:1px solid var(--vscode-input-border,#3c3c3c)",
      "background:var(--vscode-input-background,#3c3c3c)",
      "color:var(--vscode-input-foreground,#ddd)",
      "outline:none",
      "font-size:12px",
    ].join(";");
    aiEditInputWrapper.appendChild(aiEditInput);

    const aiEditCopyPrompt = document.createElement("button");
    aiEditCopyPrompt.type = "button";
    aiEditCopyPrompt.textContent = "复制 Prompt";
    aiEditCopyPrompt.style.cssText =
      "height:28px;padding:0 10px;border:1px solid var(--vscode-widget-border,#454545);border-radius:6px;background:transparent;color:var(--vscode-foreground,#ddd);cursor:pointer;font-size:12px;flex-shrink:0";
    const aiEditOk = document.createElement("button");
    aiEditOk.type = "button";
    aiEditOk.textContent = "确定";
    aiEditOk.style.cssText =
      "height:28px;padding:0 10px;border:none;border-radius:6px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);cursor:pointer;font-size:12px;flex-shrink:0";
    const aiEditCancel = document.createElement("button");
    aiEditCancel.type = "button";
    aiEditCancel.textContent = "取消";
    aiEditCancel.style.cssText =
      "height:28px;padding:0 10px;border:1px solid var(--vscode-widget-border,#454545);border-radius:6px;background:transparent;color:var(--vscode-foreground,#ddd);cursor:pointer;font-size:12px;flex-shrink:0";
    instructionRow.append(aiEditLabel, aiEditInputWrapper, aiEditCopyPrompt, aiEditOk, aiEditCancel);

    const diffSection = document.createElement("div");
    // 不用 flex:1：在 View Zone 内父级高度由 Monaco 指派时，子项 flex:1 会与「测高度→改 zone」形成正反馈，导致高度持续上涨
    diffSection.style.cssText = "display:none;flex-direction:column;gap:6px;flex-shrink:0;min-width:0";
    const previewRow = document.createElement("div");
    previewRow.style.cssText =
      "display:none;gap:8px;justify-content:flex-end;flex-wrap:wrap;align-items:center;flex-shrink:0;width:100%";
    const previewHint = document.createElement("span");
    previewHint.textContent = "Ctrl+Enter 接受 · Esc 拒绝";
    previewHint.style.cssText =
      "font-size:11px;color:var(--vscode-descriptionForeground,#858585);margin-right:auto;flex:1;min-width:120px";
    const rejectPreviewBtn = document.createElement("button");
    rejectPreviewBtn.type = "button";
    rejectPreviewBtn.textContent = "拒绝";
    rejectPreviewBtn.title = "拒绝修改 (Esc)";
    rejectPreviewBtn.style.cssText =
      "height:28px;padding:0 10px;border:1px solid var(--vscode-widget-border,#454545);border-radius:6px;background:transparent;color:var(--vscode-foreground,#ddd);cursor:pointer;font-size:12px";
    const acceptPreviewBtn = document.createElement("button");
    acceptPreviewBtn.type = "button";
    acceptPreviewBtn.textContent = "接受";
    acceptPreviewBtn.title = "接受修改 (Ctrl+Enter)";
    acceptPreviewBtn.style.cssText =
      "height:28px;padding:0 10px;border:none;border-radius:6px;background:var(--vscode-button-background,#0e639c);color:var(--vscode-button-foreground,#fff);cursor:pointer;font-size:12px";
    previewRow.append(previewHint, rejectPreviewBtn, acceptPreviewBtn);

    const loadingRow = document.createElement("div");
    loadingRow.textContent = "生成中…";
    loadingRow.style.cssText =
      "font-size:12px;color:var(--vscode-descriptionForeground,#858585);padding:8px;display:none";
    const diffHost = document.createElement("div");
    diffHost.className = "sql-ai-diff-host";
    diffHost.style.cssText =
      "display:none;min-height:160px;width:100%;overflow:hidden;border:1px solid var(--vscode-widget-border,#454545);border-radius:4px;box-sizing:border-box;background-color:var(--vscode-editor-background,#1e1e1e)";
    diffSection.append(previewRow, loadingRow, diffHost);

    /** 勿在嵌套 Diff 子编辑器上 addCommand(Ctrl+Enter)：会与主 SQL 编辑器的全局快捷键冲突，dispose 后主编辑器仍可能无法执行查询 */
    diffHost.addEventListener(
      "keydown",
      (e) => {
        if (aiPanelPhase !== "preview" || !aiPreviewResolve) return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          resolveAiPreview(false);
          return;
        }
        if (
          e.key === "Enter" &&
          (e.ctrlKey || e.metaKey) &&
          !e.altKey &&
          !e.shiftKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          resolveAiPreview(true);
        }
      },
      true
    );

    aiEditPanel.append(instructionRow, diffSection);
    container.appendChild(aiEditPanel);

    const applyDiffSideBySideFromWidth = () => {
      if (!aiDiffEditor) return;
      const w = diffHost.getBoundingClientRect().width;
      try {
        const sideBySide = w >= AI_DIFF_SIDEBYSIDE_MIN_PX;
        aiDiffEditor.updateOptions({ renderSideBySide: sideBySide, compactMode: !sideBySide });
      } catch {
        /* disposed */
      }
      try {
        aiDiffEditor.layout();
      } catch {
        /* disposed */
      }
    };

    const applyAiPanelStylesDockedHidden = () => {
      aiEditPanel.style.cssText = [
        "position:absolute",
        "left:12px",
        "right:12px",
        "top:8px",
        "z-index:30",
        "display:none",
        "flex-direction:column",
        "gap:8px",
        "padding:8px",
        "border-radius:8px",
        "background:var(--vscode-editorWidget-background,#252526)",
        "border:1px solid var(--vscode-widget-border,#454545)",
        "box-shadow:0 4px 12px rgba(0,0,0,.25)",
        "max-height:55vh",
        "min-width:0",
        "box-sizing:border-box",
      ].join(";");
    };

    const applyAiPanelStylesInViewZone = () => {
      aiEditPanel.style.cssText = [
        "position:relative",
        "left:auto",
        "right:auto",
        "top:auto",
        "z-index:100",
        "flex:1",
        "min-width:0",
        "max-width:min(900px,100%)",
        "margin-left:2px",
        "margin-right:16px",
        "display:flex",
        "flex-direction:column",
        "gap:8px",
        "padding:8px 4px 8px 8px",
        "border-radius:6px",
        "font-size:12px",
        "line-height:1.5em",
        "background-color:var(--vscode-editor-background,#1e1e1e)",
        "color:var(--vscode-foreground,#ddd)",
        "border:1px solid var(--vscode-widget-border,#454545)",
        "box-shadow:0 4px 12px rgba(0,0,0,.22)",
        "max-height:55vh",
        "box-sizing:border-box",
        "overflow:hidden auto",
      ].join(";");
    };

    const updateAiZoneGutterWidth = () => {
      if (!editor || !aiZoneGutter) return;
      try {
        const w = editor.getLayoutInfo().lineNumbersWidth;
        aiZoneGutter.style.width = `${Math.max(0, Math.round(w))}px`;
      } catch {
        aiZoneGutter.style.width = "31px";
      }
    };

    const ensureAiZoneShell = () => {
      if (!aiZoneOuter) {
        aiZoneGutter = document.createElement("div");
        aiZoneGutter.className = "sql-ai-zone-gutter";
        aiZoneGutter.style.cssText = "flex-shrink:0;width:31px";
        aiZoneOuter = document.createElement("div");
        aiZoneOuter.className = "sql-ai-inline-diff-zone";
        aiZoneOuter.setAttribute("role", "presentation");
        aiZoneOuter.tabIndex = -1;
        aiZoneOuter.style.cssText =
          "display:flex;flex-direction:row;align-items:flex-start;width:100%;box-sizing:border-box;padding-top:6px;outline:none";
        aiZoneOuter.append(aiZoneGutter, aiEditPanel);
      } else if (aiEditPanel.parentNode !== aiZoneOuter) {
        aiZoneOuter.append(aiZoneGutter!, aiEditPanel);
      }
      updateAiZoneGutterWidth();
    };

    const syncAiPanelViewZone = () => {
      const zoneRoot = aiZoneOuter;
      if (!editor || aiPanelPhase === "closed" || aiAnchorOffset == null || !zoneRoot) return;
      const model = editor.getModel();
      if (!model) return;
      updateAiZoneGutterWidth();
      const len = model.getValue().length;
      const o = Math.min(Math.max(0, aiAnchorOffset), len);
      const anchorPos = model.getPositionAt(o);
      const anchorLine = anchorPos.lineNumber;
      /** 插在触发行的「上方」：zone 在 anchorLine-1 与 anchorLine 之间（首行用 0，与 Monaco IViewZone 约定一致） */
      const zoneAfterLine = Math.max(0, anchorLine - 1);
      // 不能用「测量值 + 常数」：Monaco 按 heightInPx 撑开 zone 后，下一轮测量已包含该高度，再 + 常数会每轮累加（+8 一直涨）
      const rect = zoneRoot.getBoundingClientRect();
      const h = Math.max(Math.ceil(rect.height), 56);

      if (
        aiSpacerZoneId &&
        aiViewZoneDelegate &&
        aiViewZoneDelegate.heightInPx === h &&
        aiViewZoneDelegate.afterLineNumber === zoneAfterLine
      ) {
        return;
      }

      if (!aiViewZoneDelegate) {
        aiViewZoneDelegate = {
          afterLineNumber: zoneAfterLine,
          heightInPx: h,
          domNode: zoneRoot,
          suppressMouseDown: false,
        };
      } else {
        aiViewZoneDelegate.afterLineNumber = zoneAfterLine;
        aiViewZoneDelegate.heightInPx = h;
        aiViewZoneDelegate.domNode = zoneRoot;
      }

      editor.changeViewZones((accessor) => {
        if (aiSpacerZoneId) {
          accessor.layoutZone(aiSpacerZoneId);
        } else {
          aiSpacerZoneId = accessor.addZone(aiViewZoneDelegate!);
        }
      });
    };

    const blurMonacoTextInput = () => {
      try {
        const ta = editor?.getDomNode()?.querySelector("textarea.inputarea");
        if (ta instanceof HTMLTextAreaElement) ta.blur();
      } catch {
        /* ignore */
      }
    };

    /** 当前焦点是否在 AI 面板 DOM 内（含内嵌 Diff 的 Monaco） */
    const isFocusInsideAiPanel = (): boolean => {
      const ae = document.activeElement;
      return !!(ae && aiEditPanel.contains(ae));
    };

    /**
     * 把焦点放到当前阶段面板上的主控件：instruct → 输入框；preview → 接受；loading → 面板容器。
     * aggressive：刚打开 instruct 时 Monaco 会抢焦点，需多拍 rAF/微任务再抢回输入框。
     */
    const focusAiDialogPrimary = (opts?: { aggressive?: boolean }) => {
      blurMonacoTextInput();
      const aggressive = opts?.aggressive ?? false;

      const focusInstruct = () => {
        aiEditInput.focus({ preventScroll: true });
        aiEditInput.select();
      };
      const focusPreview = () => {
        acceptPreviewBtn.focus({ preventScroll: true });
      };

      if (aiPanelPhase === "instruct") {
        if (aggressive) {
          requestAnimationFrame(() => {
            syncAiPanelViewZone();
            requestAnimationFrame(() => {
              syncAiPanelViewZone();
              focusInstruct();
              queueMicrotask(focusInstruct);
              setTimeout(focusInstruct, 0);
              setTimeout(() => {
                if (document.activeElement !== aiEditInput) focusInstruct();
              }, 40);
            });
          });
        } else {
          focusInstruct();
          requestAnimationFrame(() => {
            syncAiPanelViewZone();
            if (document.activeElement !== aiEditInput) focusInstruct();
          });
          setTimeout(() => {
            if (document.activeElement !== aiEditInput) {
              blurMonacoTextInput();
              focusInstruct();
            }
          }, 40);
        }
        return;
      }

      if (aiPanelPhase === "preview") {
        focusPreview();
        requestAnimationFrame(() => {
          syncAiPanelViewZone();
          if (document.activeElement !== acceptPreviewBtn) {
            blurMonacoTextInput();
            focusPreview();
          }
        });
        setTimeout(() => {
          if (document.activeElement !== acceptPreviewBtn) {
            blurMonacoTextInput();
            focusPreview();
          }
        }, 40);
        return;
      }

      if (aiPanelPhase === "loading") {
        aiEditPanel.focus({ preventScroll: true });
      }
    };

    const closeAiPanel = () => {
      if (aiPanelResizeFlushHandle != null) {
        clearTimeout(aiPanelResizeFlushHandle);
        aiPanelResizeFlushHandle = null;
      }
      panelResizeObs?.disconnect();
      panelResizeObs = null;
      disposeAiDiff();
      removeAiSpacerZone();
      if (aiEditPanel.parentNode !== container) {
        container.appendChild(aiEditPanel);
      }
      applyAiPanelStylesDockedHidden();
      aiEditPanel.style.display = "none";
      aiPanelPhase = "closed";
      aiRangeOffsets = null;
      aiAnchorOffset = null;
      aiInstructionResolve = null;
      aiPreviewResolve = null;
      emitAiPhaseToParent("idle");
      aiSentRangeDecorations.clear();
      editor?.focus();
      requestAnimationFrame(() => {
        editor?.focus();
      });
    };

    /** 将要发给 AI 的 [start,end) 范围高亮（与 editor 选区风格接近） */
    const refreshAiSentRangeHighlight = () => {
      if (!editor || aiPanelPhase === "closed" || !aiRangeOffsets) {
        aiSentRangeDecorations.clear();
        return;
      }
      const model = editor.getModel();
      if (!model) return;
      let { start, end } = aiRangeOffsets;
      if (end < start) [start, end] = [end, start];
      const len = model.getValueLength();
      start = Math.min(Math.max(0, start), len);
      end = Math.min(Math.max(0, end), len);
      if (start >= end) {
        aiSentRangeDecorations.clear();
        return;
      }
      const sPos = model.getPositionAt(start);
      const ePos = model.getPositionAt(end);
      aiSentRangeDecorations.set([
        {
          range: monaco.Range.fromPositions(sPos, ePos),
          options: { className: "monaco-sql-ai-sent-range" },
        },
      ]);
    };

    const getCurrentSqlForAiBar = (): string => {
      const model = editor?.getModel();
      if (!editor || !model) return "";
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        return model.getValueInRange(selection).trim();
      }
      const pos = editor.getPosition();
      const full = model.getValue();
      const offset = pos ? model.getOffsetAt(pos) : 0;
      const block = getSqlBlockAtCursor(full, offset);
      return block.text.trim();
    };

    aiEditCopyPrompt.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!props.onAiCopyPrompt) return;
      const sqlForPrompt = aiRangeOffsets
        ? editor!.getModel()!.getValue().slice(aiRangeOffsets.start, aiRangeOffsets.end).trim()
        : getCurrentSqlForAiBar();
      if (!sqlForPrompt) return;
      props.onAiCopyPrompt(sqlForPrompt, aiEditInput.value);
    });
    aiEditInput.addEventListener("input", () => {
      props.onAiEditInstructionChange?.(aiEditInput.value);
    });
    aiEditInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = aiEditInput.value.trim();
        if (!v || !aiInstructionResolve) return;
        lastAiEditInstruction = v;
        props.onAiEditInstructionChange?.(v);
        const r = aiInstructionResolve;
        aiInstructionResolve = null;
        r(v);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (aiInstructionResolve) {
          const r = aiInstructionResolve;
          aiInstructionResolve = null;
          r(null);
        }
        closeAiPanel();
      }
    });

    aiEditOk.addEventListener("click", () => {
      if (!aiInstructionResolve) return;
      const v = aiEditInput.value.trim();
      if (!v) return;
      lastAiEditInstruction = v;
      props.onAiEditInstructionChange?.(v);
      const r = aiInstructionResolve;
      aiInstructionResolve = null;
      r(v);
    });
    aiEditCancel.addEventListener("click", () => {
      if (aiInstructionResolve) {
        const r = aiInstructionResolve;
        aiInstructionResolve = null;
        r(null);
      }
      closeAiPanel();
    });

    acceptPreviewBtn.addEventListener("click", () => resolveAiPreview(true));
    rejectPreviewBtn.addEventListener("click", () => resolveAiPreview(false));

    const isCtrlCmdK = (e: KeyboardEvent) =>
      (e.key === "k" || e.key === "K") &&
      (e.ctrlKey || e.metaKey) &&
      !e.altKey &&
      !e.shiftKey;

    aiEditPanel.addEventListener("keydown", (e) => {
      if (
        aiPanelPhase === "preview" &&
        aiPreviewResolve &&
        e.key === "Enter" &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        resolveAiPreview(true);
        return;
      }
      if (e.key === "Escape" && aiPanelPhase === "preview" && aiPreviewResolve) {
        e.preventDefault();
        resolveAiPreview(false);
        return;
      }
      if (isCtrlCmdK(e) && aiPanelPhase !== "closed" && editor) {
        e.preventDefault();
        e.stopPropagation();
        editor.focus();
      }
    });

    const ensurePanelResizeObserver = () => {
      if (panelResizeObs) return;
      panelResizeObs = new ResizeObserver(() => {
        if (aiPanelPhase === "closed" || !panelResizeObs) return;
        if (aiPanelResizeFlushHandle != null) clearTimeout(aiPanelResizeFlushHandle);
        aiPanelResizeFlushHandle = setTimeout(() => {
          aiPanelResizeFlushHandle = null;
          if (aiPanelPhase === "closed" || !panelResizeObs) return;
          syncAiPanelViewZone();
          applyDiffSideBySideFromWidth();
        }, 0);
      });
      panelResizeObs.observe(aiEditPanel);
    };

    const showDiffPreview = (original: string, modified: string): Promise<boolean> => {
      disposeAiDiff();
      diffHost.innerHTML = "";
      const currentTheme = getTheme()?.monacoTheme ?? "vs-dark";

      setUiForPreview();
      const h = computeAiDiffHostHeightPx(original, modified);
      diffHost.style.height = `${h}px`;

      const sideBySide = diffHost.getBoundingClientRect().width >= AI_DIFF_SIDEBYSIDE_MIN_PX;

      aiOriginalModel = monaco.editor.createModel(original, "sql");
      aiModifiedModel = monaco.editor.createModel(modified, "sql");
      aiDiffEditor = monaco.editor.createDiffEditor(diffHost, {
        originalEditable: false,
        readOnly: true,
        minimap: { enabled: false },
        renderSideBySide: sideBySide,
        diffWordWrap: "on",
        compactMode: !sideBySide,
        renderOverviewRuler: false,
        renderMarginRevertIcon: false,
        ignoreTrimWhitespace: false,
        isInEmbeddedEditor: true,
        fontSize: 12,
        scrollBeyondLastLine: false,
        automaticLayout: false,
        lineNumbers: "on",
        wordWrap: "on",
      });
      aiDiffEditor.setModel({ original: aiOriginalModel, modified: aiModifiedModel });
      monaco.editor.setTheme(currentTheme);

      detachDiffLayout = attachDiffEditorLayoutOnResize(diffHost, aiDiffEditor);

      applyDiffSideBySideFromWidth();

      aiPanelPhase = "preview";
      emitAiPhaseToParent("preview");
      requestAnimationFrame(() => {
        applyDiffSideBySideFromWidth();
        aiDiffEditor?.layout();
        syncAiPanelViewZone();
        focusAiDialogPrimary();
      });
      return new Promise<boolean>((resolve) => {
        aiPreviewResolve = resolve;
      });
    };

    function extractAiEditOutput(
      edited:
        | string
        | {
            sql: string;
            elapsedMs?: number;
            usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
            schemaInjected?: string[];
          }
        | void
    ): string {
      if (typeof edited === "string") return edited.trim();
      if (edited && typeof edited === "object" && typeof edited.sql === "string") return edited.sql.trim();
      return "";
    }

    async function runAiEditWorkflow(ctx: {
      start: number;
      end: number;
      sqlToEdit: string;
      allowEmpty: boolean;
      /** 若设置，View Zone 挂在这行行首对应偏移的「上一行之后」（整段在对话框下）；默认用当前光标 */
      aiDialogAnchorOffset?: number;
    }) {
      if (!editor || !props.onAiEdit || aiPanelPhase !== "closed") return;
      const model = editor.getModel();
      if (!model) return;
      let { start, end, sqlToEdit, allowEmpty, aiDialogAnchorOffset } = ctx;
      if (end < start) [start, end] = [end, start];
      if (!allowEmpty && !sqlToEdit.trim()) return;

      let cursorPos = editor.getPosition();
      if (!cursorPos) cursorPos = model.getPositionAt(start);
      aiAnchorOffset =
        aiDialogAnchorOffset !== undefined
          ? aiDialogAnchorOffset
          : model.getOffsetAt(cursorPos);

      aiPanelPhase = "instruct";
      aiRangeOffsets = { start, end };
      refreshAiSentRangeHighlight();
      aiOriginalSnippet = model.getValue().slice(start, end);
      aiEditInput.value = lastAiEditInstruction;
      props.onAiEditInstructionChange?.(aiEditInput.value);
      setUiForInstruct();
      ensureAiZoneShell();
      applyAiPanelStylesInViewZone();
      aiEditPanel.style.display = "flex";
      emitAiPhaseToParent("instruct");
      ensurePanelResizeObserver();
      focusAiDialogPrimary({ aggressive: true });

      const instruction = await new Promise<string | null>((resolve) => {
        aiInstructionResolve = resolve;
      });
      if (!instruction?.trim()) {
        closeAiPanel();
        return;
      }

      aiPanelPhase = "loading";
      setUiForLoading();
      emitAiPhaseToParent("loading");
      diffSection.style.display = "flex";
      requestAnimationFrame(() => {
        syncAiPanelViewZone();
      });

      const sqlInput = aiOriginalSnippet.trim() || "/* empty sql block */";
      let edited: unknown;
      try {
        edited = await props.onAiEdit(sqlInput, instruction.trim());
      } catch {
        closeAiPanel();
        return;
      }

      const output = extractAiEditOutput(edited as Parameters<typeof extractAiEditOutput>[0]);
      if (!output) {
        closeAiPanel();
        return;
      }

      const accepted = await showDiffPreview(aiOriginalSnippet, output);
      if (accepted && editor) {
        disposeAiDiff();
        const m = editor.getModel();
        if (m && aiRangeOffsets) {
          const s = Math.min(aiRangeOffsets.start, m.getValue().length);
          const en = Math.min(aiRangeOffsets.end, m.getValue().length);
          const startPos = m.getPositionAt(s);
          const endPos = m.getPositionAt(en);
          m.pushStackElement();
          editor.executeEdits("ai-edit-accept", [
            {
              range: {
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
              },
              text: output,
            },
          ]);
          m.pushStackElement();
        }
      }
      closeAiPanel();
    }

    const runBlockWithHighlight = (startOffset: number, endOffset: number) => {
      const model = editor?.getModel();
      if (!model || startOffset >= endOffset) return;
      const sql = model.getValue().slice(startOffset, endOffset).trim();
      if (!sql) return;
      const startPos = model.getPositionAt(startOffset);
      const endPos = model.getPositionAt(endOffset);
      if (!startPos || !endPos) return;
      highlightDecorations.clear();
      highlightDecorations.set([
        {
          range: { startLineNumber: startPos.lineNumber, startColumn: startPos.column, endLineNumber: endPos.lineNumber, endColumn: endPos.column },
          options: { className: "monaco-sql-exec-highlight" },
        },
      ]);
      editor?.revealRangeInCenter({ startLineNumber: startPos.lineNumber, startColumn: startPos.column, endLineNumber: endPos.lineNumber, endColumn: endPos.column });
      props.onRun?.(sql);
      setTimeout(() => highlightDecorations.clear(), 200);
    };

    const createToolbarDomNodeForBlocks = (text: string, blocks: { start: number; end: number }[]): HTMLElement => {
      const dom = document.createElement("div");
      dom.className = "monaco-sql-codelens";
      dom.style.pointerEvents = "auto";
      const stop = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
      };
      dom.addEventListener("mousedown", stop, true);
      dom.addEventListener("mouseup", stop, true);
      blocks.forEach((b, i) => {
        if (i > 0) {
          const sep = document.createElement("span");
          sep.className = "sql-codelens-sep";
          sep.textContent = "|";
          dom.appendChild(sep);
        }
        const runBtn = document.createElement("button");
        runBtn.type = "button";
        runBtn.className = "sql-codelens-link";
        runBtn.innerHTML = '<span class="sql-codelens-icon">▶</span> Run';
        runBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          runBlockWithHighlight(b.start, b.end);
        });
        dom.appendChild(runBtn);
        
        // Add Format button for each block
        if (props.onFormat) {
          const formatSep = document.createElement("span");
          formatSep.className = "sql-codelens-sep";
          formatSep.textContent = "|";
          dom.appendChild(formatSep);
          const formatBtn = document.createElement("button");
          formatBtn.type = "button";
          formatBtn.className = "sql-codelens-link";
          formatBtn.innerHTML = '<span class="sql-codelens-icon">✨</span> Format';
          formatBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const model = editor?.getModel();
            if (!model) return;
            // Get current text from model
            const currentText = model.getValue();
            const blockText = currentText.slice(b.start, b.end).trim();
            if (!blockText) return;
            const formatted = props.onFormat!(blockText);
            if (typeof formatted === "string" && formatted !== blockText) {
              editor!.executeEdits("format-block", [
                { range: { 
                  startLineNumber: model.getPositionAt(b.start).lineNumber, 
                  startColumn: model.getPositionAt(b.start).column,
                  endLineNumber: model.getPositionAt(b.end).lineNumber,
                  endColumn: model.getPositionAt(b.end).column
                }, text: formatted }
              ]);
            }
          });
          dom.appendChild(formatBtn);
        }
        
        if (props.onExplain) {
          const explainSep = document.createElement("span");
          explainSep.className = "sql-codelens-sep";
          explainSep.textContent = "|";
          dom.appendChild(explainSep);
          const explainBtn = document.createElement("button");
          explainBtn.type = "button";
          explainBtn.className = "sql-codelens-link";
          explainBtn.innerHTML = '<span class="sql-codelens-icon">📊</span> Explain';
          explainBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sql = text.slice(b.start, b.end).trim();
            if (sql) props.onExplain!(sql);
          });
          dom.appendChild(explainBtn);
        }
        if (props.onAiEdit) {
          const aiEditSep = document.createElement("span");
          aiEditSep.className = "sql-codelens-sep";
          aiEditSep.textContent = "|";
          dom.appendChild(aiEditSep);
          const aiEditBtn = document.createElement("button");
          aiEditBtn.type = "button";
          aiEditBtn.className = "sql-codelens-link";
          aiEditBtn.innerHTML = '<span class="sql-codelens-icon">🤖</span> AI Edit';
          aiEditBtn.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const model = editor?.getModel();
            if (!model) return;
            const currentSql = text.slice(b.start, b.end).trim();
            if (!currentSql) return;
            await runAiEditWorkflow({
              start: b.start,
              end: b.end,
              sqlToEdit: currentSql,
              allowEmpty: false,
              aiDialogAnchorOffset: lineStartOffsetForOffset(model, b.start),
            });
          });
          dom.appendChild(aiEditBtn);
        }
        if (props.onAiOptimize) {
          const aiOptSep = document.createElement("span");
          aiOptSep.className = "sql-codelens-sep";
          aiOptSep.textContent = "|";
          dom.appendChild(aiOptSep);
          const aiOptimizeBtn = document.createElement("button");
          aiOptimizeBtn.type = "button";
          aiOptimizeBtn.className = "sql-codelens-link";
          aiOptimizeBtn.innerHTML = '<span class="sql-codelens-icon">⚡</span> AI Optimize';
          aiOptimizeBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sql = text.slice(b.start, b.end).trim();
            if (sql) props.onAiOptimize!(sql);
          });
          dom.appendChild(aiOptimizeBtn);
        }
      });
      return dom;
    };

    const updateBlockRunZones = () => {
      const model = editor!.getModel();
      if (!model) return;
      editor!.changeViewZones((accessor) => {
        blockRunZoneIds.forEach((id) => accessor.removeZone(id));
        blockRunZoneIds.length = 0;
        const text = model.getValue();
        const blocks = getAllBlocks(text).filter((b) => text.slice(b.start, b.end).trim());
        const byLine = new Map<number, { start: number; end: number }[]>();
        blocks.forEach((b) => {
          const pos = model.getPositionAt(b.start);
          if (!pos) return;
          const line = pos.lineNumber;
          if (!byLine.has(line)) byLine.set(line, []);
          byLine.get(line)!.push({ start: b.start, end: b.end });
        });
        byLine.forEach((blocksOnLine, lineNumber) => {
          const afterLine = Math.max(0, lineNumber - 1);
          const zoneId = accessor.addZone({
            afterLineNumber: afterLine,
            heightInPx: 12,
            minWidthInPx: 200,
            domNode: createToolbarDomNodeForBlocks(text, blocksOnLine),
            suppressMouseDown: true,
          });
          blockRunZoneIds.push(zoneId);
        });
      });
    };

    const aiLayoutDisposable = editor.onDidLayoutChange(() => {
      if (aiPanelPhase === "closed") return;
      updateAiZoneGutterWidth();
      syncAiPanelViewZone();
      aiDiffEditor?.layout();
    });

    /**
     * 打开 AI 面板的字符偏移需随编辑平移，否则在锚点前插入（如回车）后 getPositionAt(aiAnchorOffset)
     * 仍指向旧偏移，View Zone 会挂在错误行，出现「新行跑到对话框下面」；与 Cursor 的粘性锚点一致。
     * changes 顺序为文末→文首，按序累加偏移即可（Monaco 文档说明）。
     */
    const shiftAiAnchorForModelContent = (e: monaco.editor.IModelContentChangedEvent) => {
      if (aiAnchorOffset == null || !editor) return;
      const model = editor.getModel();
      if (!model) return;
      if (e.isFlush) {
        aiAnchorOffset = Math.min(aiAnchorOffset, model.getValueLength());
        return;
      }
      let a = aiAnchorOffset;
      for (const c of e.changes) {
        const rStart = c.rangeOffset;
        const rEnd = c.rangeOffset + c.rangeLength;
        const net = c.text.length - c.rangeLength;
        if (rEnd <= a) {
          a += net;
        } else if (rStart < a && a < rEnd) {
          const pos = editor.getPosition();
          a = pos ? model.getOffsetAt(pos) : Math.min(rStart, model.getValueLength());
        }
      }
      aiAnchorOffset = Math.min(Math.max(0, a), model.getValueLength());
    };

    const shiftAiRangeOffsetsForModelContent = (e: monaco.editor.IModelContentChangedEvent) => {
      if (!aiRangeOffsets || !editor) return;
      const ed = editor;
      const model = ed.getModel();
      if (!model) return;
      if (e.isFlush) {
        const len = model.getValueLength();
        aiRangeOffsets = {
          start: Math.min(aiRangeOffsets.start, len),
          end: Math.min(aiRangeOffsets.end, len),
        };
        return;
      }
      let s = aiRangeOffsets.start;
      let en = aiRangeOffsets.end;
      for (const c of e.changes) {
        const rStart = c.rangeOffset;
        const rEnd = c.rangeOffset + c.rangeLength;
        const net = c.text.length - c.rangeLength;
        const adj = (a: number) => {
          if (rEnd <= a) return a + net;
          if (rStart < a && a < rEnd) {
            const pos = ed.getPosition();
            return pos ? model.getOffsetAt(pos) : Math.min(rStart, model.getValueLength());
          }
          return a;
        };
        s = adj(s);
        en = adj(en);
      }
      const len = model.getValueLength();
      s = Math.min(Math.max(0, s), len);
      en = Math.min(Math.max(0, en), len);
      if (s > en) [s, en] = [en, s];
      aiRangeOffsets = { start: s, end: en };
    };

    editor.onDidChangeModelContent((e) => {
      if (aiPanelPhase !== "closed") {
        shiftAiAnchorForModelContent(e);
        shiftAiRangeOffsetsForModelContent(e);
        refreshAiSentRangeHighlight();
      }
      const val = editor!.getValue();
      if (props.onChange && val !== props.value) {
        props.onChange(val);
      }
      updateBlockRunZones();
      if (aiPanelPhase !== "closed") {
        requestAnimationFrame(() => {
          syncAiPanelViewZone();
          aiDiffEditor?.layout();
        });
      }
    });
    updateBlockRunZones();

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      if (!editor) return;
      const model = editor.getModel();
      const selection = editor.getSelection();
      const hasSelection = selection && !selection.isEmpty();

      if (hasSelection && model) {
        const sqlToRun = model.getValueInRange(selection!).trim();
        if (sqlToRun) {
          const start = model.getOffsetAt(selection!.getStartPosition());
          const end = model.getOffsetAt(selection!.getEndPosition());
          runBlockWithHighlight(start, end);
          return;
        }
      }
      if (model) {
        const position = editor.getPosition();
        const full = model.getValue();
        const offset = position ? model.getOffsetAt(position) : 0;
        const block = getSqlBlockAtCursor(full, offset);
        if (block.text) {
          runBlockWithHighlight(block.start, block.end);
        } else {
          props.onRun?.();
        }
      } else {
        props.onRun?.();
      }
    });

    /**
     * Ctrl/Cmd+K（主编辑器侧，由 addCommand 触发）：
     * - 面板关 → 打开 AI 流程；
     * - 面板开且焦点在面板内 → 焦点回主编辑器（与面板内 keydown 行为一致）；
     * - 面板开且焦点不在面板内（主 SQL 编辑区等）→ 焦点回面板当前阶段主控件。
     * 勿用 async 回调，否则 Monaco 会在命令结束后立刻抢回 textarea 焦点。
     */
    const handleAiCtrlCmdK = () => {
      if (!editor || !props.onAiEdit) return;

      if (aiPanelPhase !== "closed") {
        if (isFocusInsideAiPanel()) {
          editor.focus();
          return;
        }
        focusAiDialogPrimary();
        return;
      }

      const model = editor.getModel();
      if (!model) return;
      const selection = editor.getSelection();
      let start = 0;
      let end = 0;
      let sqlToEdit = "";
      let aiDialogAnchorOffset: number | undefined;
      if (selection && !selection.isEmpty()) {
        const expanded = fullLineOffsetsFromSelection(model, selection);
        start = expanded.start;
        end = expanded.end;
        sqlToEdit = model.getValue().slice(start, end).trim();
        aiDialogAnchorOffset = start;
      } else {
        const pos = editor.getPosition();
        const full = model.getValue();
        const offset = pos ? model.getOffsetAt(pos) : 0;
        const block = getSqlBlockAtCursor(full, offset);
        start = block.start;
        end = block.end;
        sqlToEdit = block.text;
        aiDialogAnchorOffset = lineStartOffsetForOffset(model, start);
      }
      void runAiEditWorkflow({
        start,
        end,
        sqlToEdit,
        allowEmpty: true,
        aiDialogAnchorOffset,
      });
    };

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, handleAiCtrlCmdK);

    const doFormat = () => {
      const model = editor?.getModel();
      if (!model || !props.onFormat) return;
      const current = model.getValue();
      const formatted = props.onFormat(current);
      if (typeof formatted === "string" && formatted !== current) {
        editor!.executeEdits("format", [
          { range: model.getFullModelRange(), text: formatted },
        ]);
        lastFormattedValue = formatted;
        props.onChange?.(formatted);
      }
    };

    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, doFormat);

    // Webview 中 clipboard 受限：统一用 vscode.env.clipboard 桥接，保持单一剪贴板状态
    const doPaste = () => {
      const model = editor?.getModel();
      const sel = editor?.getSelection();
      if (!model || !sel) return;
      readClipboardText().then((text) => {
        if (!text) return;
        if (sel.isEmpty()) {
          // 无选区：与 VSCode 一致，粘贴到下一行并自动加换行
          const lineNumber = sel.startLineNumber;
          const endCol = model.getLineMaxColumn(lineNumber);
          const range = {
            startLineNumber: lineNumber,
            startColumn: endCol,
            endLineNumber: lineNumber,
            endColumn: endCol,
          };
          editor!.executeEdits("paste", [{ range, text: "\n" + text }]);
          editor!.setPosition({ lineNumber: lineNumber + 1, column: 1 });
          editor!.revealLineInCenter(lineNumber + 1);
        } else {
          // 有选区：在光标处替换选区
          const range = {
            startLineNumber: sel.startLineNumber,
            startColumn: sel.startColumn,
            endLineNumber: sel.endLineNumber,
            endColumn: sel.endColumn,
          };
          editor!.executeEdits("paste", [{ range, text }]);
        }
      });
    };
    // copy/cut：仅同步到 vscode 剪贴板（副作用），不阻止 Monaco 默认行为
    const syncCopyToVscode = () => {
      const model = editor?.getModel();
      const sel = editor?.getSelection();
      if (!model || !sel) return;
      const text = sel.isEmpty()
        ? model.getLineContent(sel.startLineNumber)
        : model.getValueInRange(sel);
      writeClipboardText(text);
    };
    let keyDownDispose: monaco.IDisposable | undefined;
    let pasteDom: HTMLElement | null = null;
    const onPaste = (ev: ClipboardEvent) => {
      ev.preventDefault();
      ev.stopPropagation();
      doPaste();
    };
    const onCopy = (ev: ClipboardEvent) => {
      syncCopyToVscode();
      // 不 preventDefault，让 Monaco 保持默认复制行为
    };
    const onCut = (ev: ClipboardEvent) => {
      syncCopyToVscode();
      // 不 preventDefault，让 Monaco 保持默认剪切行为（删除选区）
    };
    if (typeof (window as any).acquireVsCodeApi === "function") {
      keyDownDispose = editor.onKeyDown((e) => {
        if ((e.ctrlKey || e.metaKey) && (e.browserEvent?.key?.toLowerCase() === "v" || e.keyCode === monaco.KeyCode.KeyV)) {
          e.preventDefault();
          e.stopPropagation();
          doPaste();
        }
        if ((e.ctrlKey || e.metaKey) && (e.browserEvent?.key?.toLowerCase() === "x" || e.keyCode === monaco.KeyCode.KeyX)) {
          e.preventDefault();
          e.stopPropagation();
          const model = editor?.getModel();
          const sel = editor?.getSelection();
          if (!model || !sel) return;
          const text = sel.isEmpty()
            ? model.getLineContent(sel.startLineNumber)
            : model.getValueInRange(sel);
          writeClipboardText(text);
          if (sel.isEmpty()) {
            // cut whole line: delete line including newline
            const lineNumber = sel.startLineNumber;
            const lineCount = model.getLineCount();
            const range = lineNumber < lineCount
              ? { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber + 1, endColumn: 1 }
              : { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: model.getLineMaxColumn(lineNumber) };
            editor!.executeEdits("cut", [{ range, text: "" }]);
          } else {
            editor!.executeEdits("cut", [{ range: sel, text: "" }]);
          }
        }
      });
      const dom = editor.getDomNode();
      if (dom) {
        pasteDom = dom;
        dom.addEventListener("paste", onPaste, true);
        dom.addEventListener("copy", onCopy, true);
        dom.addEventListener("cut", onCut, true);
      }
    }

    registerSqlEditor(container, editor);

    props.onEditorReady?.({ format: doFormat });

    onCleanup(() => {
      aiLayoutDisposable.dispose();
      if (aiPanelResizeFlushHandle != null) {
        clearTimeout(aiPanelResizeFlushHandle);
        aiPanelResizeFlushHandle = null;
      }
      aiSentRangeDecorations.clear();
      panelResizeObs?.disconnect();
      panelResizeObs = null;
      disposeAiDiff();
      removeAiSpacerZone();
      if (aiEditPanel.parentNode !== container) {
        container.appendChild(aiEditPanel);
      }
      applyAiPanelStylesDockedHidden();
      aiEditPanel.style.display = "none";
      aiPanelPhase = "closed";
      props.onAiEditPhaseChange?.("idle");
      aiInstructionResolve = null;
      aiPreviewResolve = null;
      aiRangeOffsets = null;
      aiAnchorOffset = null;
      if (pasteDom) {
        pasteDom.removeEventListener("paste", onPaste, true);
        pasteDom.removeEventListener("copy", onCopy, true);
        pasteDom.removeEventListener("cut", onCut, true);
      }
      keyDownDispose?.dispose();
      registerSqlEditor(container, null);
      unsub();
    });
  });

  createEffect(() => {
    const val = props.value;
    if (!editor) return;
    if (val === lastFormattedValue) {
      lastFormattedValue = null;
      return;
    }
    if (editor.getValue() !== val) {
      editor.setValue(val);
    }
  });

  onCleanup(() => {
    detachMonacoLayout?.();
    editor?.dispose();
  });

  return (
    <div
      ref={container!}
      data-sql-editor
      class={props.class}
      style={{
        height: "100%",
        width: "100%",
        ...(typeof props.style === "object" ? props.style : {}),
      }}
    />
  );
}
