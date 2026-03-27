/**
 * PostgreSQL：当前库已安装扩展（名称、版本、简要说明）
 */
import { For, Show, createSignal, onMount } from "solid-js";
import { getInstalledExtensions } from "./api";
import { MODAL_Z_FULLSCREEN, vscode } from "./theme";

export interface ExtensionsModalProps {
  connectionId: string;
  onClose: () => void;
}

export default function ExtensionsModal(props: ExtensionsModalProps) {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [rows, setRows] = createSignal<
    Awaited<ReturnType<typeof getInstalledExtensions>>["extensions"]
  >([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getInstalledExtensions(props.connectionId);
      setRows(r.extensions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void load());

  return (
    <div
      onClick={props.onClose}
      style={{
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.5)",
        "z-index": MODAL_Z_FULLSCREEN,
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(960px, 96vw)",
          "max-height": "88vh",
          overflow: "auto",
          background: vscode.editorBg,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          padding: "14px 16px",
          display: "flex",
          "flex-direction": "column",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <div>
            <div style={{ "font-size": "15px", "font-weight": 600 }}>扩展管理</div>
            <div style={{ "font-size": "12px", color: vscode.foregroundDim, "margin-top": "4px" }}>
              当前数据库中已安装的扩展（来自 pg_extension / pg_available_extensions）
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading()}
              style={{
                background: vscode.buttonBg,
                color: vscode.foreground,
                border: "none",
                padding: "6px 12px",
                "border-radius": "6px",
                cursor: loading() ? "wait" : "pointer",
                "font-size": "12px",
              }}
            >
              {loading() ? "加载中…" : "刷新"}
            </button>
            <button
              type="button"
              onClick={props.onClose}
              style={{ background: "transparent", border: "none", color: vscode.foregroundDim, "font-size": "18px", cursor: "pointer" }}
            >
              ×
            </button>
          </div>
        </div>

        <Show when={error()}>
          <div style={{ color: "#f44336", "font-size": "13px" }}>{error()}</div>
        </Show>

        <div style={{ overflow: "auto", border: `1px solid ${vscode.border}`, "border-radius": "6px" }}>
          <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "12px" }}>
            <thead>
              <tr>
                <th style={th()}>扩展名</th>
                <th style={th()}>安装版本</th>
                <th style={th()}>默认版本</th>
                <th style={th()}>Schema</th>
                <th style={th()}>可迁移</th>
                <th style={th()}>说明</th>
              </tr>
            </thead>
            <tbody>
              <Show when={loading()}>
                <tr>
                  <td colSpan={6} style={{ ...td(), color: vscode.foregroundDim, "text-align": "center" }}>
                    加载中…
                  </td>
                </tr>
              </Show>
              <Show when={!loading() && rows().length === 0}>
                <tr>
                  <td colSpan={6} style={{ ...td(), color: vscode.foregroundDim, "text-align": "center", padding: "20px" }}>
                    未查询到已安装扩展
                  </td>
                </tr>
              </Show>
              <Show when={!loading() && rows().length > 0}>
                <For each={rows()}>
                  {(ex) => (
                    <tr>
                      <td style={td()}>{ex.name}</td>
                      <td style={tdMono()}>{ex.installedVersion}</td>
                      <td style={tdMono()}>{ex.defaultVersion ?? "—"}</td>
                      <td style={tdMono()}>{ex.schema}</td>
                      <td style={td()}>{ex.relocatable ? "是" : "否"}</td>
                      <td style={{ ...td(), "max-width": "360px", "white-space": "pre-wrap", "word-break": "break-word" }}>
                        {ex.description ?? "—"}
                      </td>
                    </tr>
                  )}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function th(): Record<string, string | number> {
  return {
    padding: "8px",
    "text-align": "left",
    background: vscode.sidebarBg,
    borderBottom: `1px solid ${vscode.border}`,
    "font-weight": 600,
  };
}

function td(): Record<string, string | number> {
  return { padding: "8px", borderBottom: `1px solid ${vscode.border}`, color: vscode.foreground };
}

function tdMono(): Record<string, string | number> {
  return { ...td(), "font-family": "Consolas, ui-monospace, monospace" };
}
