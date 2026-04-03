/**
 * 新建 Schema（PostgreSQL）或数据库（MySQL）
 */

import { createSignal, Show } from "solid-js";
import { executeDdl } from "./api";
import { getRegisteredDbType } from "./db-session-meta";
import { isMysqlFamily } from "../shared/src";
import { vscode } from "./theme";

export interface CreateSchemaModalProps {
  connectionId: string;
  onClose: () => void;
  onSuccess: (connectionId: string) => void;
}

function validateName(connectionId: string, raw: string): string | null {
  const s = raw.trim();
  if (!s) return "名称不能为空";
  if (!/^[a-zA-Z0-9_]+$/.test(s)) return "仅允许字母、数字与下划线";
  const lower = s.toLowerCase();
  const kind = getRegisteredDbType(connectionId);
  if (isMysqlFamily(kind)) {
    const blocked = new Set(["information_schema", "mysql", "performance_schema", "sys"]);
    if (blocked.has(lower)) return "该名称为系统库，不可新建同名";
  } else {
    if (lower === "information_schema" || lower === "pg_catalog" || lower.startsWith("pg_")) {
      return "该名称为系统或保留名，请换名";
    }
  }
  return null;
}

function pgQuoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function mysqlBacktickIdent(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}

export default function CreateSchemaModal(props: CreateSchemaModalProps) {
  const [name, setName] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const kind = () => getRegisteredDbType(props.connectionId);
  const title = () => (isMysqlFamily(kind()) ? "新建数据库" : "新建 Schema");
  const hint = () =>
    isMysqlFamily(kind())
      ? "将执行 CREATE DATABASE（MySQL/MariaDB 中「库」同义）。"
      : "将执行 CREATE SCHEMA。";

  const handleSubmit = async () => {
    const n = name();
    const err = validateName(props.connectionId, n);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const sql =
        isMysqlFamily(kind())
          ? `CREATE DATABASE ${mysqlBacktickIdent(n)};`
          : `CREATE SCHEMA ${pgQuoteIdent(n)};`;
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
          "min-width": "400px",
          padding: "24px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ "font-size": "16px", margin: "0 0 8px 0", color: vscode.foreground }}>{title()}</h2>
        <p style={{ "font-size": "12px", color: vscode.foregroundDim, margin: "0 0 16px 0" }}>{hint()}</p>
        <label style={{ display: "block", "font-size": "13px", color: vscode.foreground, marginBottom: "8px" }}>
          名称
        </label>
        <input
          type="text"
          value={name()}
          onInput={(e) => {
            setName(e.currentTarget.value);
            setError(null);
          }}
          placeholder="例如 my_app"
          autoFocus
          style={{
            width: "100%",
            padding: "8px 12px",
            "margin-bottom": "12px",
            "background-color": vscode.inputBg,
            color: vscode.foreground,
            border: `1px solid ${vscode.border}`,
            "border-radius": "6px",
            "font-size": "13px",
            "font-family": "'JetBrains Mono', monospace",
            "box-sizing": "border-box",
          }}
        />
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
            onClick={() => void handleSubmit()}
            disabled={saving()}
            style={{
              padding: "8px 16px",
              "background-color": vscode.buttonBg,
              color: "#fff",
              border: "none",
              "border-radius": "6px",
              cursor: saving() ? "wait" : "pointer",
              "font-size": "13px",
            }}
          >
            {saving() ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
