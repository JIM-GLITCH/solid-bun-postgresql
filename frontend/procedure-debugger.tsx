/**
 * 存储过程调试器 - pldebugger 集成
 * 支持断点、单步、变量查看
 */
import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js";
import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
import { buildAndDefineVscodeTheme, VSCODE_MONACO_THEME } from "./monaco-vscode-theme";
import { getTheme, subscribe } from "./theme-sync";
import {
  debugCheck,
  debugStartDirect,
  debugContinue,
  debugStepInto,
  debugStepOver,
  debugAbort,
  debugGetState,
  debugSetBreakpoint,
  debugDropBreakpoint,
} from "./api";
import { vscode } from "./theme";

const MONACO_BASE = (typeof window !== "undefined" && (window as any).__MONACO_BASE__) || "./vs";
if (typeof self !== "undefined") {
  (self as any).MonacoEnvironment = (self as any).MonacoEnvironment || {};
  const env = (self as any).MonacoEnvironment;
  env.getWorkerUrl =
    env.getWorkerUrl ||
    ((_: string, label: string) => {
      if (label === "sql") return `${MONACO_BASE}/assets/editor.worker-Be8ye1pW.js`;
      return `${MONACO_BASE}/assets/editor.worker-Be8ye1pW.js`;
    });
}

export interface ProcedureDebuggerProps {
  connectionId: string;
  connectionInfo: string;
  funcOid: number;
  funcSchema: string;
  funcName: string;
  funcArgs: string;
  onClose?: () => void;
}

/** 解析函数参数定义，返回参数名列表（用于 UI 占位） */
function parseArgsHint(args: string): string[] {
  if (!args || !args.trim()) return [];
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "[" || c === "<") depth++;
    else if (c === ")" || c === "]" || c === ">") depth--;
    else if (c === "," && depth === 0) {
      const t = cur.trim();
      if (t) parts.push(t.split(/\s+/)[0] || t);
      cur = "";
      continue;
    }
    cur += c;
  }
  const t = cur.trim();
  if (t) parts.push(t.split(/\s+/)[0] || t);
  return parts;
}

