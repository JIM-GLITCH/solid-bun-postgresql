/**
 * 清空表 - 确认弹窗
 */

import { createSignal, Show } from "solid-js";
import { executeDdl } from "./api";
import { getRegisteredDbType } from "./db-session-meta";
import { qualifiedTableForDdl } from "./sql-ddl-quote";
import { vscode } from "./theme";

export interface TruncateTableModalProps {
  connectionId: string;
  schema: string;
  table: string;
  onClose: () => void;
  onSuccess: (connectionId: string, schema: string) => void;
}

export default function TruncateTableModal(props: TruncateTableModalProps) {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    try {
      const kind = getRegisteredDbType(props.connectionId);
      const q = qualifiedTableForDdl(kind, props.schema, props.table);
      await executeDdl(props.connectionId, `TRUNCATE TABLE ${q};`);
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
        "z-index": 2000,
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="truncate-modal-title"
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
        <h2 id="truncate-modal-title" style={{ "font-size": "16px", margin: "0 0 12px 0", color: vscode.warning }}>
          清空表
        </h2>
        <p style={{ "font-size": "13px", color: vscode.foreground, margin: "0 0 16px 0" }}>
          确定要清空表 <strong style={{ "font-family": "'JetBrains Mono', monospace" }}>{props.schema}.{props.table}</strong> 的所有数据吗？表结构保留，数据不可恢复。
        </p>
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
            type="button"
            onClick={handleConfirm}
            disabled={saving()}
            style={{
              padding: "8px 16px",
              "font-size": "13px",
              "background-color": vscode.warning,
              color: "#1e1e1e",
              border: "none",
              "border-radius": "4px",
              cursor: saving() ? "not-allowed" : "pointer",
            }}
          >
            {saving() ? "清空中..." : "清空"}
          </button>
        </div>
      </div>
    </div>
  );
}
