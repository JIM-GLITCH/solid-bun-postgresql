/**
 * 编辑表 - 表设计器
 * 使用 createResource 处理异步加载，无需 onMount + Promise + runWithOwner
 */

import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { getDataTypes, getColumns, executeDdl } from "./api";
import {
  type TableColumn,
  needsLength,
  buildAlterTableSql,
  normalizeDbDataTypesList,
} from "./table-designer-shared";
import { getRegisteredDbType } from "./db-session-meta";
import { isMysqlFamily } from "../shared/src";
import { vscode } from "./theme";

export interface TableDesignerEditProps {
  connectionId: string;
  connectionInfo: string;
  schema: string;
  table: string;
  onSuccess?: (connectionId: string, schema: string) => void;
}

function defaultEditColumn(connectionId: string): TableColumn {
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

function mapColumnsFromApi(cols: any[]): TableColumn[] {
  return cols.map((c: any) => ({
    name: c.column_name,
    dataType: c.data_type,
    length: c.character_maximum_length ? String(c.character_maximum_length) : "",
    nullable: c.is_nullable === "YES",
    primaryKey: false,
    defaultValue: String(c.column_default ?? ""),
    isNew: false,
  }));
}

export default function TableDesignerEdit(props: TableDesignerEditProps) {
  const [columns, setColumns] = createStore<TableColumn[]>([]);
  const [originalColumns, setOriginalColumns] = createSignal<TableColumn[]>([]);
  const [dataTypes, setDataTypes] = createSignal<string[]>(COMMON_TYPES);
  const [saving, setSaving] = createSignal(false);
  const [showPreview, setShowPreview] = createSignal(false);
  const [ddlError, setDdlError] = createSignal<string | null>(null);

  const source = () =>
    props.connectionId && props.table ? { cid: props.connectionId, schema: props.schema, table: props.table } : null;

  const [editData] = createResource(source, async ({ cid, schema, table }) => {
    const [typesRes, colsRes] = await Promise.all([getDataTypes(cid), getColumns(cid, schema, table)]);
    return {
      types: normalizeDbDataTypesList(typesRes.types),
      columns: mapColumnsFromApi(colsRes.columns ?? []),
    };
  });

  createEffect(() => {
    if (editData.error) return;
    try {
      const data = editData();
      if (data) {
        setDataTypes(data.types);
        if (data.columns.length) {
          setColumns(reconcile(data.columns, { key: "name" }));
          setOriginalColumns(data.columns);
        }
      }
    } catch {
      // resource 出错时 editData() 可能抛出
    }
  });

  const addColumn = () => {
    setColumns(
      produce((draft) => {
        draft.push(defaultEditColumn(props.connectionId));
      })
    );
  };

  const removeColumn = (index: number) => {
    setColumns(
      produce((draft) => {
        draft.splice(index, 1);
        if (draft.length === 0) {
          draft.push(defaultEditColumn(props.connectionId));
        }
      })
    );
  };

  const designerDialect = () =>
    (isMysqlFamily(getRegisteredDbType(props.connectionId)) ? "mysql" : "postgres") as const;

  const previewSql = () =>
    buildAlterTableSql(
      props.schema,
      props.table,
      originalColumns(),
      columns as unknown as TableColumn[],
      designerDialect()
    ).join("\n");

  const handleExecute = async () => {
    const sql = previewSql();
    if (!sql.trim()) {
      setDdlError("没有修改需要保存");
      return;
    }
    setSaving(true);
    setDdlError(null);
    try {
      const statements = sql.split(";").filter((s) => s.trim());
      for (const stmt of statements) {
        const s = stmt.trim();
        if (s) await executeDdl(props.connectionId, s + (s.endsWith(";") ? "" : ";"));
      }
      setShowPreview(false);
      setOriginalColumns(JSON.parse(JSON.stringify(columns)) as TableColumn[]);
      props.onSuccess?.(props.connectionId, props.schema);
    } catch (e) {
      setDdlError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Show when={!source()}>
        <div style={{ padding: "24px", color: vscode.foregroundDim }}>缺少连接或表名</div>
      </Show>
      <Show when={source() && editData.loading}>
        <div style={{ padding: "24px", color: vscode.foregroundDim }}>
          加载列信息...
        </div>
      </Show>
      <Show when={source() && !editData.loading && editData.error}>
        <div style={{ padding: "24px", color: vscode.error }}>
          {editData.error instanceof Error ? editData.error.message : String(editData.error)}
        </div>
      </Show>
      <Show when={source() && !editData.loading && !editData.error}>
        <div style={{ padding: "24px", overflow: "auto", height: "100%" }}>
      <h2 style={{ "font-size": "18px", margin: "0 0 16px 0", color: vscode.foreground }}>
        编辑表 - {props.schema}.{props.table}
      </h2>
      <div style={{ "margin-bottom": "16px", color: vscode.foregroundDim, "font-size": "13px" }}>
        Schema: {props.schema} · 表名不可修改
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
                      disabled={!col.isNew}
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
                    <input type="checkbox" checked={!col.nullable} onInput={(e) => setColumns(i(), "nullable", !e.currentTarget.checked)} />
                  </td>
                  <td style={{ padding: "4px 8px", "border-bottom": `1px solid ${vscode.border}` }}>
                    <input type="checkbox" checked={col.primaryKey} onInput={(e) => setColumns(i(), "primaryKey", e.currentTarget.checked)} />
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

      <Show when={ddlError()}>
        <div style={{ "margin-bottom": "16px", padding: "8px 12px", "background-color": "rgba(244,67,54,0.2)", color: vscode.error, "border-radius": "4px" }}>{ddlError()}</div>
      </Show>

      <div style={{ display: "flex", gap: "12px", "align-items": "center", "flex-wrap": "wrap" }}>
        <button onClick={() => setShowPreview(!showPreview())} style={{ padding: "8px 16px", "font-size": "13px", "background-color": vscode.buttonSecondary, color: vscode.foreground, border: "none", "border-radius": "4px", cursor: "pointer" }}>
          {showPreview() ? "隐藏" : "预览"} SQL
        </button>
        <button onClick={handleExecute} disabled={saving()} style={{ padding: "8px 16px", "font-size": "13px", "background-color": vscode.buttonBg, color: "#fff", border: "none", "border-radius": "4px", cursor: saving() ? "not-allowed" : "pointer" }}>
          {saving() ? "执行中..." : "保存修改"}
        </button>
      </div>

      <Show when={showPreview()}>
        <div style={{ "margin-top": "24px" }}>
          <h4 style={{ "font-size": "13px", margin: "0 0 8px 0", color: vscode.foregroundDim }}>生成的 SQL（只读）</h4>
          <pre style={{ padding: "12px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "4px", overflow: "auto", "font-size": "12px", "font-family": "'JetBrains Mono', monospace", "white-space": "pre-wrap", "user-select": "text" }}>
            {previewSql() || "-- 无修改"}
          </pre>
        </div>
      </Show>
        </div>
      </Show>
    </>
  );
}
