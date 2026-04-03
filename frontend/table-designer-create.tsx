/**
 * 新建表 - 表设计器
 * Phase 4: 外键、唯一、检查约束
 */

import { createSignal, onMount, For, Show } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { getDataTypes, executeDdl } from "./api";
import {
  type TableColumn,
  type UniqueConstraint,
  type CheckConstraint,
  type ForeignKeyConstraint,
  needsLength,
  buildCreateTableSql,
  normalizeDbDataTypesList,
} from "./table-designer-shared";
import { getRegisteredDbType } from "./db-session-meta";
import { isMysqlFamily } from "../shared/src";
import { vscode } from "./theme";

export interface TableDesignerCreateProps {
  connectionId: string;
  connectionInfo: string;
  schema: string;
  onSuccess?: (connectionId: string, schema: string) => void;
}

function defaultCreateColumn(connectionId: string): TableColumn {
  if (isMysqlFamily(getRegisteredDbType(connectionId))) {
    return {
      name: "",
      dataType: "varchar",
      length: "255",
      nullable: true,
      primaryKey: false,
      defaultValue: "",
      isNew: true,
    };
  }
  return { name: "", dataType: "text", nullable: true, primaryKey: false, defaultValue: "", isNew: true };
}

export default function TableDesignerCreate(props: TableDesignerCreateProps) {
  const [tableName, setTableName] = createSignal("");
  const [columns, setColumns] = createStore<TableColumn[]>([defaultCreateColumn(props.connectionId)]);
  const [uniqueConstraints, setUniqueConstraints] = createStore<UniqueConstraint[]>([]);
  const [checkConstraints, setCheckConstraints] = createStore<CheckConstraint[]>([]);
  const [fkConstraints, setFkConstraints] = createStore<ForeignKeyConstraint[]>([]);
  const [dataTypes, setDataTypes] = createSignal<string[]>(COMMON_TYPES);
  const [error, setError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [showPreview, setShowPreview] = createSignal(false);

  onMount(() => {
    if (props.connectionId) {
      getDataTypes(props.connectionId)
        .then(({ types }) => setDataTypes(normalizeDbDataTypesList(types)))
        .catch(() => setDataTypes([]));
    }
  });

  const addColumn = () => {
    setColumns(
      produce((draft) => {
        draft.push(defaultCreateColumn(props.connectionId));
      })
    );
  };

  const removeColumn = (index: number) => {
    setColumns(
      produce((draft) => {
        draft.splice(index, 1);
        if (draft.length === 0) {
          draft.push(defaultCreateColumn(props.connectionId));
        }
      })
    );
  };

  const addUnique = () => setUniqueConstraints((prev) => [...prev, { columns: "" }]);
  const removeUnique = (i: number) => setUniqueConstraints((prev) => prev.filter((_, idx) => idx !== i));
  const addCheck = () => setCheckConstraints((prev) => [...prev, { expression: "" }]);
  const removeCheck = (i: number) => setCheckConstraints((prev) => prev.filter((_, idx) => idx !== i));
  const addFk = () => setFkConstraints((prev) => [...prev, { column: "", refSchema: props.schema, refTable: "", refColumn: "" }]);
  const removeFk = (i: number) => setFkConstraints((prev) => prev.filter((_, idx) => idx !== i));

  const designerDialect = () =>
    (isMysqlFamily(getRegisteredDbType(props.connectionId)) ? "mysql" : "postgres") as const;

  const getStmts = () =>
    buildCreateTableSql(
      props.schema,
      tableName(),
      columns as unknown as TableColumn[],
      uniqueConstraints.length ? [...uniqueConstraints] : [],
      checkConstraints.filter((c) => c.expression.trim()),
      fkConstraints.filter((f) => f.column && f.refTable && f.refColumn),
      designerDialect()
    );

  const previewSql = () => getStmts().map(s => s + ";").join("\n\n");

  const handleExecute = async () => {
    const stmts = getStmts();
    if (stmts.length === 0) {
      setError("请填写表名和至少一列");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      for (const stmt of stmts) {
        await executeDdl(props.connectionId, stmt + ";");
      }
      setShowPreview(false);
      setTableName("");
      setColumns([defaultCreateColumn(props.connectionId)]);
      setUniqueConstraints([]);
      setCheckConstraints([]);
      setFkConstraints([]);
      props.onSuccess?.(props.connectionId, props.schema);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ padding: "24px", overflow: "auto", height: "100%" }}>
      <h2 style={{ "font-size": "18px", margin: "0 0 16px 0", color: vscode.foreground }}>
        新建表 - {props.schema}.{tableName() || "(未命名)"}
      </h2>
      <div style={{ display: "flex", "flex-wrap": "wrap", gap: "16px", "align-items": "center", "margin-bottom": "24px" }}>
        <label style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <span style={{ width: "80px", color: vscode.foreground }}>表名</span>
          <input
            type="text"
            value={tableName()}
            onInput={(e) => setTableName(e.currentTarget.value)}
            placeholder="table_name"
            style={{
              padding: "6px 10px",
              "background-color": vscode.inputBg,
              color: vscode.inputFg,
              border: `1px solid ${vscode.inputBorder}`,
              "border-radius": "4px",
              "font-family": "'JetBrains Mono', monospace",
              width: "200px",
            }}
          />
        </label>
        <span style={{ color: vscode.foregroundDim, "font-size": "13px" }}>Schema: {props.schema}</span>
      </div>

      <div style={{ "margin-bottom": "16px", display: "flex", "align-items": "center", gap: "12px" }}>
        <h3 style={{ "font-size": "14px", margin: 0, color: vscode.foreground }}>列定义</h3>
        <button
          onClick={addColumn}
          style={{
            padding: "4px 12px",
            "font-size": "12px",
            "background-color": vscode.buttonBg,
            color: "#fff",
            border: "none",
            "border-radius": "4px",
            cursor: "pointer",
          }}
        >
          + 添加列
        </button>
      </div>

      <div style={{ overflow: "auto", "margin-bottom": "24px" }}>
        <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "13px" }}>
          <thead>
            <tr>
              <th style={{ padding: "8px", "text-align": "left", "border-bottom": `1px solid ${vscode.border}`, color: vscode.foregroundDim }}>列名</th>
              <th style={{ padding: "8px", "text-align": "left", "border-bottom": `1px solid ${vscode.border}`, color: vscode.foregroundDim }}>类型</th>
              <th style={{ padding: "8px", "text-align": "left", "border-bottom": `1px solid ${vscode.border}`, color: vscode.foregroundDim }}>长度</th>
              <th style={{ padding: "8px", "text-align": "left", "border-bottom": `1px solid ${vscode.border}`, color: vscode.foregroundDim }}>非空</th>
              <th style={{ padding: "8px", "text-align": "left", "border-bottom": `1px solid ${vscode.border}`, color: vscode.foregroundDim }}>主键</th>
              <th style={{ padding: "8px", "text-align": "left", "border-bottom": `1px solid ${vscode.border}`, color: vscode.foregroundDim }}>默认值</th>
              <th style={{ padding: "8px", width: "60px" }}></th>
            </tr>
          </thead>
          <tbody>
            <For each={columns}>
              {(col, i) => (
                <tr>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <input
                      type="text"
                      value={col.name}
                      onInput={(e) => setColumns(i(), "name", e.currentTarget.value)}
                      placeholder="column_name"
                      style={{
                        padding: "4px 8px",
                        width: "100%",
                        "min-width": "120px",
                        "background-color": vscode.inputBg,
                        color: vscode.inputFg,
                        border: `1px solid ${vscode.inputBorder}`,
                        "border-radius": "4px",
                        "font-family": "'JetBrains Mono', monospace",
                      }}
                    />
                  </td>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <select
                      value={col.dataType}
                      onChange={(e) => setColumns(i(), "dataType", e.currentTarget.value)}
                      style={{
                        padding: "4px 8px",
                        "min-width": "140px",
                        "background-color": vscode.inputBg,
                        color: vscode.inputFg,
                        border: `1px solid ${vscode.inputBorder}`,
                        "border-radius": "4px",
                      }}
                    >
                      <For each={COMMON_TYPES}>{(t) => <option value={t}>{t}</option>}</For>
                      <optgroup label="其他">
                        <For each={dataTypes().filter((t) => !COMMON_TYPES.includes(t))}>
                          {(t) => <option value={t}>{t}</option>}
                        </For>
                      </optgroup>
                    </select>
                  </td>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <Show when={needsLength(col.dataType)} fallback={<span style={{ color: vscode.foregroundDim }}>—</span>}>
                      <input
                        type="text"
                        value={col.length ?? ""}
                        onInput={(e) => setColumns(i(), "length", e.currentTarget.value)}
                        placeholder="255"
                        style={{
                          padding: "4px 8px",
                          width: "60px",
                          "background-color": vscode.inputBg,
                          color: vscode.inputFg,
                          border: `1px solid ${vscode.inputBorder}`,
                          "border-radius": "4px",
                        }}
                      />
                    </Show>
                  </td>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <input
                      type="checkbox"
                      checked={!col.nullable}
                      onInput={(e) => setColumns(i(), "nullable", !e.currentTarget.checked)}
                    />
                  </td>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <input
                      type="checkbox"
                      checked={col.primaryKey}
                      onInput={(e) => setColumns(i(), "primaryKey", e.currentTarget.checked)}
                    />
                  </td>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <input
                      type="text"
                      value={col.defaultValue}
                      onInput={(e) => setColumns(i(), "defaultValue", e.currentTarget.value)}
                      placeholder="now()"
                      style={{
                        padding: "4px 8px",
                        "min-width": "80px",
                        "background-color": vscode.inputBg,
                        color: vscode.inputFg,
                        border: `1px solid ${vscode.inputBorder}`,
                        "border-radius": "4px",
                        "font-family": "'JetBrains Mono', monospace",
                      }}
                    />
                  </td>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <button onClick={() => removeColumn(i())} style={{ padding: "2px 8px", "font-size": "12px", background: "none", color: vscode.foregroundDim, border: "none", cursor: "pointer" }}>
                      删除
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>

      {/* Phase 4: 表约束 */}
      <div style={{ "margin-bottom": "24px" }}>
        <h3 style={{ "font-size": "14px", margin: "0 0 12px 0", color: vscode.foreground }}>表约束</h3>
        <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
          <div>
            <span style={{ "font-size": "12px", color: vscode.foregroundDim, "margin-right": "8px" }}>UNIQUE:</span>
            <button onClick={addUnique} style={{ padding: "2px 8px", "font-size": "11px", "background-color": vscode.buttonSecondary, color: vscode.foreground, border: "none", "border-radius": "4px", cursor: "pointer" }}>+</button>
            <For each={uniqueConstraints}>
              {(u, i) => (
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-top": "4px" }}>
                  <input
                    type="text"
                    value={u.columns}
                    onInput={(e) => setUniqueConstraints(i(), "columns", e.currentTarget.value)}
                    placeholder="col1, col2"
                    style={{ padding: "4px 8px", width: "200px", "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.inputBorder}`, "border-radius": "4px", "font-family": "'JetBrains Mono', monospace" }}
                  />
                  <button onClick={() => removeUnique(i())} style={{ padding: "2px 6px", "font-size": "11px", background: "none", color: vscode.foregroundDim, border: "none", cursor: "pointer" }}>删除</button>
                </div>
              )}
            </For>
          </div>
          <div>
            <span style={{ "font-size": "12px", color: vscode.foregroundDim, "margin-right": "8px" }}>CHECK:</span>
            <button onClick={addCheck} style={{ padding: "2px 8px", "font-size": "11px", "background-color": vscode.buttonSecondary, color: vscode.foreground, border: "none", "border-radius": "4px", cursor: "pointer" }}>+</button>
            <For each={checkConstraints}>
              {(c, i) => (
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-top": "4px" }}>
                  <input
                    type="text"
                    value={c.expression}
                    onInput={(e) => setCheckConstraints(i(), "expression", e.currentTarget.value)}
                    placeholder="age > 0"
                    style={{ padding: "4px 8px", flex: 1, "min-width": "150px", "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.inputBorder}`, "border-radius": "4px", "font-family": "'JetBrains Mono', monospace" }}
                  />
                  <button onClick={() => removeCheck(i())} style={{ padding: "2px 6px", "font-size": "11px", background: "none", color: vscode.foregroundDim, border: "none", cursor: "pointer" }}>删除</button>
                </div>
              )}
            </For>
          </div>
          <div>
            <span style={{ "font-size": "12px", color: vscode.foregroundDim, "margin-right": "8px" }}>FOREIGN KEY:</span>
            <button onClick={addFk} style={{ padding: "2px 8px", "font-size": "11px", "background-color": vscode.buttonSecondary, color: vscode.foreground, border: "none", "border-radius": "4px", cursor: "pointer" }}>+</button>
            <For each={fkConstraints}>
              {(fk, i) => (
                <div style={{ display: "flex", "align-items": "center", gap: "6px", "margin-top": "4px", "flex-wrap": "wrap" }}>
                  <input type="text" value={fk.column} onInput={(e) => setFkConstraints(i(), "column", e.currentTarget.value)} placeholder="本表列" style={{ padding: "4px 8px", width: "100px", "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.inputBorder}`, "border-radius": "4px" }} />
                  <span style={{ color: vscode.foregroundDim }}>→</span>
                  <input type="text" value={fk.refSchema} onInput={(e) => setFkConstraints(i(), "refSchema", e.currentTarget.value)} placeholder="schema" style={{ padding: "4px 8px", width: "80px", "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.inputBorder}`, "border-radius": "4px" }} />
                  <input type="text" value={fk.refTable} onInput={(e) => setFkConstraints(i(), "refTable", e.currentTarget.value)} placeholder="参照表" style={{ padding: "4px 8px", width: "100px", "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.inputBorder}`, "border-radius": "4px" }} />
                  <input type="text" value={fk.refColumn} onInput={(e) => setFkConstraints(i(), "refColumn", e.currentTarget.value)} placeholder="参照列" style={{ padding: "4px 8px", width: "80px", "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.inputBorder}`, "border-radius": "4px" }} />
                  <button onClick={() => removeFk(i())} style={{ padding: "2px 6px", "font-size": "11px", background: "none", color: vscode.foregroundDim, border: "none", cursor: "pointer" }}>删除</button>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>

      <Show when={error()}>
        <div style={{ "margin-bottom": "16px", padding: "8px 12px", "background-color": "rgba(244,67,54,0.2)", color: vscode.error, "border-radius": "4px" }}>{error()}</div>
      </Show>

      <div style={{ display: "flex", gap: "12px", "align-items": "center", "flex-wrap": "wrap" }}>
        <button onClick={() => setShowPreview(!showPreview())} style={{ padding: "8px 16px", "font-size": "13px", "background-color": vscode.buttonSecondary, color: vscode.foreground, border: "none", "border-radius": "4px", cursor: "pointer" }}>
          {showPreview() ? "隐藏" : "预览"} SQL
        </button>
        <button onClick={handleExecute} disabled={saving()} style={{ padding: "8px 16px", "font-size": "13px", "background-color": vscode.buttonBg, color: "#fff", border: "none", "border-radius": "4px", cursor: saving() ? "not-allowed" : "pointer" }}>
          {saving() ? "执行中..." : "创建表"}
        </button>
      </div>

      <Show when={showPreview()}>
        <div style={{ "margin-top": "24px" }}>
          <h4 style={{ "font-size": "13px", margin: "0 0 8px 0", color: vscode.foregroundDim }}>生成的 SQL（只读）</h4>
          <pre style={{ padding: "12px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "4px", overflow: "auto", "font-size": "12px", "font-family": "'JetBrains Mono', monospace", "white-space": "pre-wrap", "user-select": "text" }}>
            {previewSql() || "-- 请填写表名和列定义"}
          </pre>
        </div>
      </Show>
    </div>
  );
}
