/**
 * 统一表设计器组件
 * 同时支持 create（新建表）和 edit（编辑表）两种模式
 */

import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";

// ── IndexColumnPicker ─────────────────────────────────────────────────────────
function IndexColumnPicker(pickerProps: {
  selected: () => string[];
  allColumns: () => string[];
  onChange: (cols: string[]) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [search, setSearch] = createSignal("");

  const filtered = () => {
    const q = search().toLowerCase();
    return pickerProps.allColumns().filter((c) => c.toLowerCase().includes(q));
  };

  const toggle = (col: string) => {
    const sel = pickerProps.selected();
    const next = sel.includes(col)
      ? sel.filter((c) => c !== col)
      : [...sel, col];
    pickerProps.onChange(next);
  };

  return (
    <div style={{ position: "relative", "min-width": "180px" }}>
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", "flex-wrap": "wrap", gap: "3px", "align-items": "center",
          padding: "3px 6px", "min-height": "26px", cursor: "pointer",
          "background-color": vscode.inputBg, border: `1px solid ${vscode.inputBorder}`,
          "border-radius": "3px", "font-size": "12px",
        }}
      >
        <Show when={pickerProps.selected().length === 0}>
          <span style={{ color: vscode.foregroundDim }}>选择列...</span>
        </Show>
        <For each={pickerProps.selected()}>
          {(col) => (
            <span style={{
              "background-color": vscode.buttonBg, color: "#fff",
              "border-radius": "3px", padding: "1px 5px", "font-size": "11px",
              display: "flex", "align-items": "center", gap: "3px",
            }}>
              {col}
              <span
                onClick={(e) => { e.stopPropagation(); toggle(col); }}
                style={{ cursor: "pointer", "font-size": "13px", "line-height": "1" }}
              >×</span>
            </span>
          )}
        </For>
        <span style={{ "margin-left": "auto", color: vscode.foregroundDim, "font-size": "10px" }}>▾</span>
      </div>
      <Show when={open()}>
        <div style={{
          position: "absolute", top: "100%", left: "0", "z-index": "100",
          "background-color": vscode.sidebarBg, border: `1px solid ${vscode.border}`,
          "border-radius": "4px", "min-width": "180px", "max-height": "220px",
          display: "flex", "flex-direction": "column", "box-shadow": "0 4px 12px rgba(0,0,0,0.3)",
        }}>
          <input
            type="text"
            placeholder="搜索列..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            onClick={(e) => e.stopPropagation()}
            style={{
              padding: "5px 8px", "font-size": "12px", border: "none",
              "border-bottom": `1px solid ${vscode.border}`,
              "background-color": vscode.inputBg, color: vscode.inputFg,
              outline: "none", "border-radius": "4px 4px 0 0",
            }}
          />
          <div style={{ overflow: "auto", flex: "1" }}>
            <Show when={filtered().length === 0}>
              <div style={{ padding: "8px", color: vscode.foregroundDim, "font-size": "12px" }}>无匹配列</div>
            </Show>
            <For each={filtered()}>
              {(col) => (
                <div
                  onClick={(e) => { e.stopPropagation(); toggle(col); }}
                  style={{
                    padding: "5px 10px", "font-size": "12px", cursor: "pointer",
                    color: vscode.foreground,
                    "background-color": pickerProps.selected().includes(col) ? vscode.buttonBg + "33" : "transparent",
                    display: "flex", "align-items": "center", gap: "6px",
                  }}
                >
                  <input type="checkbox" checked={pickerProps.selected().includes(col)} onChange={() => {}} style={{ "pointer-events": "none" }} />
                  {col}
                </div>
              )}
            </For>
          </div>
          <div
            onClick={() => setOpen(false)}
            style={{
              padding: "4px 8px", "font-size": "11px", "text-align": "right",
              "border-top": `1px solid ${vscode.border}`, cursor: "pointer",
              color: vscode.foregroundDim,
            }}
          >关闭</div>
        </div>
      </Show>
    </div>
  );
}

import {
  getColumns,
  getIndexes,
  getForeignKeys,
  getPrimaryKeys,
  getUniqueConstraints,
  getCheckConstraints,
  getTableComment,
  getSchemas,
  getTables,
  executeDdl,
} from "./api";
import {
  type TableColumn,
  type IndexDef,
  type ForeignKeyDef,
  type UniqueConstraintDef,
  type CheckConstraintDef,
  type OriginalState,
  needsLength,
  needsPrecision,
  COMMON_TYPES,
  COMMON_TYPES_MYSQL,
  autoIndexName,
  validateDesignerState,
  buildDdlStatements,
  normalizeMysqlReferentialAction,
} from "./table-designer-shared";
import { getRegisteredDbType } from "./db-session-meta";
import { isMysqlFamily } from "../shared/src";
import { vscode } from "./theme";

export interface TableDesignerUnifiedProps {
  connectionId: string;
  connectionInfo: string;
  schema: string;
  table?: string;
  mode: "create" | "edit";
  onSuccess?: (connectionId: string, schema: string) => void;
}

function emptyOriginalState(): OriginalState {
  return {
    tableName: "",
    tableComment: "",
    columns: [],
    indexes: [],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
  };
}

function designerDialect(connectionId: string): "postgres" | "mysql" {
  return isMysqlFamily(getRegisteredDbType(connectionId)) ? "mysql" : "postgres";
}

function emptyDesignerColumn(connectionId: string): TableColumn {
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
  return {
    name: "",
    dataType: "text",
    nullable: true,
    primaryKey: false,
    defaultValue: "",
    isNew: true,
  };
}

// ── FK helper pickers ─────────────────────────────────────────────────────────
// (Removed - data is managed inline in TableDesignerUnified via fkRefSchemas/fkRefTables/fkRefColumns signals)

