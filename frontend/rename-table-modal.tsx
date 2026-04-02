/**
 * 修改表名 - 弹窗
 */

import { createSignal, Show } from "solid-js";
import { executeDdl } from "./api";
import { getRegisteredDbType } from "./db-session-meta";
import { mysqlBacktickIdent, pgQuoteIdent } from "./sql-ddl-quote";
import { vscode, MODAL_Z_FULLSCREEN } from "./theme";

export interface RenameTableModalProps {
  connectionId: string;
  schema: string;
  table: string;
  onClose: () => void;
  onSuccess: (connectionId: string, schema: string) => void;
}

export default function RenameTableModal(props: RenameTableModalProps) {
  const [newName, setNewName] = createSignal(props.table);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const name = newName().trim();
    if (!name || name === props.table) {
      setError("请输入新表名");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const kind = getRegisteredDbType(props.connectionId);
      if (kind === "mysql") {
        const db = mysqlBacktickIdent(props.schema);
        const oldT = mysqlBacktickIdent(props.table);
        const newT = mysqlBacktickIdent(name);
        await executeDdl(props.connectionId, `RENAME TABLE ${db}.${oldT} TO ${db}.${newT};`);
      } else {
        await executeDdl(
          props.connectionId,
          `ALTER TABLE ${pgQuoteIdent(props.schema)}.${pgQuoteIdent(props.table)} RENAME TO ${pgQuoteIdent(name)};`
        );
      }
      props.onSuccess(props.connectionId, props.schema);
      props.onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
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
        "z-index": MODAL_Z_FULLSCREEN,
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-modal-title"
        style={{
          "background-color": vscode.sidebarBg,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
          "min-width": "360px",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="rename-modal-title" style={{ "font-size": "16px", margin: "0 0 20px 0", color: vscode.foreground }}>
          修改表名
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ "margin-bottom": "16px" }}>
            <label style={{ display: "block", "font-size": "13px", color: vscode.foregroundDim, "margin-bottom": "6px" }}>
              当前表名
            </label>
            <div
              style={{
                padding: "8px 12px",
                "background-color": vscode.inputBg,
                color: vscode.foregroundDim,
                "border-radius": "4px",
                "font-family": "'JetBrains Mono', monospace",
                "font-size": "13px",
              }}
            >
              {props.schema}.{props.table}
            </div>
          </div>
          <div style={{ "margin-bottom": "16px" }}>
            <label style={{ display: "block", "font-size": "13px", color: vscode.foreground, "margin-bottom": "6px" }} htmlFor="rename-new-name">
              新表名
            </label>
            <input
              id="rename-new-name"
              type="text"
              value={newName()}
              onInput={(e) => {
                setNewName(e.currentTarget.value);
                setError(null);
              }}
              placeholder="new_table_name"
              style={{
                width: "100%",
                "box-sizing": "border-box",
                padding: "8px 12px",
                "background-color": vscode.inputBg,
                color: vscode.inputFg,
                border: `1px solid ${vscode.inputBorder}`,
                "border-radius": "4px",
                "font-family": "'JetBrains Mono', monospace",
                "font-size": "13px",
              }}
            />
          </div>
          <Show when={error()}>
            <div style={{ "margin-bottom": "16px", padding: "8px 12px", "background-color": "rgba(244,67,54,0.2)", color: vscode.error, "border-radius": "4px", "font-size": "13px" }}>
              {error()}
            </div>
          </Show>
          <div style={{ display: "flex", "justify-content": "flex-end", gap: "12px" }}>
            <button
              type="button"
              onClick={props.onClose}
              style={{
                padding: "8px 16px",
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
              type="submit"
              disabled={saving()}
              style={{
                padding: "8px 16px",
                "font-size": "13px",
                "background-color": vscode.buttonBg,
                color: "#fff",
                border: "none",
                "border-radius": "4px",
                cursor: saving() ? "not-allowed" : "pointer",
              }}
            >
              {saving() ? "执行中..." : "确定"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
