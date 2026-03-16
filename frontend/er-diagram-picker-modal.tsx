/**
 * ER 图选择器 - 选择要展示的 Schema 和表
 */

import { createSignal, createEffect, Show, For, onCleanup } from "solid-js";
import { getSchemas, getTables } from "./api";
import { vscode } from "./theme";
import type { ErDiagramSelection } from "./er-diagram-modal";

interface ErDiagramPickerModalProps {
  connectionId: string;
  onClose: () => void;
  onConfirm: (selection: ErDiagramSelection) => void;
}

interface SchemaWithTables {
  schema: string;
  tables: string[];
  expanded: boolean;
}

export default function ErDiagramPickerModal(props: ErDiagramPickerModalProps) {
  const [schemas, setSchemas] = createSignal<SchemaWithTables[]>([]);
  const [selectedSchemas, setSelectedSchemas] = createSignal<Set<string>>(new Set());
  const [selectedTables, setSelectedTables] = createSignal<Record<string, Set<string>>>({});
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    let cancelled = false;
    onCleanup(() => { cancelled = true; });

    const cid = props.connectionId;
    if (!cid) return;
    loadData(cid, () => cancelled);
  });

  async function loadData(connectionId: string, isCancelled: () => boolean) {
    setLoading(true);
    setError(null);
    try {
      const schemasRes = await getSchemas(connectionId);
      if (isCancelled()) return;
      if (schemasRes.error) throw new Error(schemasRes.error);

      const schemaList = schemasRes.schemas || [];
      const withTables: SchemaWithTables[] = await Promise.all(
        schemaList.map(async (s) => {
          if (isCancelled()) return { schema: s, tables: [] as string[], expanded: false };
          const tablesRes = await getTables(connectionId, s);
          const tables = (tablesRes.tables || []).concat(tablesRes.views || []);
          return { schema: s, tables, expanded: false };
        })
      );

      if (isCancelled()) return;
      setSchemas(withTables);
    } catch (e: any) {
      if (!isCancelled()) setError(e.message || "加载失败");
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }

  function toggleSchemaExpand(schema: string) {
    setSchemas((prev) =>
      prev.map((s) => (s.schema === schema ? { ...s, expanded: !s.expanded } : s))
    );
  }

  function toggleSchemaSelect(schema: string) {
    setSelectedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(schema)) {
        next.delete(schema);
      } else {
        next.add(schema);
      }
      return next;
    });
  }

  function toggleTableSelect(schema: string, table: string) {
    const s = schemas().find((x) => x.schema === schema);
    if (!s) return;

    setSelectedTables((prev) => {
      const current = prev[schema];
      // 空 = 全部选中。取消勾选某表时 => 全部 except 该表
      const baseSet =
        !current || current.size === 0
          ? new Set(s.tables)
          : new Set(current);

      if (baseSet.has(table)) {
        baseSet.delete(table);
      } else {
        baseSet.add(table);
      }
      return { ...prev, [schema]: baseSet };
    });
  }

  function selectAllInSchema(schema: string) {
    const s = schemas().find((x) => x.schema === schema);
    if (!s) return;
    setSelectedTables((prev) => ({
      ...prev,
      [schema]: new Set(s.tables),
    }));
    setSelectedSchemas((prev) => new Set(prev).add(schema));
  }

  function deselectAllInSchema(schema: string) {
    setSelectedTables((prev) => {
      const next = { ...prev };
      delete next[schema];
      return next;
    });
    setSelectedSchemas((prev) => {
      const next = new Set(prev);
      next.delete(schema);
      return next;
    });
  }

  function handleConfirm() {
    const schemasList = Array.from(selectedSchemas());
    const tablesBySchema: Record<string, string[]> = {};
    for (const schema of schemasList) {
      const tables = selectedTables()[schema];
      // 空数组表示该 schema 下全部表
      tablesBySchema[schema] = tables && tables.size > 0 ? Array.from(tables) : [];
    }
    props.onConfirm({ schemas: schemasList, tablesBySchema });
    props.onClose();
  }

  const hasSelection = () => selectedSchemas().size > 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        "background-color": "rgba(0,0,0,0.7)",
        "z-index": 299,
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
          width: "480px",
          "max-height": "80vh",
          display: "flex",
          "flex-direction": "column",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 20px",
            "border-bottom": `1px solid ${vscode.border}`,
          }}
        >
          <h2 style={{ margin: 0, "font-size": "16px", color: vscode.foreground }}>
            选择要展示的 Schema 和表
          </h2>
          <p style={{ margin: "8px 0 0 0", "font-size": "12px", color: vscode.foregroundDim }}>
            勾选要包含在 ER 图中的 schema 和表，未勾选表时默认展示该 schema 下全部表
          </p>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
          <Show when={loading()}>
            <div style={{ color: vscode.foregroundDim, "font-size": "13px" }}>加载中...</div>
          </Show>

          <Show when={error()}>
            <div style={{ color: vscode.error, "font-size": "13px" }}>{error()}</div>
          </Show>

          <Show when={!loading() && !error()}>
            <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
              <For each={schemas()}>
                {(item) => {
                  const schemaSelected = () => selectedSchemas().has(item.schema);
                  const tableSet = () => selectedTables()[item.schema];
                  const isAllTables = () =>
                    !tableSet() || tableSet()!.size === item.tables.length;
                  const selectedTableCount = () => tableSet()?.size ?? 0;

                  return (
                    <div
                      style={{
                        border: `1px solid ${vscode.border}`,
                        "border-radius": "6px",
                        overflow: "hidden",
                      }}
                    >
                      {/* Schema 行 */}
                      <div
                        style={{
                          display: "flex",
                          "align-items": "center",
                          padding: "8px 12px",
                          "background-color": vscode.tabBarBg,
                          cursor: "pointer",
                        }}
                        onClick={() => toggleSchemaExpand(item.schema)}
                      >
                        <span
                          style={{
                            width: "20px",
                            "font-size": "12px",
                            color: vscode.foregroundDim,
                            transition: "transform 0.2s",
                            transform: item.expanded ? "rotate(90deg)" : "rotate(0deg)",
                          }}
                        >
                          ▶
                        </span>
                        <input
                          type="checkbox"
                          checked={schemaSelected()}
                          onChange={() => toggleSchemaSelect(item.schema)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ "margin-right": "10px" }}
                          aria-label={`选择 schema ${item.schema}`}
                        />
                        <span style={{ flex: 1, "font-weight": "600", color: vscode.foreground }}>
                          {item.schema}
                        </span>
                        <span style={{ "font-size": "12px", color: vscode.foregroundDim }}>
                          {item.tables.length} 表
                          {schemaSelected() &&
                            ` · 已选 ${selectedTableCount()}${isAllTables() ? " (全部)" : ""}`}
                        </span>
                      </div>

                      {/* 表列表 */}
                      <Show when={item.expanded}>
                        <div
                          style={{
                            padding: "8px 12px 8px 44px",
                            "max-height": "200px",
                            overflow: "auto",
                            "background-color": vscode.inputBg,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              gap: "12px",
                              "margin-bottom": "8px",
                              "font-size": "11px",
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => selectAllInSchema(item.schema)}
                              style={{
                                padding: "2px 8px",
                                "background-color": vscode.buttonSecondary,
                                color: vscode.foreground,
                                border: "none",
                                "border-radius": "4px",
                                cursor: "pointer",
                              }}
                            >
                              全选
                            </button>
                            <button
                              type="button"
                              onClick={() => deselectAllInSchema(item.schema)}
                              style={{
                                padding: "2px 8px",
                                "background-color": vscode.buttonSecondary,
                                color: vscode.foreground,
                                border: "none",
                                "border-radius": "4px",
                                cursor: "pointer",
                              }}
                            >
                              取消全选
                            </button>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              "flex-wrap": "wrap",
                              gap: "8px",
                            }}
                          >
                            <For each={item.tables}>
                              {(table) => {
                                const checked = () =>
                                  schemaSelected() &&
                                  (!tableSet() ||
                                    tableSet()!.size === 0 ||
                                    tableSet()!.has(table));
                                return (
                                  <label
                                    style={{
                                      display: "flex",
                                      "align-items": "center",
                                      gap: "4px",
                                      "font-size": "12px",
                                      color: vscode.foreground,
                                      cursor: "pointer",
                                      "white-space": "nowrap",
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked()}
                                      onChange={() => toggleTableSelect(item.schema, table)}
                                      disabled={!schemaSelected()}
                                      aria-label={`选择表 ${table}`}
                                    />
                                    {table}
                                  </label>
                                );
                              }}
                            </For>
                          </div>
                        </div>
                      </Show>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>

        <div
          style={{
            padding: "12px 20px",
            "border-top": `1px solid ${vscode.border}`,
            display: "flex",
            "justify-content": "space-between",
            "align-items": "center",
          }}
        >
          <span style={{ "font-size": "12px", color: vscode.foregroundDim }}>
            已选 {selectedSchemas().size} 个 schema
          </span>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
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
              onClick={handleConfirm}
              disabled={!hasSelection()}
              style={{
                padding: "8px 16px",
                "font-size": "13px",
                "background-color": hasSelection() ? vscode.buttonBg : vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "4px",
                cursor: hasSelection() ? "pointer" : "not-allowed",
              }}
            >
              生成 ER 图
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
