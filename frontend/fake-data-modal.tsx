/**
 * 假数据生成 - 按表结构生成测试数据并导入
 */

import { createSignal, createEffect, Show, For } from "solid-js";
import { getColumns, getPrimaryKeys, getUniqueConstraints, importRows } from "./api";
import { generateFakeData, isGeneratedStoredColumn, type TableColumn } from "./fake-data-generator";
import { vscode } from "./theme";

interface FakeDataModalProps {
  connectionId: string;
  schema: string;
  table: string;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

const ROW_COUNT_OPTIONS = [10, 50, 100, 500, 1000];

export default function FakeDataModal(props: FakeDataModalProps) {
  const [columns, setColumns] = createSignal<TableColumn[]>([]);
  const [uniqueColumns, setUniqueColumns] = createSignal<Set<string>>(new Set());
  const [rowCount, setRowCount] = createSignal(100);
  const [loading, setLoading] = createSignal(true);
  const [importing, setImporting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    const { connectionId, schema, table } = props;
    if (!connectionId || !schema || !table) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getColumns(connectionId, schema, table),
      getPrimaryKeys(connectionId, schema, table),
      getUniqueConstraints(connectionId, schema, table),
    ])
      .then(([colRes, pkRes, uqRes]) => {
        if (colRes.error) throw new Error(colRes.error);
        const raw = (colRes.columns || []) as TableColumn[];
        // MySQL 生成列 / PG 等不可写入列：跳过，否则 INSERT 失败
        setColumns(raw.filter((c) => !isGeneratedStoredColumn(c)));
        const set = new Set<string>();
        (pkRes.columns || []).forEach((c: string) => set.add(c));
        (uqRes.constraints || []).forEach((c: { columns: string[] }) => (c.columns || []).forEach((col: string) => set.add(col)));
        setUniqueColumns(set);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  });

  async function handleGenerate() {
    const cols = columns();
    if (!cols.length) {
      setError("表无可用列");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const rows = generateFakeData(cols, rowCount(), { uniqueColumns: uniqueColumns() });
      const columnNames = cols.map((c) => c.column_name);
      const res = await importRows(props.connectionId, props.schema, props.table, columnNames, rows, {
        onError: "rollback",
      });
      if (res.error) throw new Error(res.error);
      props.onSuccess?.(`已生成并导入 ${res.rowCount ?? rows.length} 行假数据`);
      props.onClose();
    } catch (e: any) {
      setError(e.message || "导入失败");
    } finally {
      setImporting(false);
    }
  }

  const colList = () => columns();

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
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px", "border-bottom": `1px solid ${vscode.border}` }}>
          <h2 style={{ margin: 0, "font-size": "18px", color: vscode.foreground }}>生成假数据</h2>
          <p style={{ margin: "8px 0 0 0", "font-size": "13px", color: vscode.foregroundDim }}>
            表 <code style={{ "font-family": "'JetBrains Mono', monospace" }}>{props.schema}.{props.table}</code>
          </p>
        </div>

        <div style={{ padding: "16px", display: "flex", "flex-direction": "column", gap: "16px" }}>
          <Show when={loading()}>
            <div style={{ color: vscode.foregroundDim, "font-size": "13px" }}>加载表结构...</div>
          </Show>

          <Show when={!loading() && colList().length === 0}>
            <div style={{ color: vscode.error, "font-size": "13px" }}>表无列或无法读取</div>
          </Show>

          <Show when={!loading() && colList().length > 0}>
            <div>
              <label style={{ display: "block", "margin-bottom": "6px", color: vscode.foreground }}>生成行数</label>
              <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
                <For each={ROW_COUNT_OPTIONS}>
                  {(n) => (
                    <button
                      type="button"
                      onClick={() => setRowCount(n)}
                      style={{
                        padding: "8px 14px",
                        "font-size": "13px",
                        "background-color": rowCount() === n ? vscode.accent : vscode.buttonSecondary,
                        color: rowCount() === n ? "#fff" : vscode.foreground,
                        border: "none",
                        "border-radius": "4px",
                        cursor: "pointer",
                      }}
                    >
                      {n} 行
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div>
              <label style={{ display: "block", "margin-bottom": "6px", color: vscode.foreground }}>列预览</label>
              <div
                style={{
                  "max-height": "160px",
                  overflow: "auto",
                  border: `1px solid ${vscode.border}`,
                  "border-radius": "4px",
                  "font-size": "12px",
                  "font-family": "'JetBrains Mono', monospace",
                }}
              >
                <table style={{ width: "100%", "border-collapse": "collapse" }}>
                  <thead>
                    <tr style={{ "background-color": vscode.tabBarBg }}>
                      <th style={{ padding: "6px 10px", "text-align": "left", border: `1px solid ${vscode.border}`, color: vscode.foreground }}>列名</th>
                      <th style={{ padding: "6px 10px", "text-align": "left", border: `1px solid ${vscode.border}`, color: vscode.foreground }}>类型</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={colList()}>
                      {(col) => (
                        <tr style={{ "border-bottom": `1px solid ${vscode.border}` }}>
                          <td style={{ padding: "6px 10px", border: `1px solid ${vscode.border}`, color: vscode.foreground }}>{col.column_name}</td>
                          <td style={{ padding: "6px 10px", border: `1px solid ${vscode.border}`, color: vscode.foregroundDim }}>{col.data_type}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
              <p style={{ "margin-top": "8px", "font-size": "12px", color: vscode.foregroundDim }}>
                将根据列名和类型自动生成：姓名、邮箱、日期、数字、UUID 等
              </p>
            </div>
          </Show>

          <Show when={error()}>
            <div style={{ color: vscode.error, "font-size": "13px" }}>{error()}</div>
          </Show>
        </div>

        <div style={{ padding: "12px 16px", "border-top": `1px solid ${vscode.border}`, display: "flex", "justify-content": "flex-end", gap: "8px" }}>
          <button
            type="button"
            onClick={props.onClose}
            style={{
              padding: "8px 16px",
              "font-size": "14px",
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
            onClick={handleGenerate}
            disabled={loading() || colList().length === 0 || importing()}
            style={{
              padding: "8px 16px",
              "font-size": "14px",
              "background-color": !loading() && colList().length > 0 && !importing() ? vscode.buttonBg : vscode.buttonSecondary,
              color: "#fff",
              border: "none",
              "border-radius": "4px",
              cursor: !loading() && colList().length > 0 && !importing() ? "pointer" : "not-allowed",
            }}
          >
            {importing() ? "生成并导入中…" : "生成并导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