export default function ProcedureDebugger(props: ProcedureDebuggerProps) {
  const [available, setAvailable] = createSignal<boolean | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [showParamDialog, setShowParamDialog] = createSignal(true);
  const [paramValues, setParamValues] = createSignal<string[]>([]);
  const [starting, setStarting] = createSignal(false);
  const [debugSessionId, setDebugSessionId] = createSignal<string | null>(null);
  const [source, setSource] = createSignal("");
  const [currentLine, setCurrentLine] = createSignal(0);
  const [currentFuncOid, setCurrentFuncOid] = createSignal(props.funcOid);
  const [variables, setVariables] = createSignal<any[]>([]);
  const [stack, setStack] = createSignal<any[]>([]);
  const [breakpoints, setBreakpoints] = createSignal<Set<number>>(new Set());
  const [stepping, setStepping] = createSignal(false);

  let editorContainer: HTMLDivElement;
  let lastDecoIds: string[] = [];
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  const argsHint = () => parseArgsHint(props.funcArgs);

  createEffect(() => {
    debugCheck(props.connectionId)
      .then((r) => setAvailable(r.available))
      .catch((e) => {
        setAvailable(false);
        setError(e.message);
      });
  });

  async function startDebug() {
    const args = paramValues().filter(Boolean).map((s) => s.trim());
    setStarting(true);
    setError(null);
    try {
      const result = await debugStartDirect(props.connectionId, props.funcOid, args);
      setDebugSessionId(result.debugSessionId);
      setShowParamDialog(false);
      setSource(result.source || "");
      setCurrentLine(result.breakpoint?.lineNumber ?? 1);
      setCurrentFuncOid(result.breakpoint?.funcOid ?? props.funcOid);
      setVariables(result.variables || []);
      setStack(result.stack || []);
    } catch (e: any) {
      const msg = e.message || String(e) || "启动调试失败";
      setError(msg);
      console.error("[ProcedureDebugger] 启动调试失败:", e);
    } finally {
      setStarting(false);
    }
  }

  async function doContinue() {
    const sid = debugSessionId();
    if (!sid) return;
    setStepping(true);
    setError(null);
    try {
      const result = await debugContinue(props.connectionId, sid);
      if (result.done) {
        setDebugSessionId(null);
        setError(null);
      } else if (result.stopped && result.breakpoint) {
        setCurrentLine(result.breakpoint.lineNumber);
        setCurrentFuncOid(result.breakpoint.funcOid);
        setSource(result.source ?? source());
        setVariables(result.variables || []);
        setStack(result.stack || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStepping(false);
    }
  }

  async function doStepInto() {
    const sid = debugSessionId();
    if (!sid) return;
    setStepping(true);
    setError(null);
    try {
      const result = await debugStepInto(props.connectionId, sid);
      if (result.stopped && result.breakpoint) {
        setCurrentLine(result.breakpoint.lineNumber);
        setCurrentFuncOid(result.breakpoint.funcOid);
        setSource(result.source ?? source());
        setVariables(result.variables || []);
        setStack(result.stack || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStepping(false);
    }
  }

  async function doStepOver() {
    const sid = debugSessionId();
    if (!sid) return;
    setStepping(true);
    setError(null);
    try {
      const result = await debugStepOver(props.connectionId, sid);
      if (result.stopped && result.breakpoint) {
        setCurrentLine(result.breakpoint.lineNumber);
        setCurrentFuncOid(result.breakpoint.funcOid);
        setSource(result.source ?? source());
        setVariables(result.variables || []);
        setStack(result.stack || []);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setStepping(false);
    }
  }

  async function doAbort() {
    const sid = debugSessionId();
    if (!sid) return;
    try {
      await debugAbort(props.connectionId, sid);
      setDebugSessionId(null);
    } catch {}
  }

  createEffect(() => {
    const src = source();
    if (editor && src) {
      const model = editor.getModel();
      if (model) {
        const pos = model.getPositionAt(0);
        model.setValue(src);
      }
    }
  });

  createEffect(() => {
    const line = currentLine();
    if (editor && line > 0) {
      editor.revealLineInCenter(line, 1);
      editor.setPosition({ lineNumber: line, column: 1 });
    }
  });

  onMount(() => {
    const themeInfo = getTheme();
    const initialTheme = themeInfo?.monacoTheme ?? "vs-dark";
    if (initialTheme === VSCODE_MONACO_THEME && themeInfo) {
      buildAndDefineVscodeTheme(monaco, themeInfo.themeKind);
    }

    editor = monaco.editor.create(editorContainer, {
      value: source(),
      language: "sql",
      theme: initialTheme,
      readOnly: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: "on",
      wordWrap: "on",
    });

    const unsub = subscribe((t) => {
      try {
        if (t.monacoTheme === VSCODE_MONACO_THEME && themeInfo) {
          buildAndDefineVscodeTheme(monaco, t.themeKind);
        }
        monaco.editor.setTheme(t.monacoTheme);
      } catch {}
    });

    editor.onMouseDown((e) => {
      const line = e.target.position?.lineNumber;
      if (line && e.target.type === 6) {
        const bp = new Set(breakpoints());
        if (bp.has(line)) {
          bp.delete(line);
          debugSessionId() &&
            debugDropBreakpoint(props.connectionId, debugSessionId()!, currentFuncOid(), line).catch(() => {});
        } else {
          bp.add(line);
          debugSessionId() &&
            debugSetBreakpoint(props.connectionId, debugSessionId()!, currentFuncOid(), line).catch(() => {});
        }
        setBreakpoints(bp);
      }
    });

    onCleanup(() => {
      unsub();
      editor?.dispose();
    });
  });

  createEffect(() => {
    const src = source();
    if (editor && src) {
      const model = editor.getModel();
      if (model && model.getValue() !== src) model.setValue(src);
    }
  });

  createEffect(() => {
    const line = currentLine();
    if (editor) {
      lastDecoIds = editor.deltaDecorations(
        lastDecoIds,
        line > 0 ? [{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: "debug-current-line" } }] : []
      );
    }
  });

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        "flex-direction": "column",
        "background-color": vscode.editorBg,
      }}
    >
      <style>{`
        .debug-current-line { background-color: rgba(38, 79, 120, 0.5); }
      `}</style>

      {/* 参数输入弹窗 */}
      <Show when={showParamDialog()}>
        <div
          style={{
            position: "fixed",
            inset: 0,
            "background-color": "rgba(0,0,0,0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": 1000,
          }}
          onClick={() => setShowParamDialog(false)}
        >
          <div
            style={{
              "background-color": vscode.sidebarBg,
              border: `1px solid ${vscode.border}`,
              padding: "24px",
              "min-width": "360px",
              "max-width": "90vw",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", color: vscode.foreground }}>
              调试函数: {props.funcSchema}.{props.funcName}
            </h3>
            <Show when={available() === false}>
              <div style={{ color: vscode.error, "margin-bottom": "12px" }}>
                pldebugger 不可用。请在 PostgreSQL 中执行：
                <pre style={{ "font-size": "12px", "margin-top": "8px", padding: "8px", "background-color": vscode.inputBg }}>
                  shared_preload_libraries = '$libdir/plugin_debugger'
                  -- 重启后:
                  CREATE EXTENSION pldbgapi;
                </pre>
              </div>
            </Show>
            <Show when={props.funcArgs}>
              <div style={{ "margin-bottom": "12px", color: vscode.foregroundDim, "font-size": "12px" }}>
                参数（按顺序，如 1, 'hello', NULL）：
              </div>
              <For each={argsHint()}>
                {(argName, i) => (
                  <div style={{ "margin-bottom": "8px" }}>
                    <label style={{ display: "block", "font-size": "12px", "margin-bottom": "4px", color: vscode.foreground }}>
                      {argName}
                    </label>
                    <input
                      type="text"
                      value={paramValues()[i()] ?? ""}
                      onInput={(e) => {
                        const v = [...paramValues()];
                        v[i()] = (e.target as HTMLInputElement).value;
                        setParamValues(v);
                      }}
                      placeholder="SQL 字面量，如 1 或 'text'"
                      style={{
                        width: "100%",
                        padding: "8px",
                        "background-color": vscode.inputBg,
                        border: `1px solid ${vscode.border}`,
                        color: vscode.inputFg,
                        "font-family": "monospace",
                      }}
                    />
                  </div>
                )}
              </For>
            </Show>
            <Show when={!argsHint().length}>
              <div style={{ color: vscode.foregroundDim, "margin-bottom": "12px" }}>此函数无参数</div>
            </Show>
            <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px", "margin-top": "16px" }}>
              <button
                onClick={() => {
                  setShowParamDialog(false);
                  props.onClose?.();
                }}
                style={{
                  padding: "8px 16px",
                  "background-color": vscode.buttonSecondary,
                  color: vscode.foreground,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                onClick={startDebug}
                disabled={starting() || available() !== true}
                style={{
                  padding: "8px 16px",
                  "background-color": vscode.buttonBg,
                  color: "#fff",
                  border: "none",
                  cursor: starting() || available() !== true ? "not-allowed" : "pointer",
                }}
              >
                {starting() ? "启动中..." : "开始调试"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* 工具栏 */}
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "8px 12px",
          "border-bottom": `1px solid ${vscode.border}`,
          "background-color": vscode.tabBarBg,
        }}
      >
        <button
          onClick={doContinue}
          disabled={!debugSessionId() || stepping()}
          title="继续 (F5)"
          style={btnStyle(!debugSessionId() || stepping())}
        >
          ▶ 继续
        </button>
        <button onClick={doStepOver} disabled={!debugSessionId() || stepping()} title="单步越过 (F10)" style={btnStyle(!debugSessionId() || stepping())}>
          ⤵ 单步越过
        </button>
        <button onClick={doStepInto} disabled={!debugSessionId() || stepping()} title="单步进入 (F11)" style={btnStyle(!debugSessionId() || stepping())}>
          ⤴ 单步进入
        </button>
        <button onClick={doAbort} disabled={!debugSessionId()} title="中止" style={{ ...btnStyle(!debugSessionId()), "background-color": vscode.error }}>
          ⏹ 中止
        </button>
        <span style={{ "margin-left": "auto", color: vscode.foregroundDim, "font-size": "12px" }}>
          {props.funcSchema}.{props.funcName} {debugSessionId() ? "· 第 " + currentLine() + " 行" : ""}
        </span>
        <Show when={props.onClose}>
          <button onClick={props.onClose} style={btnStyle(false)}>
            关闭
          </button>
        </Show>
      </div>

      <Show when={error()}>
        <div style={{ padding: "8px 12px", "background-color": "rgba(244,135,113,0.2)", color: vscode.error, "font-size": "13px" }}>
          {error()}
        </div>
      </Show>

      {/* 主内容区 */}
      <div style={{ flex: 1, display: "flex", "min-height": 0 }}>
        <div style={{ flex: 1, display: "flex", "flex-direction": "column", "min-width": 0 }}>
          <div style={{ padding: "4px 8px", "font-size": "12px", color: vscode.foregroundDim, "border-bottom": `1px solid ${vscode.border}` }}>
            源码
          </div>
          <div ref={editorContainer!} style={{ flex: 1, "min-height": 200 }} />
        </div>
        <div
          style={{
            width: "280px",
            "border-left": `1px solid ${vscode.border}`,
            display: "flex",
            "flex-direction": "column",
            "background-color": vscode.sidebarBg,
          }}
        >
          <div style={{ padding: "4px 8px", "font-size": "12px", color: vscode.foregroundDim, "border-bottom": `1px solid ${vscode.border}` }}>
            变量
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "8px", "font-size": "12px", "font-family": "monospace" }}>
            <For each={variables()}>
              {(v) => (
                <div style={{ "margin-bottom": "4px" }}>
                  <span style={{ color: vscode.foregroundDim }}>{v.name ?? v.varname}</span> ={" "}
                  <span style={{ color: vscode.foreground }}>{String(v.value ?? v.varvalue ?? "null")}</span>
                </div>
              )}
            </For>
            <Show when={variables().length === 0 && debugSessionId()}>
              <div style={{ color: vscode.foregroundDim }}>暂无变量</div>
            </Show>
          </div>
          <div style={{ padding: "4px 8px", "font-size": "12px", color: vscode.foregroundDim, "border-top": `1px solid ${vscode.border}` }}>
            调用栈
          </div>
          <div style={{ "max-height": "120px", overflow: "auto", padding: "8px", "font-size": "11px", "font-family": "monospace" }}>
            <For each={stack()}>
              {(s, i) => (
                <div style={{ "margin-bottom": "2px", color: vscode.foregroundDim }}>
                  #{i()} {s.funcname ?? s.function_name ?? JSON.stringify(s)}
                </div>
              )}
            </For>
          </div>
        </div>
      </div>
    </div>
  );
}

function btnStyle(disabled: boolean) {
  return {
    padding: "6px 12px",
    "font-size": "13px",
    "background-color": vscode.buttonBg,
    color: "#fff",
    border: "none" as const,
    cursor: disabled ? "not-allowed" as const : "pointer" as const,
    opacity: disabled ? 0.6 : 1,
  };
}
