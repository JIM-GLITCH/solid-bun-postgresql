/**
 * JSONB 编辑器：仅 Monaco JSON 模式。
 */
import { createSignal, Show, onCleanup, onMount } from "solid-js";
import { serializeCompact, serializePretty, parseJsonSafe, jsonNodesEqual } from "./jsonb-editor-model";
import { vscode, MODAL_Z_FULLSCREEN } from "./theme";
import JsonbMonacoJson from "./jsonb-codemirror-json";

export interface JsonbEditorProps {
  initialValue: string | null;
  isReadOnly: boolean;
  onSave: (value: string | null) => void;
  onClose: () => void;
}

export function JSONB_Editor(props: JsonbEditorProps) {
  let modalPanelEl: HTMLDivElement | undefined;
  let formatCodeRef: (() => Promise<void>) | null = null;

  const parseResult = parseJsonSafe(props.initialValue);
  const initialParseError = parseResult.ok ? null : parseResult.error;

  const [rawText, setRawText] = createSignal(
    parseResult.ok ? serializePretty(parseResult.node) : (props.initialValue ?? "")
  );
  const [rawError, setRawError] = createSignal<string | null>(initialParseError);
  const [codeMonacoError, setCodeMonacoError] = createSignal(false);

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      props.onClose();
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    queueMicrotask(() => modalPanelEl?.focus());
  });
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  function handleCodeChange(text: string) {
    setRawText(text);
    const result = parseJsonSafe(text);
    setRawError(result.ok ? null : result.error);
  }

  async function handleCodeFormat() {
    try {
      await formatCodeRef?.();
    } catch {
      /* */
    }
    queueMicrotask(() => {
      const result = parseJsonSafe(rawText());
      if (result.ok) {
        setRawText(serializePretty(result.node));
        setRawError(null);
      }
    });
  }

  function handleConfirm() {
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && modalPanelEl?.contains(ae)) ae.blur();

    window.setTimeout(() => {
      const result = parseJsonSafe(rawText());
      if (!result.ok) {
        setRawError(result.error);
        return;
      }
      const originalResult = parseJsonSafe(props.initialValue);
      if (originalResult.ok && jsonNodesEqual(result.node, originalResult.node)) {
        props.onClose();
        return;
      }
      props.onSave(serializeCompact(result.node));
    }, 0);
  }

  const confirmDisabled = () => codeMonacoError() || rawError() !== null;

  return (
    <>
      <div
        data-jsonb-editor-root
        style={{
          position: "fixed",
          inset: "0",
          width: "100vw",
          height: "100vh",
          background: "rgba(0,0,0,0.5)",
          "z-index": MODAL_Z_FULLSCREEN,
          isolation: "isolate",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          "pointer-events": "auto",
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) props.onClose();
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          ref={(el) => {
            modalPanelEl = el;
          }}
          tabIndex={-1}
          style={{
            width: "700px",
            "max-height": "80vh",
            background: vscode.editorBg,
            border: `1px solid ${vscode.border}`,
            "border-radius": "6px",
            display: "flex",
            "flex-direction": "column",
            "box-shadow": "0 8px 32px rgba(0,0,0,0.6)",
            outline: "none",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <div
            style={{
              padding: "12px 16px",
              "border-bottom": `1px solid ${vscode.border}`,
              color: vscode.foreground,
              "font-size": "14px",
              "font-weight": "600",
            }}
          >
            {props.isReadOnly ? "查看 JSON" : "编辑 JSON"}
          </div>

          <div style={{ flex: "1", overflow: "auto", padding: "12px 16px", "min-height": "0" }}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px", height: "100%" }}>
              <JsonbMonacoJson
                initialValue={rawText()}
                isReadOnly={props.isReadOnly}
                onChange={handleCodeChange}
                onValidationChange={setCodeMonacoError}
                onEditorReady={(api: { format: () => Promise<void> }) => {
                  formatCodeRef = api.format;
                }}
              />
              <Show when={!props.isReadOnly}>
                <button
                  type="button"
                  onClick={handleCodeFormat}
                  style={{
                    "align-self": "flex-start",
                    background: vscode.buttonSecondary,
                    color: vscode.foreground,
                    border: "none",
                    "border-radius": "4px",
                    padding: "4px 12px",
                    cursor: "pointer",
                    "font-size": "12px",
                  }}
                >
                  格式化
                </button>
              </Show>
            </div>
          </div>

          <div
            style={{
              padding: "10px 16px",
              "border-top": `1px solid ${vscode.border}`,
              display: "flex",
              "justify-content": "flex-end",
              gap: "8px",
            }}
          >
            <Show
              when={!props.isReadOnly}
              fallback={
                <button
                  onClick={props.onClose}
                  style={{
                    background: vscode.buttonSecondary,
                    color: vscode.foreground,
                    border: "none",
                    "border-radius": "4px",
                    padding: "6px 16px",
                    cursor: "pointer",
                    "font-size": "13px",
                  }}
                >
                  关闭
                </button>
              }
            >
              <button
                onClick={props.onClose}
                style={{
                  background: vscode.buttonSecondary,
                  color: vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  padding: "6px 16px",
                  cursor: "pointer",
                  "font-size": "13px",
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmDisabled()}
                style={{
                  background: confirmDisabled() ? vscode.buttonSecondary : vscode.buttonBg,
                  color: confirmDisabled() ? vscode.foregroundDim : vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  padding: "6px 16px",
                  cursor: confirmDisabled() ? "not-allowed" : "pointer",
                  "font-size": "13px",
                }}
              >
                确认
              </button>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}
