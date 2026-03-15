/**
 * 导入 CSV/JSON/Excel 到表：选择文件 → 选择目标表 → 列映射 → 执行导入
 */

import { createSignal, createEffect, For, Show } from "solid-js";
import { getSchemas, getTables, getColumns, getPrimaryKeys, importRows, readFileViaVscode } from "./api";
import { parseImportFile, parseFromVscodeResult, type ParsedImport } from "./import-parse";
import { vscode } from "./theme";

interface ImportModalProps {
  connectionId: string | null;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

export default function ImportModal(props: ImportModalProps) {
  const [file, setFile] = createSignal<File | null>(null);
  const [vscodeFileName, setVscodeFileName] = createSignal<string>("");
  const [parsed, setParsed] = createSignal<ParsedImport | null>(null);
  const [schemas, setSchemas] = createSignal<string[]>([]);
  const [tables, setTables] = createSignal<string[]>([]);
  const [schema, setSchema] = createSignal("");
  const [table, setTable] = createSignal("");
  const [tableColumns, setTableColumns] = createSignal<TableColumn[]>([]);
  const [primaryKeys, setPrimaryKeys] = createSignal<string[]>([]);
  const [onConflict, setOnConflict] = createSignal<"nothing" | "update">("nothing");
  const [onError, setOnError] = createSignal<"rollback" | "discard">("rollback");
  /** 按源（文件）列：每项为 源索引、源名、目标表列名（空为跳过）、是否作为更新用的唯一约束 */
  const [mappingRows, setMappingRows] = createSignal<Array<{ sourceIndex: number; sourceName: string; targetColumn: string; isConflictKey: boolean }>>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [importing, setImporting] = createSignal(false);

  createEffect(() => {
    const cid = props.connectionId;
    if (!cid) return;
    setLoading(true);
    getSchemas(cid)
      .then((r) => {
        if (r.error) throw new Error(r.error);
        setSchemas(r.schemas || []);
        if (r.schemas?.length) setSchema(r.schemas[0]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  });

  createEffect(() => {
    const cid = props.connectionId;
    const s = schema();
    if (!cid || !s) {
      setTables([]);
      setTable("");
      return;
    }
    setLoading(true);
    getTables(cid, s)
      .then((r) => {
        if (r.error) throw new Error(r.error);
        const list = (r.tables || []).concat(r.views || []);
        setTables(list);
        setTable(list[0] || "");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  });

  createEffect(() => {
    const cid = props.connectionId;
    const s = schema();
    const t = table();
    if (!cid || !s || !t) {
      setTableColumns([]);
      setMappingRows([]);
      return;
    }
    Promise.all([getColumns(cid, s, t), getPrimaryKeys(cid, s, t)])
      .then(([colRes, pkRes]) => {
        if (colRes.error) throw new Error(colRes.error);
        const cols = (colRes.columns || []) as TableColumn[];
        setTableColumns(cols);
        setPrimaryKeys(pkRes.columns || []);
        const p = parsed();
        if (p?.headers.length) {
          applyMappingByName(cols, p.headers, pkRes.columns || []);
        } else {
          setMappingRows([]);
        }
      })
      .catch((e) => setError(e.message));
  });

  /** 按列名（不区分大小写）自动映射：每行源字段对应目标字段，主键列默认勾选为更新用唯一约束 */
  function applyMappingByName(cols: TableColumn[], headers: string[], pkCols: string[]) {
    const next = headers.map((sourceName, sourceIndex) => {
      const target = cols.find((c) => c.column_name.toLowerCase() === sourceName.toLowerCase());
      const targetColumn = target ? target.column_name : "";
      return {
        sourceIndex,
        sourceName,
        targetColumn,
        isConflictKey: !!targetColumn && pkCols.includes(targetColumn),
      };
    });
    setMappingRows(next);
  }

  // 切换文件或表后，有源与目标时按名称自动映射
  createEffect(() => {
    const p = parsed();
    const cols = tableColumns();
    const pk = primaryKeys();
    if (p?.headers?.length && cols.length) {
      const current = mappingRows();
      if (current.length !== p.headers.length || current.some((r, i) => r.sourceName !== p.headers[i])) {
        applyMappingByName(cols, p.headers, pk);
      }
    }
  });

  async function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    setFile(f);
    setVscodeFileName("");
    setError(null);
    const result = await parseImportFile(f);
    if (result.error) {
      setError(result.error);
      setParsed(null);
    } else {
      setParsed(result);
    }
  }

  async function handleChooseFile() {
    setError(null);
    try {
      const data = await readFileViaVscode({ accept: [".csv", ".json", ".xlsx", ".xls"] });
      if (!data) return;
      const result = parseFromVscodeResult(data);
      if (result.error) {
        setError(result.error);
        setParsed(null);
      } else {
        setParsed(result);
        setFile(null);
        setVscodeFileName(data.filename);
      }
    } catch {
      document.getElementById("import-file-input")?.click();
    }
  }

  function setTargetForSource(sourceIndex: number, targetColumn: string) {
    setMappingRows((prev) =>
      prev.map((r) =>
        r.sourceIndex === sourceIndex
          ? { ...r, targetColumn, isConflictKey: !!targetColumn && primaryKeys().includes(targetColumn) }
          : r
      )
    );
  }

  function toggleConflictKey(sourceIndex: number) {
    setMappingRows((prev) =>
      prev.map((r) => (r.sourceIndex === sourceIndex ? { ...r, isConflictKey: !r.isConflictKey } : r))
    );
  }

  /** 按行索引切换（避免 For 中 row 为 getter 时点击取不到正确 sourceIndex） */
  function toggleConflictKeyByIndex(rowIndex: number) {
    setMappingRows((prev) =>
      prev.map((r, i) => (i === rowIndex ? { ...r, isConflictKey: !r.isConflictKey } : r))
    );
  }

  const conflictColumns = () => {
    const cols = tableColumns();
    const rows = mappingRows();
    return cols.filter((tc) => rows.some((r) => r.targetColumn === tc.column_name && r.isConflictKey)).map((tc) => tc.column_name);
  };

  async function doImport() {
    const cid = props.connectionId;
    const p = parsed();
    const s = schema();
    const t = table();
    const cols = tableColumns();
    const rows = mappingRows();
    if (!cid || !p || !s || !t || cols.length === 0) return;

    const toInsert = cols.filter((tc) => rows.some((r) => r.targetColumn === tc.column_name));
    if (toInsert.length === 0) {
      setError("请至少映射一列");
      return;
    }

    const columns = toInsert.map((c) => c.column_name);
    const rowsData = p.rows.map((fileRow) =>
      toInsert.map((tc) => {
        const m = rows.find((r) => r.targetColumn === tc.column_name);
        return m != null ? fileRow[m.sourceIndex] ?? null : null;
      })
    );

    setImporting(true);
    setError(null);
    try {
      const conflictCols = conflictColumns();
      const res = await importRows(cid, s, t, columns, rowsData, {
        conflictColumns: conflictCols.length ? conflictCols : undefined,
        onConflict: conflictCols.length ? onConflict() : undefined,
        onError: onError(),
      });
      if (res.error) throw new Error(res.error);
      props.onSuccess?.(`已导入 ${res.rowCount ?? rowsData.length} 行`);
      props.onClose();
    } catch (e: any) {
      setError(e.message || "导入失败");
    } finally {
      setImporting(false);
    }
  }

  const parsedData = () => parsed();
  const hasData = () => parsedData() && parsedData()!.rows.length > 0;

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
          "min-width": "480px",
          "max-width": "90vw",
          "max-height": "85vh",
          overflow: "auto",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px", "border-bottom": `1px solid ${vscode.border}` }}>
          <h2 style={{ margin: 0, "font-size": "18px", color: vscode.foreground }}>导入数据 (CSV / JSON / Excel)</h2>
        </div>

        <div style={{ padding: "16px", display: "flex", "flex-direction": "column", gap: "16px" }}>
          <Show when={!props.connectionId}>
            <div style={{ color: vscode.error }}>请先连接数据库</div>
          </Show>

          <div>
            <label for="import-file-input" style={{ display: "block", "margin-bottom": "6px", color: vscode.foreground }}>选择文件</label>
            <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
              <button
                type="button"
                onClick={handleChooseFile}
                style={{
                  padding: "8px 16px",
                  "font-size": "14px",
                  "background-color": vscode.buttonBg,
                  color: "#fff",
                  border: "none",
                  "border-radius": "4px",
                  cursor: "pointer",
                }}
              >
                选择文件
              </button>
              <span style={{ color: vscode.foregroundDim, "font-size": "13px" }}>或</span>
              <input
                id="import-file-input"
                type="file"
                accept=".csv,.json,.xlsx,.xls,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                aria-label="选择 CSV、JSON 或 Excel 文件"
                onChange={handleFileChange}
                style={{
                  padding: "6px 8px",
                  "font-size": "13px",
                  "background-color": vscode.inputBg,
                  color: vscode.foreground,
                  border: `1px solid ${vscode.border}`,
                  "border-radius": "4px",
                  "flex": 1,
                }}
              />
            </div>
            <Show when={file() || vscodeFileName()}>
              <div style={{ "margin-top": "6px", color: vscode.foregroundDim, "font-size": "13px" }}>
                {file()?.name ?? vscodeFileName()}
                <Show when={parsedData()}>
                  {" "}
                  — {parsedData()!.headers.length} 列，{parsedData()!.rows.length} 行
                </Show>
              </div>
            </Show>
            <Show when={parsedData()?.error}>
              <div style={{ color: vscode.error, "font-size": "13px", "margin-top": "4px" }}>{parsedData()!.error}</div>
            </Show>
          </div>

          <Show when={props.connectionId && hasData()}>
            <div style={{ display: "flex", gap: "16px", "flex-wrap": "wrap" }}>
              <div style={{ flex: "1", "min-width": "140px" }}>
                <label style={{ display: "block", "margin-bottom": "6px", color: vscode.foreground }}>Schema</label>
                <select
                  value={schema()}
                  onChange={(e) => setSchema(e.currentTarget.value)}
                  disabled={loading()}
                  style={{
                    width: "100%",
                    padding: "8px",
                    "font-size": "14px",
                    "background-color": vscode.inputBg,
                    color: vscode.foreground,
                    border: `1px solid ${vscode.border}`,
                    "border-radius": "4px",
                  }}
                >
                  <For each={schemas()}>
                    {(s) => (
                      <option value={s}>
                        {s}
                      </option>
                    )}
                  </For>
                </select>
              </div>
              <div style={{ flex: "1", "min-width": "140px" }}>
                <label style={{ display: "block", "margin-bottom": "6px", color: vscode.foreground }}>表</label>
                <select
                  value={table()}
                  onChange={(e) => setTable(e.currentTarget.value)}
                  disabled={loading()}
                  style={{
                    width: "100%",
                    padding: "8px",
                    "font-size": "14px",
                    "background-color": vscode.inputBg,
                    color: vscode.foreground,
                    border: `1px solid ${vscode.border}`,
                    "border-radius": "4px",
                  }}
                >
                  <For each={tables()}>
                    {(t) => (
                      <option value={t}>
                        {t}
                      </option>
                    )}
                  </For>
                </select>
              </div>
            </div>

            <Show when={tableColumns().length > 0 && mappingRows().length > 0}>
              <div>
                <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "8px", "flex-wrap": "wrap", gap: "8px" }}>
                  <span style={{ color: vscode.foreground, "font-size": "13px" }}>列映射</span>
                  <button
                    type="button"
                    onClick={() => {
                      const p = parsedData();
                      if (p?.headers.length) applyMappingByName(tableColumns(), p.headers, primaryKeys());
                    }}
                    style={{
                      padding: "4px 10px",
                      "font-size": "12px",
                      "background-color": vscode.buttonSecondary,
                      color: vscode.foreground,
                      border: "none",
                      "border-radius": "4px",
                      cursor: "pointer",
                    }}
                  >
                    按名称自动映射
                  </button>
                </div>
                <div style={{ "max-height": "240px", overflow: "auto", border: `1px solid ${vscode.border}`, "border-radius": "4px" }}>
                  <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "13px" }}>
                    <thead>
                      <tr style={{ "background-color": vscode.tabBarBg }}>
                        <th style={{ padding: "8px 10px", "text-align": "left", border: `1px solid ${vscode.border}`, color: vscode.foreground }}>源字段</th>
                        <th style={{ padding: "8px 10px", "text-align": "left", border: `1px solid ${vscode.border}`, color: vscode.foreground }}>目标字段</th>
                        <th style={{ padding: "8px 10px", "text-align": "center", border: `1px solid ${vscode.border}`, color: vscode.foreground, width: "80px" }} title="勾选作为更新用的唯一约束">主键</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={mappingRows()}>
                        {(row, index) => (
                          <tr style={{ "border-bottom": `1px solid ${vscode.border}` }}>
                            <td style={{ padding: "6px 10px", border: `1px solid ${vscode.border}`, color: vscode.foreground }}>{row.sourceName}</td>
                            <td style={{ padding: "6px 10px", border: `1px solid ${vscode.border}` }}>
                              <select
                                title={`将源「${row.sourceName}」映射到目标字段`}
                                aria-label={`目标字段 ${row.sourceName}`}
                                value={row.targetColumn}
                                onChange={(e) => setTargetForSource(row.sourceIndex, e.currentTarget.value)}
                                style={{
                                  width: "100%",
                                  padding: "4px 8px",
                                  "font-size": "12px",
                                  "background-color": vscode.inputBg,
                                  color: vscode.foreground,
                                  border: `1px solid ${vscode.border}`,
                                  "border-radius": "4px",
                                }}
                              >
                                <option value="">— 跳过 —</option>
                                <For each={tableColumns()}>
                                  {(tc) => (
                                    <option value={tc.column_name}>
                                      {tc.column_name}
                                    </option>
                                  )}
                                </For>
                              </select>
                            </td>
                            <td
                              style={{
                                padding: "6px 10px",
                                border: `1px solid ${vscode.border}`,
                                "text-align": "center",
                                "vertical-align": "middle",
                              }}
                            >
                              <Show when={row.targetColumn}>
                                <button
                                  type="button"
                                  title={row.isConflictKey ? "作为更新用的唯一约束（点击取消）" : "勾选作为更新用的唯一约束"}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleConflictKeyByIndex(index());
                                  }}
                                  style={{
                                    display: "inline-flex",
                                    "align-items": "center",
                                    "justify-content": "center",
                                    width: "28px",
                                    height: "28px",
                                    padding: 0,
                                    border: "none",
                                    "border-radius": "4px",
                                    cursor: "pointer",
                                    "background-color": row.isConflictKey ? "rgba(212, 175, 55, 0.3)" : "transparent",
                                    color: row.isConflictKey ? "#d4af37" : vscode.foregroundDim,
                                    "font-size": "16px",
                                  }}
                                >
                                  {row.isConflictKey ? "🔑" : "○"}
                                </button>
                              </Show>
                              <Show when={!row.targetColumn}>
                                <span style={{ color: vscode.foregroundDim, "font-size": "12px" }}>—</span>
                              </Show>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
                <div style={{ "margin-top": "12px", display: "flex", "flex-direction": "column", gap: "8px", "font-size": "13px" }}>
                  <Show when={conflictColumns().length > 0}>
                    <div>
                      <span style={{ color: vscode.foreground }}>唯一约束冲突时：</span>
                      <label style={{ "margin-left": "12px", color: vscode.foreground, cursor: "pointer" }}>
                        <input type="radio" name="onConflict" checked={onConflict() === "nothing"} onChange={() => setOnConflict("nothing")} style={{ "margin-right": "6px" }} />
                        使用旧数据（保留已有行）
                      </label>
                      <label style={{ "margin-left": "12px", color: vscode.foreground, cursor: "pointer" }}>
                        <input type="radio" name="onConflict" checked={onConflict() === "update"} onChange={() => setOnConflict("update")} style={{ "margin-right": "6px" }} />
                        更新为新数据
                      </label>
                    </div>
                  </Show>
                  <div>
                    <span style={{ color: vscode.foreground }}>插入报错时：</span>
                    <label style={{ "margin-left": "12px", color: vscode.foreground, cursor: "pointer" }}>
                      <input type="radio" name="onError" checked={onError() === "rollback"} onChange={() => setOnError("rollback")} style={{ "margin-right": "6px" }} />
                      整体回退
                    </label>
                    <label style={{ "margin-left": "12px", color: vscode.foreground, cursor: "pointer" }}>
                      <input type="radio" name="onError" checked={onError() === "discard"} onChange={() => setOnError("discard")} style={{ "margin-right": "6px" }} />
                      丢弃该行继续
                    </label>
                  </div>
                </div>
              </div>
            </Show>
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
            onClick={doImport}
            disabled={!hasData() || !schema() || !table() || importing()}
            style={{
              padding: "8px 16px",
              "font-size": "14px",
              "background-color": hasData() && schema() && table() && !importing() ? vscode.buttonBg : vscode.buttonSecondary,
              color: "#fff",
              border: "none",
              "border-radius": "4px",
              cursor: hasData() && schema() && table() && !importing() ? "pointer" : "not-allowed",
            }}
          >
            {importing() ? "导入中…" : "导入"}
          </button>
        </div>
      </div>
    </div>
  );
}
