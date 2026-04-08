/**
 * 弹窗上下文：替代 alert/confirm/prompt，并托管 JSONB 编辑器、改表名等全屏模态（与 App 同级 DOM，避免点穿）
 */

import { createContext, createSignal, useContext, onMount, onCleanup, type JSX } from "solid-js";
import { vscode, MODAL_Z_DIALOG_OVERLAY } from "./theme";
import { JSONB_Editor } from "./jsonb-editor";
import RenameTableModal from "./rename-table-modal";
import { SUBSCRIPTION_REQUIRED_EVENT } from "./subscription/subscription-prompt";
import { openSubscriptionPortalForCurrentEnvironment } from "./subscription/portal";
import { getInjectedDesktopHost } from "./desktop-host-context";

export interface OpenJsonbEditorOptions {
  initialValue: string | null;
  isReadOnly: boolean;
  onSave: (value: string | null) => void;
}

export interface OpenRenameTableOptions {
  connectionId: string;
  schema: string;
  table: string;
  onSuccess: (connectionId: string, schema: string) => void;
}

export interface DialogContextValue {
  showAlert: (message: string, title?: string) => void;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  showPrompt: (message: string, title?: string, defaultValue?: string) => Promise<string | null>;
  openJsonbEditor: (opts: OpenJsonbEditorOptions) => void;
  openRenameTable: (opts: OpenRenameTableOptions) => void;
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

  const [jsonbEditorState, setJsonbEditorState] = createSignal<OpenJsonbEditorOptions | null>(null);
  const [renameTableState, setRenameTableState] = createSignal<OpenRenameTableOptions | null>(null);
  const [subscriptionRequiredState, setSubscriptionRequiredState] = createSignal<{ message: string } | null>(null);

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

  const openJsonbEditor = (opts: OpenJsonbEditorOptions) => {
    setRenameTableState(null);
    setJsonbEditorState(opts);
  };

  const openRenameTable = (opts: OpenRenameTableOptions) => {
    setJsonbEditorState(null);
    setRenameTableState(opts);
  };

  const value: DialogContextValue = {
    showAlert,
    showConfirm,
    showPrompt,
    openJsonbEditor,
    openRenameTable,
  };

  onMount(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ message?: string }>;
      const msg = (ce.detail?.message ?? "").trim() || "该功能需要有效订阅。";
      setSubscriptionRequiredState({ message: msg });
    };
    window.addEventListener(SUBSCRIPTION_REQUIRED_EVENT, handler);
    onCleanup(() => window.removeEventListener(SUBSCRIPTION_REQUIRED_EVENT, handler));
  });

  return (
    <DialogContext.Provider value={value}>
      {props.children}
      {/* 订阅提示：HTTP / VS Code Webview 共用 */}
      {subscriptionRequiredState() && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            "background-color": "rgba(0,0,0,0.5)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            "z-index": MODAL_Z_DIALOG_OVERLAY,
          }}
          onClick={() => setSubscriptionRequiredState(null)}
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
              "z-index": 1,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ "font-size": "16px", margin: "0 0 12px 0", color: vscode.foreground }}>需要订阅</h2>
            <p
              style={{
                "font-size": "13px",
                color: vscode.foregroundDim,
                margin: "0 0 12px 0",
                "white-space": "pre-wrap",
              }}
            >
              {subscriptionRequiredState()!.message}
            </p>
            {(() => {
              const h = getInjectedDesktopHost();
              if (!h) return null;
              return (
                <p
                  style={{
                    "font-size": "12px",
                    color: vscode.foregroundDim,
                    margin: "0 0 20px 0",
                    opacity: 0.92,
                    "line-height": 1.45,
                  }}
                >
                  当前在 <strong style={{ color: vscode.foreground }}>{h.displayName}</strong>{" "}
                  中使用。在浏览器完成登录/订阅后，请用订阅页的「返回 {h.displayName}
                  并授权」将令牌写回编辑器；或直接点击上方「前往订阅站」。
                </p>
              );
            })()}
            <div style={{ display: "flex", "justify-content": "flex-end", gap: "12px", "flex-wrap": "wrap" }}>
              <button
                type="button"
                onClick={() => setSubscriptionRequiredState(null)}
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
                关闭
              </button>
              <button
                type="button"
                onClick={() => {
                  setSubscriptionRequiredState(null);
                  openSubscriptionPortalForCurrentEnvironment();
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
                前往订阅站
              </button>
            </div>
          </div>
        </div>
      )}
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
            "z-index": MODAL_Z_DIALOG_OVERLAY,
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
              "z-index": 1,
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
            "z-index": MODAL_Z_DIALOG_OVERLAY,
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
              "z-index": 1,
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
      {/* 改表名：与 App 同级，最后挂载的阻塞层在最上 */}
      {renameTableState() && (
        <RenameTableModal
          connectionId={renameTableState()!.connectionId}
          schema={renameTableState()!.schema}
          table={renameTableState()!.table}
          onClose={() => setRenameTableState(null)}
          onSuccess={(connectionId, schema) => {
            const st = renameTableState();
            setRenameTableState(null);
            st?.onSuccess(connectionId, schema);
          }}
        />
      )}
      {jsonbEditorState() && (
        <JSONB_Editor
          initialValue={jsonbEditorState()!.initialValue}
          isReadOnly={jsonbEditorState()!.isReadOnly}
          onSave={(v) => {
            const st = jsonbEditorState();
            setJsonbEditorState(null);
            st?.onSave(v);
          }}
          onClose={() => setJsonbEditorState(null)}
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
        "z-index": MODAL_Z_DIALOG_OVERLAY,
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
          "z-index": 1,
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
