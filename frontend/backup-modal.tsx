/**
 * 数据库 / Schema 备份 - 导出 SQL dump
 */

import { createSignal, createEffect, Show } from "solid-js";
import { getSchemaDump, getDatabaseDump, saveFileViaVscode } from "./api";
import { vscode } from "./theme";

export interface BackupModalProps {
  connectionId: string;
  /** 指定 schema 则导出该 schema，否则导出全库 */
  schema?: string | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function BackupModal(props: BackupModalProps) {
  const [includeData, setIncludeData] = createSignal(false);
  const [loading, setLoading] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [dump, setDump] = createSignal<string>("");

  createEffect(() => {
    const { connectionId, schema } = props;
    if (!connectionId) return;
    setLoading(true);
    setError(null);
    setDump("");
    const withData = includeData();
    const fn = schema ? () => getSchemaDump(connectionId, schema, withData) : () => getDatabaseDump(connectionId, withData);
    fn()
      .then((res) => {
        if (res.error) throw new Error(res.error);
        setDump(res.dump ?? "");
      })
      .catch((e) => setError(e.message || "导出失败"))
      .finally(() => setLoading(false));
  });

  async function handleSave() {
    const content = dump();
    if (!content) return;
    const filename = props.schema ? `dump_${props.schema}.sql` : "dump_full.sql";
    setSaving(true);
    setError(null);
    try {
      const saved = await saveFileViaVscode(content, filename);
      if (saved) {
        props.onSuccess?.(`已保存: ${filename}`);
        props.onClose();
      }
    } catch {
      downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), filename);
      props.onSuccess?.(`已下载: ${filename}`);
      props.onClose();
    } finally {
      setSaving(false);
    }
  }

  const title = () => (props.schema ? `备份 Schema: ${props.schema}` : "备份全库");

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        "background-color": "rgba(0,0,0,0.6)",
        "z-index": 200,
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        padding: "20px",
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        style={{
          "background-color": vscode.sidebarBg,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          "min-width": "420px",
          "max-width": "90vw",
          "max-height": "85vh",
          overflow: "auto",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
          display: "flex",
          "flex-direction": "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px", "border-bottom": `1px solid ${vscode.border}` }}>
          <h2 style={{ margin: 0, "font-size": "18px", color: vscode.foreground }}>📦 {title()}</h2>
          <p style={{ margin: "8px 0 0 0", "font-size": "13px", color: vscode.foregroundDim }}>
            导出表、视图、函数等结构
          </p>
          <div style={{ marginTop: "12px", display: "flex", gap: "16px", "align-items": "center" }}>
            <label style={{ display: "flex", "align-items": "center", gap: "6px", cursor: "pointer", "font-size": "13px", color: vscode.foreground }}>
              <input
                type="radio"
                name="backup-mode"
                checked={!includeData()}
                onChange={() => setIncludeData(false)}
                style={{ accentColor: vscode.accent }}
              />
              仅结构
            </label>
            <label style={{ display: "flex", "align-items": "center", gap: "6px", cursor: "pointer", "font-size": "13px", color: vscode.foreground }}>
              <input
                type="radio"
                name="backup-mode"
                checked={includeData()}
                onChange={() => setIncludeData(true)}
                style={{ accentColor: vscode.accent }}
              />
              结构 + 数据
            </label>
          </div>
        </div>

        <div style={{ padding: "16px", flex: 1, overflow: "auto" }}>
          <Show when={loading()}>
            <div style={{ color: vscode.foregroundDim, "font-size": "13px" }}>正在生成 SQL dump...</div>
          </Show>

          <Show when={!loading() && error()}>
            <div style={{ color: vscode.error, "font-size": "13px" }}>{error()}</div>
          </Show>

          <Show when={!loading() && !error() && dump()}>
            <div
              style={{
                padding: "12px",
                "background-color": vscode.inputBg,
                border: `1px solid ${vscode.border}`,
                "border-radius": "6px",
                "font-size": "12px",
                "font-family": "'JetBrains Mono', monospace",
                color: vscode.foreground,
                "max-height": "200px",
                overflow: "auto",
                "white-space": "pre-wrap",
                "word-break": "break-all",
              }}
            >
              {dump().slice(0, 500)}
              {dump().length > 500 ? "\n\n... (已截断预览)" : ""}
            </div>
            <p style={{ margin: "8px 0 0 0", "font-size": "12px", color: vscode.foregroundDim }}>
              共 {dump().length.toLocaleString()} 字符
            </p>
          </Show>
        </div>

        <div style={{ padding: "16px", "border-top": `1px solid ${vscode.border}`, display: "flex", gap: "8px", "justify-content": "flex-end" }}>
          <button
            onClick={props.onClose}
            style={{
              padding: "8px 16px",
              "background-color": vscode.inputBg,
              border: `1px solid ${vscode.border}`,
              color: vscode.foreground,
              "border-radius": "6px",
              cursor: "pointer",
              "font-size": "13px",
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!dump() || saving()}
            style={{
              padding: "8px 16px",
              "background-color": dump() && !saving() ? vscode.accent : vscode.inputBg,
              border: "none",
              color: dump() && !saving() ? "#fff" : vscode.foregroundDim,
              "border-radius": "6px",
              cursor: dump() && !saving() ? "pointer" : "not-allowed",
              "font-size": "13px",
            }}
          >
            {saving() ? "保存中..." : "另存为 SQL 文件"}
          </button>
        </div>
      </div>
    </div>
  );
}
