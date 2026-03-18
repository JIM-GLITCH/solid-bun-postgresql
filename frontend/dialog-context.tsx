/**
 * 弹窗上下文：替代 alert/confirm/prompt，在 VSCode 插件中可用
 */

import { createContext, createSignal, useContext, onMount, type JSX } from "solid-js";
import { vscode } from "./theme";

export interface DialogContextValue {
  showAlert: (message: string, title?: string) => void;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  showPrompt: (message: string, title?: string, defaultValue?: string) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider(props: { children: JSX.Element }) {
  const [alertState, setAlertState] = createSignal<{ message: string; title?: string } | null>(null);
  const [confirmState, setConfirmState] = createSignal<{
    message: string;
    title?: string;
    resolve: (v: boolean) => void;
  } | null>(null);
  const [promptState, setPromptState] = createSignal<{
    message: string;
    title?: string;
    defaultValue?: string;
    resolve: (v: string | null) => void;
  } | null>(null);

  const showAlert = (message: string, title = "提示") => {
    setAlertState({ message, title });
  };

  const showConfirm = (message: string, title = "确认") =>
    new Promise<boolean>((resolve) => {
      setConfirmState({ message, title, resolve });
    });

  const showPrompt = (message: string, title = "输入", defaultValue = "") =>
    new Promise<string | null>((resolve) => {
      setPromptState({ message, title, defaultValue, resolve });
    });

  const value: DialogContextValue = { showAlert, showConfirm, showPrompt };

  return (
    <DialogContext.Provider value={value}>
      {props.children}
      {/* Alert 弹窗 */}
      {alertState() && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            "background-color": "rgba(0,0,0,0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": 10000,
          }}
          onClick={() => setAlertState(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              "background-color": vscode.sidebarBg,
              border: `1px solid ${vscode.border}`,
              "border-radius": "8px",
              "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
              "min-width": "320px",
              "max-width": "480px",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ "font-size": "16px", margin: "0 0 12px 0", color: vscode.foreground }}>
              {alertState()!.title}
            </h2>
            <p style={{ "font-size": "13px", color: vscode.foregroundDim, margin: "0 0 20px 0", "white-space": "pre-wrap" }}>
              {alertState()!.message}
            </p>
            <div style={{ display: "flex", "justify-content": "flex-end" }}>
              <button
                type="button"
                onClick={() => setAlertState(null)}
                style={{
                  padding: "8px 20px",
                  "font-size": "13px",
                  "background-color": vscode.buttonBg,
                  color: "#fff",
                  border: "none",
                  "border-radius": "4px",
                  cursor: "pointer",
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Confirm 弹窗 */}
      {confirmState() && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            "background-color": "rgba(0,0,0,0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": 10000,
          }}
          onClick={() => {
            confirmState()?.resolve(false);
            setConfirmState(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              "background-color": vscode.sidebarBg,
              border: `1px solid ${vscode.border}`,
              "border-radius": "8px",
              "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
              "min-width": "320px",
              "max-width": "480px",
              padding: "24px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ "font-size": "16px", margin: "0 0 12px 0", color: vscode.foreground }}>
              {confirmState()!.title}
            </h2>
            <p style={{ "font-size": "13px", color: vscode.foregroundDim, margin: "0 0 20px 0", "white-space": "pre-wrap" }}>
              {confirmState()!.message}
            </p>
            <div style={{ display: "flex", "justify-content": "flex-end", gap: "12px" }}>
              <button
                type="button"
                onClick={() => {
                  confirmState()?.resolve(false);
                  setConfirmState(null);
                }}
                style={{
                  padding: "8px 20px",
                  "font-size": "13px",
                  "background-color": vscode.buttonSecondary,
                  color: vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  cursor: "pointer",
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmState()?.resolve(true);
                  setConfirmState(null);
                }}
                style={{
                  padding: "8px 20px",
                  "font-size": "13px",
                  "background-color": vscode.buttonBg,
                  color: "#fff",
                  border: "none",
                  "border-radius": "4px",
                  cursor: "pointer",
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Prompt 弹窗 */}
      {promptState() && (
        <PromptModal
          message={promptState()!.message}
          title={promptState()!.title}
          defaultValue={promptState()!.defaultValue}
          onConfirm={(v) => {
            promptState()?.resolve(v);
            setPromptState(null);
          }}
          onCancel={() => {
            promptState()?.resolve(null);
            setPromptState(null);
          }}
        />
      )}
    </DialogContext.Provider>
  );
}

function PromptModal(props: {
  message: string;
  title?: string;
  defaultValue?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = createSignal(props.defaultValue ?? "");
  let inputRef: HTMLInputElement | undefined;

  onMount(() => inputRef?.focus());

  const handleConfirm = () => {
    props.onConfirm(value().trim());
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        "background-color": "rgba(0,0,0,0.5)",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        "z-index": 10000,
      }}
      onClick={props.onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{
          "background-color": vscode.sidebarBg,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
          "min-width": "320px",
          "max-width": "480px",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ "font-size": "16px", margin: "0 0 12px 0", color: vscode.foreground }}>
          {props.title}
        </h2>
        <p style={{ "font-size": "13px", color: vscode.foregroundDim, margin: "0 0 12px 0", "white-space": "pre-wrap" }}>
          {props.message}
        </p>
        <input
          ref={(el) => (inputRef = el)}
          type="text"
          value={value()}
          onInput={(e) => setValue(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") props.onCancel();
          }}
          aria-label={props.message}
          placeholder={props.message}
          style={{
            width: "100%",
            "box-sizing": "border-box",
            padding: "8px 12px",
            "font-size": "13px",
            "background-color": vscode.inputBg,
            color: vscode.inputFg,
            border: `1px solid ${vscode.border}`,
            "border-radius": "4px",
            "margin-bottom": "20px",
          }}
        />
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "12px" }}>
          <button
            type="button"
            onClick={props.onCancel}
            style={{
              padding: "8px 20px",
              "font-size": "13px",
              "background-color": vscode.buttonSecondary,
              color: vscode.foreground,
              border: "none",
              "border-radius": "4px",
              cursor: "pointer",
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            style={{
              padding: "8px 20px",
              "font-size": "13px",
              "background-color": vscode.buttonBg,
              color: "#fff",
              border: "none",
              "border-radius": "4px",
              cursor: "pointer",
            }}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within DialogProvider");
  return ctx;
}
