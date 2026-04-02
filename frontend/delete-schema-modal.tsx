/**
 * 删除 Schema（PostgreSQL）或数据库（MySQL）
 */

import { createSignal, Show } from "solid-js";
import { executeDdl } from "./api";
import { getRegisteredDbType } from "./db-session-meta";
import { vscode } from "./theme";

export interface DeleteSchemaModalProps {
  connectionId: string;
  schema: string;
  onClose: () => void;
  onSuccess: (connectionId: string) => void;
}

function pgQuoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function mysqlBacktickIdent(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}

export function isSystemSchema(connectionId: string, schema: string): boolean {
  const lower = schema.toLowerCase();
  if (getRegisteredDbType(connectionId) === "mysql") {
    return ["information_schema", "mysql", "performance_schema", "sys"].includes(lower);
  }
  if (["pg_catalog", "information_schema"].includes(lower)) return true;
  if (lower.startsWith("pg_")) return true;
  return false;
}

export default function DeleteSchemaModal(props: DeleteSchemaModalProps) {
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const kind = () => getRegisteredDbType(props.connectionId);
  const title = () => (kind() === "mysql" ? "删除数据库" : "删除 Schema");
  const label = () => (kind() === "mysql" ? "数据库" : "Schema");

  const handleConfirm = async () => {
    if (isSystemSchema(props.connectionId, props.schema)) {
      setError("系统库不可删除");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sql =
        kind() === "mysql"
          ? `DROP DATABASE ${mysqlBacktickIdent(props.schema)};`
          : `DROP SCHEMA ${pgQuoteIdent(props.schema)} CASCADE;`;
      await executeDdl(props.connectionId, sql);
      props.onSuccess(props.connectionId);
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
        style={{
          "background-color": vscode.sidebarBg,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
          "min-width": "380px",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ "font-size": "16px", margin: "0 0 12px 0", color: vscode.error }}>{title()}</h2>
        <p style={{ "font-size": "13px", color: vscode.foreground, margin: "0 0 8px 0" }}>
          将永久删除{label()}{" "}
          <strong style={{ "font-family": "'JetBrains Mono', monospace" }}>{props.schema}</strong>
          {kind() === "postgres" ? "（CASCADE，依赖对象一并删除）" : ""}，不可恢复。
        </p>
        <Show when={error()}>
          <div
            style={{
              "margin-bottom": "16px",
              padding: "8px 12px",
              "background-color": "rgba(244,67,54,0.15)",
              color: vscode.error,
              "border-radius": "4px",
              "font-size": "13px",
            }}
          >
            {error()}
          </div>
        </Show>
        <div style={{ display: "flex", "justify-content": "flex-end", gap: "12px" }}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "8px 16px",
              "background-color": "transparent",
              color: vscode.foreground,
              border: `1px solid ${vscode.border}`,
              "border-radius": "6px",
              cursor: "pointer",
              "font-size": "13px",
            }}
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={saving()}
            style={{
              padding: "8px 16px",
              "background-color": vscode.error,
              color: "#fff",
              border: "none",
              "border-radius": "6px",
              cursor: saving() ? "wait" : "pointer",
              "font-size": "13px",
            }}
          >
            {saving() ? "删除中…" : "删除"}
          </button>
        </div>
      </div>
    </div>
  );
}
