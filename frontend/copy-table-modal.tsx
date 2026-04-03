/**
 * 复制表 - 弹窗
 */

import { createSignal, Show } from "solid-js";
import { executeDdl } from "./api";
import { getRegisteredDbType } from "./db-session-meta";
import { isMysqlFamily, isSqlServer } from "../shared/src";
import { mysqlBacktickIdent, pgQuoteIdent, sqlBracketIdent } from "./sql-ddl-quote";
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
      const kind = getRegisteredDbType(props.connectionId);
      if (isMysqlFamily(kind)) {
        const db = mysqlBacktickIdent(props.schema);
        const oldT = mysqlBacktickIdent(props.table);
        const newT = mysqlBacktickIdent(name);
        await executeDdl(props.connectionId, `CREATE TABLE ${db}.${newT} LIKE ${db}.${oldT};`);
        if (copyData()) {
          await executeDdl(props.connectionId, `INSERT INTO ${db}.${newT} SELECT * FROM ${db}.${oldT};`);
        }
      } else if (isSqlServer(kind)) {
        const s = sqlBracketIdent(props.schema);
        const oldT = sqlBracketIdent(props.table);
        const newT = sqlBracketIdent(name);
        if (copyData()) {
          await executeDdl(props.connectionId, `SELECT * INTO ${s}.${newT} FROM ${s}.${oldT};`);
        } else {
          await executeDdl(
            props.connectionId,
            `SELECT TOP (0) * INTO ${s}.${newT} FROM ${s}.${oldT};`
          );
        }
      } else {
        const s = pgQuoteIdent(props.schema);
        const oldT = pgQuoteIdent(props.table);
        const newT = pgQuoteIdent(name);
        await executeDdl(props.connectionId, `CREATE TABLE ${s}.${newT} (LIKE ${s}.${oldT} INCLUDING ALL);`);
        if (copyData()) {
          await executeDdl(props.connectionId, `INSERT INTO ${s}.${newT} SELECT * FROM ${s}.${oldT};`);
        }
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
