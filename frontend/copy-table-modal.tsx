/**
 * 复制表 - 弹窗
 */

import { createSignal, Show } from "solid-js";
import { executeDdl } from "./api";
import { vscode } from "./theme";

export interface CopyTableModalProps {
  connectionId: string;
  schema: string;
  table: string;
  onClose: () => void;
  onSuccess: (connectionId: string, schema: string) => void;
}

export default function CopyTableModal(props: CopyTableModalProps) {
  const [newName, setNewName] = createSignal(props.table + "_copy");
  const [copyData, setCopyData] = createSignal(false);
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
      const schema = props.schema.replace(/"/g, '""');
      const oldTable = props.table.replace(/"/g, '""');
      const newTable = name.replace(/"/g, '""');
      const createSql = `CREATE TABLE "${schema}"."${newTable}" (LIKE "${schema}"."${oldTable}" INCLUDING ALL);`;
      await executeDdl(props.connectionId, createSql);
      if (copyData()) {
        const insertSql = `INSERT INTO "${schema}"."${newTable}" SELECT * FROM "${schema}"."${oldTable}";`;
        await executeDdl(props.connectionId, insertSql);
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
        "z-index": 2000,
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-modal-title"
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
        <h2 id="copy-modal-title" style={{ "font-size": "16px", margin: "0 0 20px 0", color: vscode.foreground }}>
          复制表
        </h2>
        <form onSubmit={handleSubmit}>
          <div style={{ "margin-bottom": "16px" }}>
            <label style={{ display: "block", "font-size": "13px", color: vscode.foregroundDim, "margin-bottom": "6px" }}>
              源表
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
            <label style={{ display: "block", "font-size": "13px", color: vscode.foreground, "margin-bottom": "6px" }} htmlFor="copy-new-name">
              新表名
            </label>
            <input
              id="copy-new-name"
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
          <div style={{ "margin-bottom": "16px", display: "flex", "align-items": "center", gap: "8px" }}>
            <input
              id="copy-data"
              type="checkbox"
              checked={copyData()}
              onInput={(e) => setCopyData(e.currentTarget.checked)}
            />
            <label htmlFor="copy-data" style={{ "font-size": "13px", color: vscode.foreground, cursor: "pointer" }}>
              同时复制数据
            </label>
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