export function TableDesignerUnified(props: TableDesignerUnifiedProps) {
  // ── Store state ────────────────────────────────────────────────────────────
  const [columns, setColumns] = createStore<TableColumn[]>([]);
  const [indexes, setIndexes] = createStore<IndexDef[]>([]);
  const [foreignKeys, setForeignKeys] = createStore<ForeignKeyDef[]>([]);
  const [uniqueConstraints, setUniqueConstraints] = createStore<UniqueConstraintDef[]>([]);
  const [checkConstraints, setCheckConstraints] = createStore<CheckConstraintDef[]>([]);

  // ── Signal state ───────────────────────────────────────────────────────────
  const [tableName, setTableName] = createSignal("");
  const [tableComment, setTableComment] = createSignal("");
  const [originalState, setOriginalState] = createSignal<OriginalState>(emptyOriginalState());
  const [activeTab, setActiveTab] = createSignal<"columns" | "indexes" | "foreignkeys" | "constraints">("columns");
  const [showSqlPreview, setShowSqlPreview] = createSignal(true);
  const [saving, setSaving] = createSignal(false);
  const [errors, setErrors] = createSignal<string[]>([]);

  // ── FK ref data (schemas / tables per schema / columns per schema.table) ──
  const [fkSchemas, setFkSchemas] = createSignal<string[]>([]);
  const [fkTables, setFkTables] = createStore<Record<string, string[]>>({});
  const [fkColumns, setFkColumns] = createStore<Record<string, string[]>>({});

  // Load schemas once on mount
  createEffect(() => {
    if (!props.connectionId) return;
    getSchemas(props.connectionId).then((r) => setFkSchemas(r.schemas ?? []));
  });

  // Load tables when a FK's refSchema is set
  const ensureFkTables = (schema: string) => {
    if (!schema || fkTables[schema]) return;
    getTables(props.connectionId, schema).then((r) =>
      setFkTables(schema, [...(r.tables ?? []), ...(r.views ?? [])])
    );
  };

  // Load columns when a FK's refTable is set
  const ensureFkColumns = (schema: string, table: string) => {
    const key = `${schema}.${table}`;
    if (!schema || !table || fkColumns[key]) return;
    getColumns(props.connectionId, schema, table).then((r) =>
      setFkColumns(key, (r.columns ?? []).map((c: any) => c.column_name))
    );
  };

  // ── isChanged (derived) ────────────────────────────────────────────────────
  const isChanged = createMemo(() => {
    const current = {
      tableName: tableName(),
      tableComment: tableComment(),
      columns: [...columns],
      indexes: [...indexes],
      foreignKeys: [...foreignKeys],
      uniqueConstraints: [...uniqueConstraints],
      checkConstraints: [...checkConstraints],
    };
    return JSON.stringify(current) !== JSON.stringify(originalState());
  });

  // ── Edit mode: load data in parallel ──────────────────────────────────────
  const editSource = () =>
    props.mode === "edit" && props.connectionId && props.table
      ? { cid: props.connectionId, schema: props.schema, table: props.table }
      : null;

  const [editData, { refetch: refetchEditData }] = createResource(editSource, async ({ cid, schema, table }) => {
    const [colsRes, idxRes, fkRes, uqRes, chkRes, commentRes, pkRes] = await Promise.all([
      getColumns(cid, schema, table),
      getIndexes(cid, schema, table),
      getForeignKeys(cid, schema, table),
      getUniqueConstraints(cid, schema, table),
      getCheckConstraints(cid, schema, table),
      getTableComment(cid, schema, table),
      getPrimaryKeys(cid, schema, table),
    ]);
    return { colsRes, idxRes, fkRes, uqRes, chkRes, commentRes, pkRes };
  });

  // ── Populate state after edit data loads ───────────────────────────────────
  createEffect(() => {
    if (editData.error || !editData()) return;
    try {
      const data = editData();
      if (!data) return;

      const pkSet = new Set<string>((data.pkRes.columns ?? []).map((c: string) => c.toLowerCase()));

      const isMysql = designerDialect(props.connectionId) === "mysql";
      const uqOnlyList = (data.uqRes.constraints ?? []).filter((c: any) => c.type === "UNIQUE");
      const mysqlUniqueConstraintNames = new Set(
        uqOnlyList.map((u: any) => String(u.name ?? "").toLowerCase()).filter(Boolean)
      );
      const colSig = (cols: string[]) => JSON.stringify([...cols].map((c) => c.toLowerCase()).sort());
      const mysqlUniqueColSigs = new Set(
        uqOnlyList.map((u: any) => {
          const arr = Array.isArray(u.columns)
            ? u.columns.map(String)
            : String(u.columns ?? "")
                .split(",")
                .map((s: string) => s.trim())
                .filter(Boolean);
          return colSig(arr);
        })
      );

      const loadedColumns: TableColumn[] = (data.colsRes.columns ?? []).map((c: any) => ({
        name: c.column_name,
        originalName: c.column_name,
        dataType: c.data_type,
        length: c.character_maximum_length ? String(c.character_maximum_length) : "",
        precision: c.numeric_precision ? String(c.numeric_precision) : "",
        scale: c.numeric_scale ? String(c.numeric_scale) : "",
        nullable: c.is_nullable === "YES",
        primaryKey: pkSet.has(c.column_name.toLowerCase()),
        defaultValue: String(c.column_default ?? ""),
        autoIncrement: !!c.identity_generation,
        comment: c.column_comment ?? "",
        isNew: false,
        isExisting: true,
      }));

      const loadedIndexes: IndexDef[] = (data.idxRes.indexes ?? [])
        .filter((idx: any) => !idx.is_primary)
        .filter((idx: any) => {
          if (!isMysql || !idx.is_unique) return true;
          const iname = String(idx.index_name ?? "").toLowerCase();
          if (mysqlUniqueConstraintNames.has(iname)) return false;
          const icols = Array.isArray(idx.columns) ? idx.columns.map(String) : [];
          if (mysqlUniqueColSigs.has(colSig(icols))) return false;
          return true;
        })
        .map((idx: any) => ({
          name: idx.index_name ?? "",
          originalName: idx.index_name ?? "",
          indexType: ((idx.index_type ?? "btree").toUpperCase() === "HASH" ? "HASH" : "BTREE") as "BTREE" | "HASH",
          columns: Array.isArray(idx.columns) ? idx.columns : [],
          unique: idx.is_unique ?? false,
          isNew: false,
          isExisting: true,
          toDelete: false,
        }));

      const loadedForeignKeys: ForeignKeyDef[] = (data.fkRes.outgoing ?? []).map((fk: any) => ({
        constraintName: fk.constraint_name ?? "",
        originalConstraintName: fk.constraint_name ?? "",
        column: fk.source_column ?? "",
        refSchema: fk.target_schema ?? props.schema,
        refTable: fk.target_table ?? "",
        refColumn: fk.target_column ?? "",
        onDelete: (isMysql ? normalizeMysqlReferentialAction(fk.delete_rule) : (fk.delete_rule ?? "NO ACTION")) as ForeignKeyDef["onDelete"],
        onUpdate: (isMysql ? normalizeMysqlReferentialAction(fk.update_rule) : (fk.update_rule ?? "NO ACTION")) as ForeignKeyDef["onUpdate"],
        isNew: false,
        isExisting: true,
        toDelete: false,
      }));

      const loadedUniqueConstraints: UniqueConstraintDef[] = (data.uqRes.constraints ?? [])
        .filter((c: any) => c.type !== "PRIMARY KEY")
        .map((uq: any) => ({
          constraintName: uq.name ?? "",
          originalConstraintName: uq.name ?? "",
          columns: Array.isArray(uq.columns) ? uq.columns.join(", ") : (uq.columns ?? ""),
          isNew: false,
          isExisting: true,
          toDelete: false,
        }));

      const loadedCheckConstraints: CheckConstraintDef[] = (data.chkRes.constraints ?? []).map((chk: any) => {
        let expr: string = chk.expression ?? chk.check_clause ?? "";
        // Strip leading CHECK (...) wrapper that PostgreSQL includes in check_clause
        const m = expr.match(/^CHECK\s*\(([\s\S]*)\)$/i);
        if (m) expr = m[1].trim();
        return {
          constraintName: chk.name ?? "",
          originalConstraintName: chk.name ?? "",
          expression: expr,
          isNew: false,
          isExisting: true,
          toDelete: false,
        };
      });

      const loadedComment = data.commentRes.comment ?? "";

      setTableName(props.table ?? "");
      setColumns(reconcile(loadedColumns));
      setIndexes(reconcile(loadedIndexes));
      setForeignKeys(reconcile(loadedForeignKeys));
      setUniqueConstraints(reconcile(loadedUniqueConstraints));
      setCheckConstraints(reconcile(loadedCheckConstraints));
      setTableComment(loadedComment);

      // Preload FK ref tables and columns for existing foreign keys
      for (const fk of loadedForeignKeys) {
        if (fk.refSchema) {
          getTables(props.connectionId, fk.refSchema).then((r) =>
            setFkTables(fk.refSchema, [...(r.tables ?? []), ...(r.views ?? [])])
          );
          if (fk.refTable) {
            const key = `${fk.refSchema}.${fk.refTable}`;
            getColumns(props.connectionId, fk.refSchema, fk.refTable).then((r) =>
              setFkColumns(key, (r.columns ?? []).map((c: any) => c.column_name))
            );
          }
        }
      }

      const snapshot: OriginalState = {
        tableName: props.table ?? "",
        tableComment: loadedComment,
        columns: JSON.parse(JSON.stringify(loadedColumns)),
        indexes: JSON.parse(JSON.stringify(loadedIndexes)),
        foreignKeys: JSON.parse(JSON.stringify(loadedForeignKeys)),
        uniqueConstraints: JSON.parse(JSON.stringify(loadedUniqueConstraints)),
        checkConstraints: JSON.parse(JSON.stringify(loadedCheckConstraints)),
      };
      setOriginalState(snapshot);
    } catch {
      // resource error handled via editData.error
    }
  });

  // ── Create mode: initialize with one empty column ─────────────────────────
  if (props.mode === "create") {
    setColumns([emptyDesignerColumn(props.connectionId)]);
    setOriginalState(emptyOriginalState());
  }

  const columnTypeOptions = createMemo(() =>
    designerDialect(props.connectionId) === "mysql" ? COMMON_TYPES_MYSQL : COMMON_TYPES
  );

  // ── Tab button style helper ────────────────────────────────────────────────
  const tabStyle = (tab: typeof activeTab extends () => infer T ? T : never) => ({
    padding: "6px 16px",
    "font-size": "13px",
    border: "none",
    "border-bottom": activeTab() === tab ? `2px solid ${vscode.buttonBg}` : "2px solid transparent",
    "background-color": "transparent",
    color: activeTab() === tab ? vscode.foreground : vscode.foregroundDim,
    cursor: "pointer",
    "font-weight": activeTab() === tab ? "600" : "normal",
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>

      {/* Loading / Error states for edit mode */}
      <Show when={props.mode === "edit" && editData.loading}>
        <div style={{ padding: "24px", color: vscode.foregroundDim }}>加载表信息...</div>
      </Show>
      <Show when={props.mode === "edit" && !editData.loading && editData.error}>
        <div style={{ padding: "24px", color: vscode.error }}>
          {editData.error instanceof Error ? editData.error.message : String(editData.error)}
        </div>
      </Show>

      <Show when={props.mode === "create" || (props.mode === "edit" && !editData.loading && !editData.error)}>
        <div style={{ display: "flex", "flex-direction": "column", height: "100%", overflow: "hidden" }}>

          {/* 1. Toolbar */}
          <div
            data-testid="toolbar"
            style={{
              padding: "8px 16px",
              "border-bottom": `1px solid ${vscode.border}`,
              display: "flex",
              "align-items": "center",
              gap: "8px",
              "flex-shrink": "0",
            }}
          >
            {/* 保存 button */}
            <button
              data-testid="btn-save"
              disabled={saving()}
              onClick={async () => {
                // 1. Validate
                const validationErrors = validateDesignerState({
                  tableName: tableName(),
                  mode: props.mode,
                  columns: [...columns],
                  indexes: [...indexes],
                  foreignKeys: [...foreignKeys],
                  uniqueConstraints: [...uniqueConstraints],
                  checkConstraints: [...checkConstraints],
                });
                if (validationErrors.length > 0) {
                  setErrors(validationErrors);
                  return;
                }
                setErrors([]);

                // 2. Build DDL
                const stmts = buildDdlStatements(
                  props.schema,
                  props.mode === "edit" ? (props.table ?? "") : tableName(),
                  props.mode,
                  originalState(),
                  {
                    tableName: tableName(),
                    tableComment: tableComment(),
                    columns: [...columns],
                    indexes: [...indexes],
                    foreignKeys: [...foreignKeys],
                    uniqueConstraints: [...uniqueConstraints],
                    checkConstraints: [...checkConstraints],
                  },
                  designerDialect(props.connectionId)
                );

                if (stmts.length === 0) {
                  setErrors(["没有修改需要保存"]);
                  return;
                }

                // 3. Execute DDL statements one by one
                setSaving(true);
                try {
                  for (const stmt of stmts) {
                    await executeDdl(props.connectionId, stmt + ";");
                  }
                  // 4. On success: update originalState snapshot
                  const newSnapshot: OriginalState = {
                    tableName: props.mode === "create" ? tableName() : (props.table ?? ""),
                    tableComment: tableComment(),
                    columns: JSON.parse(JSON.stringify([...columns])),
                    indexes: JSON.parse(JSON.stringify([...indexes])),
                    foreignKeys: JSON.parse(JSON.stringify([...foreignKeys])),
                    uniqueConstraints: JSON.parse(JSON.stringify([...uniqueConstraints])),
                    checkConstraints: JSON.parse(JSON.stringify([...checkConstraints])),
                  };
                  setOriginalState(newSnapshot);
                  props.onSuccess?.(props.connectionId, props.schema);
                  // Reload data from DB to reflect actual saved state
                  if (props.mode === "edit") refetchEditData();
                } catch (e: any) {
                  setErrors([e?.message ?? String(e)]);
                } finally {
                  setSaving(false);
                }
              }}
              style={{
                "background-color": isChanged() ? vscode.buttonBg : "transparent",
                color: isChanged() ? "#ffffff" : vscode.foreground,
                border: isChanged() ? "none" : `1px solid ${vscode.border}`,
                padding: "4px 12px",
                "border-radius": "4px",
                cursor: saving() ? "not-allowed" : "pointer",
                "font-size": "13px",
                opacity: saving() ? "0.5" : "1",
              }}
            >
              {saving() ? "保存中..." : "保存"}
            </button>

            {/* 清除修改 button */}
            <button
              data-testid="btn-reset"
              disabled={!isChanged()}
              onClick={() => {
                const snap = originalState();
                setColumns(reconcile(JSON.parse(JSON.stringify(snap.columns))));
                setIndexes(reconcile(JSON.parse(JSON.stringify(snap.indexes))));
                setForeignKeys(reconcile(JSON.parse(JSON.stringify(snap.foreignKeys))));
                setUniqueConstraints(reconcile(JSON.parse(JSON.stringify(snap.uniqueConstraints))));
                setCheckConstraints(reconcile(JSON.parse(JSON.stringify(snap.checkConstraints))));
                setTableComment(snap.tableComment);
                if (props.mode === "create") setTableName(snap.tableName);
                setErrors([]);
              }}
              style={{
                "background-color": "transparent",
                color: vscode.foreground,
                border: `1px solid ${vscode.border}`,
                padding: "4px 12px",
                "border-radius": "4px",
                cursor: !isChanged() ? "not-allowed" : "pointer",
                "font-size": "13px",
                opacity: !isChanged() ? "0.5" : "1",
              }}
            >
              清除修改
            </button>

            {/* 预览 SQL button */}
            <button
              data-testid="btn-preview-sql"
              onClick={() => setShowSqlPreview((v) => !v)}
              style={{
                "background-color": "transparent",
                color: vscode.foreground,
                border: `1px solid ${vscode.border}`,
                padding: "4px 12px",
                "border-radius": "4px",
                cursor: "pointer",
                "font-size": "13px",
              }}
            >
              预览 SQL
            </button>

            {/* 添加列 button */}
            <button
              data-testid="btn-add-column"
              onClick={() => {
                setColumns((cols) => [...cols, emptyDesignerColumn(props.connectionId)]);
              }}
              style={{
                "background-color": "transparent",
                color: vscode.foreground,
                border: `1px solid ${vscode.border}`,
                padding: "4px 12px",
                "border-radius": "4px",
                cursor: "pointer",
                "font-size": "13px",
              }}
            >
              添加列
            </button>
          </div>

          {/* 2. Table meta section */}
          <div
            data-testid="table-meta"
            style={{
              padding: "12px 16px",
              "border-bottom": `1px solid ${vscode.border}`,
              "flex-shrink": "0",
              display: "flex",
              "flex-direction": "column",
              gap: "8px",
            }}
          >
            <Show when={props.mode === "create"}>
              {/* Table name input */}
              <label style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ color: vscode.foreground, "font-size": "13px", width: "60px" }}>表名</span>
                <input
                  type="text"
                  value={tableName()}
                  onInput={(e) => setTableName(e.currentTarget.value)}
                  placeholder="table_name"
                  style={{
                    padding: "4px 8px",
                    "background-color": vscode.inputBg,
                    color: vscode.inputFg,
                    border: `1px solid ${vscode.inputBorder}`,
                    "border-radius": "4px",
                    "font-family": "'JetBrains Mono', monospace",
                    width: "200px",
                  }}
                />
              </label>
            </Show>
            <Show when={props.mode === "edit"}>
              {/* Read-only table name display */}
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <span style={{ color: vscode.foreground, "font-size": "13px", width: "60px" }}>表名</span>
                <span
                  data-testid="table-name-display"
                  style={{ color: vscode.foreground, "font-size": "13px", "font-family": "'JetBrains Mono', monospace" }}
                >
                  {props.schema}.{props.table}
                </span>
              </div>
            </Show>

            {/* Table comment input (both modes) */}
            <label style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <span style={{ color: vscode.foreground, "font-size": "13px", width: "60px" }}>表注释</span>
              <input
                data-testid="table-comment-input"
                type="text"
                value={tableComment()}
                onInput={(e) => setTableComment(e.currentTarget.value)}
                placeholder="可选表注释"
                style={{
                  padding: "4px 8px",
                  "background-color": vscode.inputBg,
                  color: vscode.inputFg,
                  border: `1px solid ${vscode.inputBorder}`,
                  "border-radius": "4px",
                  "font-family": "'JetBrains Mono', monospace",
                  width: "400px",
                }}
              />
            </label>
          </div>

          {/* 3. Tab navigation */}
          <div
            data-testid="tab-nav"
            style={{
              display: "flex",
              "border-bottom": `1px solid ${vscode.border}`,
              "flex-shrink": "0",
            }}
          >
            <button style={tabStyle("columns")} onClick={() => setActiveTab("columns")}>列定义</button>
            <button style={tabStyle("indexes")} onClick={() => setActiveTab("indexes")}>索引</button>
            <button style={tabStyle("foreignkeys")} onClick={() => setActiveTab("foreignkeys")}>外键</button>
            <button style={tabStyle("constraints")} onClick={() => setActiveTab("constraints")}>约束</button>
          </div>

          {/* 4. Tab content area (placeholders — tasks 5-8) */}
          <div
            data-testid="tab-content"
            style={{ flex: "1", overflow: "auto", padding: "16px" }}
          >
            <Show when={activeTab() === "columns"}>
              <div data-testid="tab-columns">
                <table style={{ width: "100%", "border-collapse": "collapse" }}>
                  <thead>
                    <tr>
                      {(["列名", "类型", "长度/精度", "小数位", "非空", "主键", "自增", "默认值", "注释", "操作"] as const).map((h) => (
                        <th style={{
                          "background-color": vscode.sidebarBg,
                          color: vscode.foreground,
                          "font-size": "12px",
                          padding: "6px 8px",
                          "text-align": "left",
                          "border-bottom": `1px solid ${vscode.border}`,
                          "white-space": "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <For each={columns}>
                      {(col, i) => {
                        const cellStyle = {
                          padding: "4px 6px",
                          "border-bottom": `1px solid ${vscode.border}`,
                          "vertical-align": "middle" as const,
                        };
                        const inputStyle = {
                          "background-color": vscode.inputBg,
                          color: vscode.inputFg,
                          border: `1px solid ${vscode.inputBorder}`,
                          "border-radius": "3px",
                          padding: "2px 6px",
                          "font-size": "12px",
                          width: "100%",
                        };
                        const btnStyle = {
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          color: vscode.foreground,
                          padding: "2px 4px",
                          "font-size": "12px",
                        };
                        return (
                          <tr>
                            {/* 列名 */}
                            <td style={cellStyle}>
                              <input
                                type="text"
                                value={col.name}
                                onInput={(e) => {
                                  const newName = e.currentTarget.value;
                                  if (!col.isNew) {
                                    // Set originalName before updating name (only once)
                                    if (!col.originalName || col.originalName === col.name) {
                                      setColumns(i(), "originalName", col.name);
                                    }
                                  }
                                  setColumns(i(), "name", newName);
                                }}
                                placeholder="column_name"
                                style={inputStyle}
                              />
                            </td>
                            {/* 类型 */}
                            <td style={cellStyle}>
                              <select
                                value={col.dataType}
                                onChange={(e) => setColumns(i(), "dataType", e.currentTarget.value)}
                                style={{ ...inputStyle, width: "auto", "min-width": "120px" }}
                              >
                                <For each={columnTypeOptions()}>
                                  {(t) => <option value={t}>{t}</option>}
                                </For>
                              </select>
                            </td>
                            {/* 长度/精度 */}
                            <td style={cellStyle}>
                              <Show when={needsPrecision(col.dataType)}>
                                <input
                                  type="text"
                                  value={col.precision ?? ""}
                                  onInput={(e) => setColumns(i(), "precision", e.currentTarget.value)}
                                  placeholder="10"
                                  style={{ ...inputStyle, width: "60px" }}
                                />
                              </Show>
                              <Show when={!needsPrecision(col.dataType) && needsLength(col.dataType)}>
                                <input
                                  type="text"
                                  value={col.length ?? ""}
                                  onInput={(e) => setColumns(i(), "length", e.currentTarget.value)}
                                  placeholder="255"
                                  style={{ ...inputStyle, width: "60px" }}
                                />
                              </Show>
                              <Show when={!needsPrecision(col.dataType) && !needsLength(col.dataType)}>
                                <span style={{ color: vscode.foregroundDim, "font-size": "12px" }}>—</span>
                              </Show>
                            </td>
                            {/* 小数位 */}
                            <td style={cellStyle}>
                              <Show when={needsPrecision(col.dataType)}>
                                <input
                                  type="text"
                                  value={col.scale ?? ""}
                                  onInput={(e) => setColumns(i(), "scale", e.currentTarget.value)}
                                  placeholder="2"
                                  style={{ ...inputStyle, width: "50px" }}
                                />
                              </Show>
                              <Show when={!needsPrecision(col.dataType)}>
                                <span style={{ color: vscode.foregroundDim, "font-size": "12px" }}>—</span>
                              </Show>
                            </td>
                            {/* 非空 */}
                            <td style={{ ...cellStyle, "text-align": "center" }}>
                              <input
                                type="checkbox"
                                checked={!col.nullable}
                                onChange={(e) => setColumns(i(), "nullable", !e.currentTarget.checked)}
                              />
                            </td>
                            {/* 主键 */}
                            <td style={{ ...cellStyle, "text-align": "center" }}>
                              <input
                                type="checkbox"
                                checked={col.primaryKey}
                                onChange={(e) => setColumns(i(), "primaryKey", e.currentTarget.checked)}
                              />
                            </td>
                            {/* 自增 */}
                            <td style={{ ...cellStyle, "text-align": "center" }}>
                              <input
                                type="checkbox"
                                checked={!!col.autoIncrement}
                                disabled={props.mode === "edit" && !!col.isExisting}
                                title={props.mode === "edit" && !!col.isExisting ? "已有列不支持修改自增" : ""}
                                onChange={(e) => setColumns(i(), "autoIncrement", e.currentTarget.checked)}
                                style={{ cursor: props.mode === "edit" && !!col.isExisting ? "not-allowed" : "pointer", opacity: props.mode === "edit" && !!col.isExisting ? "0.5" : "1" }}
                              />
                            </td>
                            {/* 默认值 */}
                            <td style={cellStyle}>
                              <input
                                type="text"
                                value={col.defaultValue}
                                onInput={(e) => setColumns(i(), "defaultValue", e.currentTarget.value)}
                                placeholder="now()"
                                style={inputStyle}
                              />
                            </td>
                            {/* 注释 */}
                            <td style={cellStyle}>
                              <input
                                type="text"
                                value={col.comment ?? ""}
                                onInput={(e) => setColumns(i(), "comment", e.currentTarget.value)}
                                placeholder="列注释"
                                style={inputStyle}
                              />
                            </td>
                            {/* 操作 */}
                            <td style={{ ...cellStyle, "white-space": "nowrap" }}>
                              {/* 复制 */}
                              <button
                                title="复制"
                                onClick={() => {
                                  setColumns(produce((cols) => {
                                    cols.splice(i() + 1, 0, { ...cols[i()], name: cols[i()].name + "_copy", isNew: true });
                                  }));
                                }}
                                style={btnStyle}
                              >复制</button>
                              {/* 上移 */}
                              <button
                                title="上移"
                                disabled={i() === 0}
                                onClick={() => {
                                  setColumns(produce((cols) => {
                                    const tmp = cols[i()];
                                    cols[i()] = cols[i() - 1];
                                    cols[i() - 1] = tmp;
                                  }));
                                }}
                                style={{ ...btnStyle, opacity: i() === 0 ? "0.3" : "1", cursor: i() === 0 ? "not-allowed" : "pointer" }}
                              >↑</button>
                              {/* 下移 */}
                              <button
                                title="下移"
                                disabled={i() === columns.length - 1}
                                onClick={() => {
                                  setColumns(produce((cols) => {
                                    const tmp = cols[i()];
                                    cols[i()] = cols[i() + 1];
                                    cols[i() + 1] = tmp;
                                  }));
                                }}
                                style={{ ...btnStyle, opacity: i() === columns.length - 1 ? "0.3" : "1", cursor: i() === columns.length - 1 ? "not-allowed" : "pointer" }}
                              >↓</button>
                              {/* 删除 */}
                              <button
                                title="删除"
                                onClick={() => setColumns((cols) => cols.filter((_, idx) => idx !== i()))}
                                style={{ ...btnStyle, color: vscode.error }}
                              >×</button>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <Show when={activeTab() === "indexes"}>
              <div data-testid="tab-indexes">
                {/* 添加索引 button */}
                <div style={{ "margin-bottom": "12px" }}>
                  <button
                    data-testid="btn-add-index"
                    onClick={() => {
                      setIndexes((idxs) => [
                        ...idxs,
                        {
                          name: "",
                          indexType: "BTREE",
                          columns: [],
                          unique: false,
                          isNew: true,
                          toDelete: false,
                        },
                      ]);
                    }}
                    style={{
                      "background-color": "transparent",
                      color: vscode.foreground,
                      border: `1px solid ${vscode.border}`,
                      padding: "4px 12px",
                      "border-radius": "4px",
                      cursor: "pointer",
                      "font-size": "13px",
                    }}
                  >
                    添加索引
                  </button>
                </div>

                {/* Indexes table */}
                <table style={{ width: "100%", "border-collapse": "collapse" }}>
                  <thead>
                    <tr>
                      {(["索引名", "类型", "列", "UNIQUE", "操作"] as const).map((h) => (
                        <th style={{
                          "background-color": vscode.sidebarBg,
                          color: vscode.foreground,
                          "font-size": "12px",
                          padding: "6px 8px",
                          "text-align": "left",
                          "border-bottom": `1px solid ${vscode.border}`,
                          "white-space": "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <For each={indexes}>
                      {(idx, i) => {
                        const cellStyle = {
                          padding: "4px 6px",
                          "border-bottom": `1px solid ${vscode.border}`,
                          "vertical-align": "middle" as const,
                          ...(idx.toDelete ? { "text-decoration": "line-through", opacity: "0.5" } : {}),
                        };
                        const inputStyle = {
                          "background-color": vscode.inputBg,
                          color: vscode.inputFg,
                          border: `1px solid ${vscode.inputBorder}`,
                          "border-radius": "3px",
                          padding: "2px 6px",
                          "font-size": "12px",
                          width: "100%",
                        };
                        return (
                          <tr style={idx.toDelete ? { "text-decoration": "line-through", opacity: "0.5" } : {}}>
                            {/* 索引名 */}
                            <td style={cellStyle}>
                              <input
                                type="text"
                                value={idx.name}
                                onInput={(e) => {
                                  const newName = e.currentTarget.value;
                                  if (!idx.isNew && !idx.originalName) {
                                    setIndexes(i(), "originalName", idx.name);
                                  }
                                  setIndexes(i(), "name", newName);
                                }}
                                onBlur={(e) => {
                                  if (!e.currentTarget.value.trim()) {
                                    setIndexes(i(), "name", autoIndexName(tableName() || props.table || "", idx.columns));
                                  }
                                }}
                                placeholder="idx_table_col"
                                style={inputStyle}
                              />
                            </td>
                            {/* 类型 */}
                            <td style={cellStyle}>
                              <select
                                value={idx.indexType}
                                onChange={(e) => setIndexes(i(), "indexType", e.currentTarget.value as "BTREE" | "HASH")}
                                style={{ ...inputStyle, width: "auto", "min-width": "80px" }}
                              >
                                <option value="BTREE">BTREE</option>
                                <option value="HASH">HASH</option>
                              </select>
                            </td>
                            {/* 列 */}
                            <td style={cellStyle}>
                              <IndexColumnPicker
                                selected={() => [...idx.columns]}
                                allColumns={() => columns.map((c) => c.name).filter(Boolean)}
                                onChange={(next) => setIndexes(i(), "columns", next)}
                              />
                            </td>
                            {/* UNIQUE */}
                            <td style={{ ...cellStyle, "text-align": "center" }}>
                              <input
                                type="checkbox"
                                checked={idx.unique}
                                onChange={(e) => setIndexes(i(), "unique", e.currentTarget.checked)}
                              />
                            </td>
                            {/* 操作 */}
                            <td style={cellStyle}>
                              <button
                                title={idx.toDelete ? "撤销删除" : "删除"}
                                onClick={() => {
                                  if (idx.isNew) {
                                    // Remove entirely
                                    setIndexes((idxs) => idxs.filter((_, j) => j !== i()));
                                  } else if (idx.toDelete) {
                                    // Un-mark deletion
                                    setIndexes(i(), "toDelete", false);
                                  } else {
                                    // Mark for deletion
                                    setIndexes(i(), "toDelete", true);
                                  }
                                }}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  color: idx.toDelete ? vscode.foreground : vscode.error,
                                  padding: "2px 4px",
                                  "font-size": "12px",
                                }}
                              >
                                {idx.toDelete ? "撤销" : "×"}
                              </button>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <Show when={activeTab() === "foreignkeys"}>
              <div data-testid="tab-foreignkeys">
                {/* 添加外键 button */}
                <div style={{ "margin-bottom": "12px" }}>
                  <button
                    data-testid="btn-add-foreignkey"
                    onClick={() => {
                      setForeignKeys((fks) => [
                        ...fks,
                        {
                          constraintName: "",
                          column: "",
                          refSchema: props.schema,
                          refTable: "",
                          refColumn: "",
                          onDelete: "NO ACTION" as const,
                          onUpdate: "NO ACTION" as const,
                          isNew: true,
                          toDelete: false,
                        },
                      ]);
                    }}
                    style={{
                      "background-color": "transparent",
                      color: vscode.foreground,
                      border: `1px solid ${vscode.border}`,
                      padding: "4px 12px",
                      "border-radius": "4px",
                      cursor: "pointer",
                      "font-size": "13px",
                    }}
                  >
                    添加外键
                  </button>
                </div>

                {/* Foreign keys table */}
                <table style={{ width: "100%", "border-collapse": "collapse" }}>
                  <thead>
                    <tr>
                      {(["约束名", "本表列", "参照 schema", "参照表", "参照列", "ON DELETE", "ON UPDATE", "操作"] as const).map((h) => (
                        <th style={{
                          "background-color": vscode.sidebarBg,
                          color: vscode.foreground,
                          "font-size": "12px",
                          padding: "6px 8px",
                          "text-align": "left",
                          "border-bottom": `1px solid ${vscode.border}`,
                          "white-space": "nowrap",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <For each={foreignKeys}>
                      {(fk, i) => {
                        const cellStyle = {
                          padding: "4px 6px",
                          "border-bottom": `1px solid ${vscode.border}`,
                          "vertical-align": "middle" as const,
                        };
                        const inputStyle = {
                          "background-color": vscode.inputBg,
                          color: vscode.inputFg,
                          border: `1px solid ${vscode.inputBorder}`,
                          "border-radius": "3px",
                          padding: "2px 6px",
                          "font-size": "12px",
                          width: "100%",
                        };
                        const fkActionOptions: FKAction[] = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"];
                        return (
                          <tr style={fk.toDelete ? { "text-decoration": "line-through", opacity: "0.5" } : {}}>
                            {/* 约束名 */}
                            <td style={cellStyle}>
                              <input
                                type="text"
                                value={fk.constraintName ?? ""}
                                onInput={(e) => setForeignKeys(i(), "constraintName", e.currentTarget.value)}
                                placeholder="fk_table_col"
                                style={inputStyle}
                              />
                            </td>
                            {/* 本表列 / 参照 schema / 参照表 / 参照列 */}
                            <td style={cellStyle}>
                              <select
                                value={fk.column}
                                onChange={(e) => setForeignKeys(i(), "column", e.currentTarget.value)}
                                style={{ ...inputStyle, "min-width": "100px" }}
                              >
                                <option value="">— 选择 —</option>
                                <For each={columns.map((c) => c.name).filter(Boolean)}>
                                  {(c) => <option value={c}>{c}</option>}
                                </For>
                              </select>
                            </td>
                            <td style={cellStyle}>
                              <select
                                value={fk.refSchema}
                                onChange={(e) => { setForeignKeys(i(), "refSchema", e.currentTarget.value); setForeignKeys(i(), "refTable", ""); setForeignKeys(i(), "refColumn", ""); }}
                                style={{ ...inputStyle, "min-width": "100px" }}
                              >
                                <option value="">— schema —</option>
                                <For each={fkSchemas()}>{(s) => <option value={s}>{s}</option>}</For>
                              </select>
                            </td>
                            <td style={cellStyle}>
                              {(() => { ensureFkTables(fk.refSchema); return null; })()}
                              <select
                                value={fk.refTable}
                                onChange={(e) => { setForeignKeys(i(), "refTable", e.currentTarget.value); setForeignKeys(i(), "refColumn", ""); }}
                                style={{ ...inputStyle, "min-width": "100px" }}
                              >
                                <option value="">— 表 —</option>
                                <For each={fkTables[fk.refSchema] ?? []}>{(t) => <option value={t}>{t}</option>}</For>
                              </select>
                            </td>
                            <td style={cellStyle}>
                              {(() => { ensureFkColumns(fk.refSchema, fk.refTable); return null; })()}
                              <select
                                value={fk.refColumn}
                                onChange={(e) => setForeignKeys(i(), "refColumn", e.currentTarget.value)}
                                style={{ ...inputStyle, "min-width": "100px" }}
                              >
                                <option value="">— 列 —</option>
                                <For each={fkColumns[`${fk.refSchema}.${fk.refTable}`] ?? []}>{(c) => <option value={c}>{c}</option>}</For>
                              </select>
                            </td>
                            {/* ON DELETE */}
                            <td style={cellStyle}>
                              <select
                                value={fk.onDelete}
                                onChange={(e) => setForeignKeys(i(), "onDelete", e.currentTarget.value as FKAction)}
                                style={{ ...inputStyle, width: "auto", "min-width": "110px" }}
                              >
                                <For each={fkActionOptions}>
                                  {(opt) => <option value={opt}>{opt}</option>}
                                </For>
                              </select>
                            </td>
                            {/* ON UPDATE */}
                            <td style={cellStyle}>
                              <select
                                value={fk.onUpdate}
                                onChange={(e) => setForeignKeys(i(), "onUpdate", e.currentTarget.value as FKAction)}
                                style={{ ...inputStyle, width: "auto", "min-width": "110px" }}
                              >
                                <For each={fkActionOptions}>
                                  {(opt) => <option value={opt}>{opt}</option>}
                                </For>
                              </select>
                            </td>
                            {/* 操作 */}
                            <td style={cellStyle}>
                              <button
                                title={fk.toDelete ? "撤销删除" : "删除"}
                                onClick={() => {
                                  if (fk.isNew) {
                                    // Remove entirely
                                    setForeignKeys((fks) => fks.filter((_, j) => j !== i()));
                                  } else if (fk.toDelete) {
                                    // Undo deletion
                                    setForeignKeys(i(), "toDelete", false);
                                  } else {
                                    // Mark for deletion
                                    setForeignKeys(i(), "toDelete", true);
                                  }
                                }}
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  cursor: "pointer",
                                  color: fk.toDelete ? vscode.foreground : vscode.error,
                                  padding: "2px 4px",
                                  "font-size": "12px",
                                }}
                              >
                                {fk.toDelete ? "撤销" : "×"}
                              </button>
                            </td>
                          </tr>
                        );
                      }}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <Show when={activeTab() === "constraints"}>
              <div data-testid="tab-constraints">

                {/* ── Section 1: 唯一约束 ─────────────────────────────────── */}
                <div style={{ "margin-bottom": "24px" }}>
                  <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "10px" }}>
                    <span style={{ color: vscode.foreground, "font-size": "13px", "font-weight": "600" }}>唯一约束</span>
                    <button
                      data-testid="btn-add-unique-constraint"
                      onClick={() => {
                        setUniqueConstraints((uqs) => [
                          ...uqs,
                          {
                            constraintName: "",
                            columns: "",
                            isNew: true,
                            toDelete: false,
                          },
                        ]);
                      }}
                      style={{
                        "background-color": "transparent",
                        color: vscode.foreground,
                        border: `1px solid ${vscode.border}`,
                        padding: "3px 10px",
                        "border-radius": "4px",
                        cursor: "pointer",
                        "font-size": "12px",
                      }}
                    >
                      添加唯一约束
                    </button>
                  </div>

                  <table style={{ width: "100%", "border-collapse": "collapse" }}>
                    <thead>
                      <tr>
                        {(["约束名", "列", "操作"] as const).map((h) => (
                          <th style={{
                            "background-color": vscode.sidebarBg,
                            color: vscode.foreground,
                            "font-size": "12px",
                            padding: "6px 8px",
                            "text-align": "left",
                            "border-bottom": `1px solid ${vscode.border}`,
                            "white-space": "nowrap",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <For each={uniqueConstraints}>
                        {(uq, i) => {
                          const cellStyle = {
                            padding: "4px 6px",
                            "border-bottom": `1px solid ${vscode.border}`,
                            "vertical-align": "middle" as const,
                          };
                          const inputStyle = {
                            "background-color": vscode.inputBg,
                            color: vscode.inputFg,
                            border: `1px solid ${vscode.inputBorder}`,
                            "border-radius": "3px",
                            padding: "2px 6px",
                            "font-size": "12px",
                            width: "100%",
                          };
                          return (
                            <tr style={uq.toDelete ? { "text-decoration": "line-through", opacity: "0.5" } : {}}>
                              {/* 约束名 */}
                              <td style={cellStyle}>
                                <input
                                  type="text"
                                  value={uq.constraintName ?? ""}
                                  onInput={(e) => setUniqueConstraints(i(), "constraintName", e.currentTarget.value)}
                                  placeholder="uq_table_col（可选）"
                                  style={inputStyle}
                                />
                              </td>
                              {/* 列 */}
                              <td style={cellStyle}>
                                <IndexColumnPicker
                                  selected={() => uq.columns ? uq.columns.split(",").map((c) => c.trim()).filter(Boolean) : []}
                                  allColumns={() => columns.map((c) => c.name).filter(Boolean)}
                                  onChange={(next) => setUniqueConstraints(i(), "columns", next.join(", "))}
                                />
                              </td>
                              {/* 操作 */}
                              <td style={cellStyle}>
                                <button
                                  title={uq.toDelete ? "撤销删除" : "删除"}
                                  onClick={() => {
                                    if (uq.isNew) {
                                      setUniqueConstraints((uqs) => uqs.filter((_, j) => j !== i()));
                                    } else if (uq.toDelete) {
                                      setUniqueConstraints(i(), "toDelete", false);
                                    } else {
                                      setUniqueConstraints(i(), "toDelete", true);
                                    }
                                  }}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    color: uq.toDelete ? vscode.foreground : vscode.error,
                                    padding: "2px 4px",
                                    "font-size": "12px",
                                  }}
                                >
                                  {uq.toDelete ? "撤销" : "×"}
                                </button>
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>

                {/* ── Divider ──────────────────────────────────────────────── */}
                <div style={{ "border-top": `1px solid ${vscode.border}`, "margin-bottom": "24px" }} />

                {/* ── Section 2: 检查约束 ─────────────────────────────────── */}
                <div>
                  <div style={{ display: "flex", "align-items": "center", gap: "12px", "margin-bottom": "10px" }}>
                    <span style={{ color: vscode.foreground, "font-size": "13px", "font-weight": "600" }}>检查约束</span>
                    <button
                      data-testid="btn-add-check-constraint"
                      onClick={() => {
                        setCheckConstraints((chks) => [
                          ...chks,
                          {
                            constraintName: "",
                            expression: "",
                            isNew: true,
                            toDelete: false,
                          },
                        ]);
                      }}
                      style={{
                        "background-color": "transparent",
                        color: vscode.foreground,
                        border: `1px solid ${vscode.border}`,
                        padding: "3px 10px",
                        "border-radius": "4px",
                        cursor: "pointer",
                        "font-size": "12px",
                      }}
                    >
                      添加检查约束
                    </button>
                  </div>

                  <table style={{ width: "100%", "border-collapse": "collapse" }}>
                    <thead>
                      <tr>
                        {(["约束名", "表达式", "操作"] as const).map((h) => (
                          <th style={{
                            "background-color": vscode.sidebarBg,
                            color: vscode.foreground,
                            "font-size": "12px",
                            padding: "6px 8px",
                            "text-align": "left",
                            "border-bottom": `1px solid ${vscode.border}`,
                            "white-space": "nowrap",
                          }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <For each={checkConstraints}>
                        {(chk, i) => {
                          const cellStyle = {
                            padding: "4px 6px",
                            "border-bottom": `1px solid ${vscode.border}`,
                            "vertical-align": "middle" as const,
                          };
                          const inputStyle = {
                            "background-color": vscode.inputBg,
                            color: vscode.inputFg,
                            border: `1px solid ${vscode.inputBorder}`,
                            "border-radius": "3px",
                            padding: "2px 6px",
                            "font-size": "12px",
                            width: "100%",
                          };
                          return (
                            <tr style={chk.toDelete ? { "text-decoration": "line-through", opacity: "0.5" } : {}}>
                              {/* 约束名 */}
                              <td style={cellStyle}>
                                <input
                                  type="text"
                                  value={chk.constraintName ?? ""}
                                  onInput={(e) => setCheckConstraints(i(), "constraintName", e.currentTarget.value)}
                                  placeholder="chk_table_expr（可选）"
                                  style={inputStyle}
                                />
                              </td>
                              {/* 表达式 */}
                              <td style={cellStyle}>
                                <input
                                  type="text"
                                  value={chk.expression}
                                  onInput={(e) => setCheckConstraints(i(), "expression", e.currentTarget.value)}
                                  placeholder="age > 0"
                                  style={inputStyle}
                                />
                              </td>
                              {/* 操作 */}
                              <td style={cellStyle}>
                                <button
                                  title={chk.toDelete ? "撤销删除" : "删除"}
                                  onClick={() => {
                                    if (chk.isNew) {
                                      setCheckConstraints((chks) => chks.filter((_, j) => j !== i()));
                                    } else if (chk.toDelete) {
                                      setCheckConstraints(i(), "toDelete", false);
                                    } else {
                                      setCheckConstraints(i(), "toDelete", true);
                                    }
                                  }}
                                  style={{
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    color: chk.toDelete ? vscode.foreground : vscode.error,
                                    padding: "2px 4px",
                                    "font-size": "12px",
                                  }}
                                >
                                  {chk.toDelete ? "撤销" : "×"}
                                </button>
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>

              </div>
            </Show>
          </div>

          {/* 5. SQL preview panel */}
          <Show when={showSqlPreview()}>
            <div
              data-testid="sql-preview"
              style={{
                "border-top": `1px solid ${vscode.border}`,
                padding: "12px 16px",
                "flex-shrink": "0",
                "max-height": "240px",
                overflow: "auto",
                "background-color": vscode.editorBg,
              }}
            >
              {(() => {
                const stmts = buildDdlStatements(
                  props.schema,
                  props.mode === "edit" ? (props.table ?? "") : tableName(),
                  props.mode,
                  originalState(),
                  {
                    tableName: tableName(),
                    tableComment: tableComment(),
                    columns: [...columns],
                    indexes: [...indexes],
                    foreignKeys: [...foreignKeys],
                    uniqueConstraints: [...uniqueConstraints],
                    checkConstraints: [...checkConstraints],
                  },
                  designerDialect(props.connectionId)
                );
                if (stmts.length === 0) {
                  return <p style={{ color: vscode.foregroundDim, "font-size": "12px", margin: "0" }}>没有修改需要保存</p>;
                }
                return (
                  <pre style={{ margin: "0", "font-size": "12px", color: vscode.foreground, "white-space": "pre-wrap", "word-break": "break-all" }}>
                    {stmts.map(s => s + ";").join("\n\n")}
                  </pre>
                );
              })()}
            </div>
          </Show>

          {/* 6. Error display area */}
          <Show when={errors().length > 0}>
            <div
              data-testid="error-display"
              style={{
                "border-top": `1px solid ${vscode.border}`,
                padding: "8px 16px",
                "background-color": "rgba(244,67,54,0.1)",
                "flex-shrink": "0",
              }}
            >
              <For each={errors()}>
                {(err) => (
                  <div style={{ color: vscode.error, "font-size": "13px", "margin-bottom": "4px" }}>{err}</div>
                )}
              </For>
            </div>
          </Show>

        </div>
      </Show>
    </div>
  );
}

export default TableDesignerUnified;
