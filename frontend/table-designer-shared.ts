/**
 * 表设计器 - 新建表/编辑表 共享逻辑
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TableColumn {
  name: string;
  originalName?: string;    // edit 模式：记录原始列名，用于生成 RENAME COLUMN
  dataType: string;
  length?: string;          // varchar/char 等
  precision?: string;       // numeric/decimal 精度
  scale?: string;           // numeric/decimal 小数位
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
  comment?: string;         // 列注释
  isNew?: boolean;          // true = 新增列（edit 模式）
}

export type FKAction = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";

export interface IndexDef {
  name: string;
  originalName?: string;
  indexType: "BTREE" | "HASH";
  columns: string[];
  unique: boolean;
  isNew?: boolean;
  isExisting?: boolean;
  toDelete?: boolean;
}

export interface ForeignKeyDef {
  constraintName?: string;
  originalConstraintName?: string;
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
  onDelete: FKAction;
  onUpdate: FKAction;
  isNew?: boolean;
  isExisting?: boolean;
  toDelete?: boolean;
}

export interface UniqueConstraintDef {
  constraintName?: string;
  originalConstraintName?: string;
  columns: string;          // 逗号分隔的列名
  isNew?: boolean;
  isExisting?: boolean;
  toDelete?: boolean;
}

export interface CheckConstraintDef {
  constraintName?: string;
  originalConstraintName?: string;
  expression: string;
  isNew?: boolean;
  isExisting?: boolean;
  toDelete?: boolean;
}

export interface OriginalState {
  tableName: string;
  tableComment: string;
  columns: TableColumn[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  uniqueConstraints: UniqueConstraintDef[];
  checkConstraints: CheckConstraintDef[];
}

// ─── Legacy constraint types (kept for backward compatibility) ────────────────

export interface UniqueConstraint {
  columns: string;
}

export interface CheckConstraint {
  expression: string;
}

export interface ForeignKeyConstraint {
  column: string;
  refSchema: string;
  refTable: string;
  refColumn: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPES_NEEDING_LENGTH = ["varchar", "char", "bit", "varbit", "character varying", "character"];
const TYPES_NEEDING_PRECISION = ["numeric", "decimal"];

const DEFAULT_VALUE_RAW_RE = /^[0-9]+(\.[0-9]+)?$|^true$|^false$|^null$|^now\(\)$|^current_timestamp$/i;

// ─── Helper functions ─────────────────────────────────────────────────────────

export function needsLength(type: string): boolean {
  const lower = type.toLowerCase().trim();
  return TYPES_NEEDING_LENGTH.some((t) => lower === t || lower.startsWith(t + "("));
}

export function needsPrecision(type: string): boolean {
  const lower = type.toLowerCase().trim();
  return TYPES_NEEDING_PRECISION.some((t) => lower === t || lower.startsWith(t + "("));
}

export function formatDefaultValue(d: string): string {
  return DEFAULT_VALUE_RAW_RE.test(d.trim()) ? d.trim() : "'" + d.replace(/'/g, "''") + "'";
}

/**
 * 自动生成索引名，格式：idx_{表名}_{列名}
 * 当有多列时，列名用下划线连接
 */
export function autoIndexName(tableName: string, columns: string[]): string {
  const colPart = columns.filter(Boolean).join("_");
  return `idx_${tableName}_${colPart}`;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateDesignerState(state: {
  tableName: string;
  mode: "create" | "edit";
  columns: TableColumn[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  uniqueConstraints: UniqueConstraintDef[];
  checkConstraints: CheckConstraintDef[];
}): string[] {
  const errors: string[] = [];

  // 1. create 模式下表名不能为空
  if (state.mode === "create" && !state.tableName.trim()) {
    errors.push("表名不能为空");
  }

  // 2. 列名不能为空
  for (const col of state.columns) {
    if (!col.name.trim()) {
      errors.push("列名不能为空");
      break;
    }
  }

  // 3. 列名重复（大小写不敏感）
  const seen = new Set<string>();
  for (const col of state.columns) {
    const lower = col.name.trim().toLowerCase();
    if (lower && seen.has(lower)) {
      errors.push(`列名重复：${col.name.trim()}`);
    }
    seen.add(lower);
  }

  // 4. 索引列不能为空（未标记删除的索引）
  for (const idx of state.indexes) {
    if (!idx.toDelete && (!idx.columns || idx.columns.filter(Boolean).length === 0)) {
      errors.push(`索引 ${idx.name} 的列不能为空`);
    }
  }

  // 5. 外键定义不完整（未标记删除的外键）
  for (const fk of state.foreignKeys) {
    if (!fk.toDelete && (!fk.column.trim() || !fk.refTable.trim() || !fk.refColumn.trim())) {
      errors.push("外键定义不完整");
    }
  }

  // 6. 检查约束表达式不能为空（未标记删除的检查约束）
  for (const chk of state.checkConstraints) {
    if (!chk.toDelete && !chk.expression.trim()) {
      errors.push("检查约束表达式不能为空");
    }
  }

  return errors;
}

// ─── DDL Builder ──────────────────────────────────────────────────────────────

function q(identifier: string): string {
  return `"${identifier}"`;
}

function qualifiedTable(schema: string, tableName: string): string {
  return `${q(schema)}.${q(tableName)}`;
}

function buildColumnTypeSql(col: TableColumn): string {
  let typeStr = col.dataType;
  if (needsPrecision(col.dataType)) {
    if (col.precision?.trim()) {
      typeStr += col.scale?.trim()
        ? `(${col.precision.trim()}, ${col.scale.trim()})`
        : `(${col.precision.trim()})`;
    }
  } else if (needsLength(col.dataType)) {
    if (col.length?.trim()) {
      typeStr += `(${col.length.trim()})`;
    }
  }
  return typeStr;
}

function buildColumnInlineSql(col: TableColumn): string {
  let sql = `  ${q(col.name)} ${buildColumnTypeSql(col)}`;
  if (!col.nullable) sql += " NOT NULL";
  if (col.primaryKey) sql += " PRIMARY KEY";
  if (col.defaultValue.trim()) {
    sql += ` DEFAULT ${formatDefaultValue(col.defaultValue.trim())}`;
  }
  return sql;
}

function resolveFkConstraintName(tableName: string, fk: ForeignKeyDef): string {
  return fk.constraintName?.trim() || `fk_${tableName}_${fk.column}`;
}

function resolveUqConstraintName(tableName: string, uq: UniqueConstraintDef, idx: number): string {
  return uq.constraintName?.trim() || `uq_${tableName}_${uq.columns.replace(/\s*,\s*/g, "_")}`;
}

function resolveChkConstraintName(tableName: string, chk: CheckConstraintDef, idx: number): string {
  return chk.constraintName?.trim() || `chk_${tableName}_${idx + 1}`;
}

function resolveIndexName(tableName: string, idx: IndexDef): string {
  return idx.name?.trim() || autoIndexName(tableName, idx.columns);
}

export function buildDdlStatements(
  schema: string,
  tableName: string,
  mode: "create" | "edit",
  original: OriginalState,
  current: {
    tableName: string;
    tableComment: string;
    columns: TableColumn[];
    indexes: IndexDef[];
    foreignKeys: ForeignKeyDef[];
    uniqueConstraints: UniqueConstraintDef[];
    checkConstraints: CheckConstraintDef[];
  }
): string[] {
  const sqls: string[] = [];
  const qualified = qualifiedTable(schema, tableName);

  if (mode === "create") {
    // ── CREATE TABLE ──────────────────────────────────────────────────────────
    const colDefs = current.columns.map(buildColumnInlineSql);
    sqls.push(`CREATE TABLE ${qualified} (\n${colDefs.join(",\n")}\n)`);

    // Indexes
    for (const idx of current.indexes) {
      if (idx.toDelete) continue;
      const idxName = resolveIndexName(current.tableName, idx);
      const unique = idx.unique ? "UNIQUE " : "";
      const cols = idx.columns.map(q).join(", ");
      sqls.push(`CREATE ${unique}INDEX ${q(idxName)} ON ${qualified} USING ${idx.indexType} (${cols})`);
    }

    // Foreign keys
    for (const fk of current.foreignKeys) {
      if (fk.toDelete) continue;
      const constraintName = resolveFkConstraintName(current.tableName, fk);
      sqls.push(
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${q(constraintName)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.refSchema)}.${q(fk.refTable)} (${q(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
      );
    }

    // Unique constraints
    for (let i = 0; i < current.uniqueConstraints.length; i++) {
      const uq = current.uniqueConstraints[i];
      if (uq.toDelete) continue;
      const constraintName = resolveUqConstraintName(current.tableName, uq, i);
      const cols = uq.columns.split(",").map((c) => q(c.trim())).join(", ");
      sqls.push(`ALTER TABLE ${qualified} ADD CONSTRAINT ${q(constraintName)} UNIQUE (${cols})`);
    }

    // Check constraints
    for (let i = 0; i < current.checkConstraints.length; i++) {
      const chk = current.checkConstraints[i];
      if (chk.toDelete) continue;
      const constraintName = resolveChkConstraintName(current.tableName, chk, i);
      sqls.push(`ALTER TABLE ${qualified} ADD CONSTRAINT ${q(constraintName)} CHECK (${chk.expression})`);
    }

    // Table comment
    if (current.tableComment.trim()) {
      sqls.push(`COMMENT ON TABLE ${qualified} IS '${current.tableComment.replace(/'/g, "''")}'`);
    }

    // Column comments
    for (const col of current.columns) {
      if (col.comment?.trim()) {
        sqls.push(`COMMENT ON COLUMN ${qualified}.${q(col.name)} IS '${col.comment.replace(/'/g, "''")}'`);
      }
    }

    return sqls;
  }

  // ── EDIT MODE ──────────────────────────────────────────────────────────────

  // 1. Column modifications (ADD / ALTER / DROP COLUMN)
  const origColMap = new Map<string, TableColumn>(
    original.columns.map((c) => [c.name.toLowerCase(), c])
  );

  // ADD new columns
  for (const col of current.columns) {
    if (!col.isNew) continue;
    let sql = `ALTER TABLE ${qualified} ADD COLUMN ${q(col.name)} ${buildColumnTypeSql(col)}`;
    if (!col.nullable) sql += " NOT NULL";
    if (col.defaultValue.trim()) sql += ` DEFAULT ${formatDefaultValue(col.defaultValue.trim())}`;
    sqls.push(sql);
  }

  // DROP removed columns (in original but not in current)
  const currentOriginalNames = new Set(
    current.columns.map((c) => (c.originalName || c.name).toLowerCase())
  );
  for (const origCol of original.columns) {
    if (!currentOriginalNames.has(origCol.name.toLowerCase())) {
      sqls.push(`ALTER TABLE ${qualified} DROP COLUMN ${q(origCol.name)}`);
    }
  }

  // ALTER existing columns (type, nullable, default, primaryKey changes)
  for (const col of current.columns) {
    if (col.isNew) continue;
    const origKey = (col.originalName || col.name).toLowerCase();
    const orig = origColMap.get(origKey);
    if (!orig) continue;

    // Type change (including precision/scale for numeric/decimal)
    const origTypeStr = buildColumnTypeSql(orig);
    const newTypeStr = buildColumnTypeSql(col);
    if (origTypeStr !== newTypeStr) {
      sqls.push(`ALTER TABLE ${qualified} ALTER COLUMN ${q(col.name)} TYPE ${newTypeStr}`);
    }

    // Nullable change
    if (orig.nullable !== col.nullable) {
      sqls.push(
        `ALTER TABLE ${qualified} ALTER COLUMN ${q(col.name)} ${col.nullable ? "DROP NOT NULL" : "SET NOT NULL"}`
      );
    }

    // Default value change
    if (orig.defaultValue !== col.defaultValue) {
      const d = col.defaultValue.trim();
      if (d) {
        sqls.push(`ALTER TABLE ${qualified} ALTER COLUMN ${q(col.name)} SET DEFAULT ${formatDefaultValue(d)}`);
      } else {
        sqls.push(`ALTER TABLE ${qualified} ALTER COLUMN ${q(col.name)} DROP DEFAULT`);
      }
    }
  }

  // Primary key: compare sets (order-independent), rebuild if changed
  const origPkSet = new Set(original.columns.filter((c) => c.primaryKey).map((c) => c.name.toLowerCase()));
  const newPkCols = current.columns.filter((c) => c.primaryKey).map((c) => c.name);
  const newPkSet = new Set(newPkCols.map((n) => n.toLowerCase()));
  const pkChanged =
    origPkSet.size !== newPkSet.size ||
    [...origPkSet].some((col) => !newPkSet.has(col)) ||
    [...newPkSet].some((col) => !origPkSet.has(col));
  if (pkChanged) {
    if (origPkSet.size > 0) {
      sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT ${q(tableName + "_pkey")}`);
    }
    if (newPkCols.length > 0) {
      sqls.push(`ALTER TABLE ${qualified} ADD PRIMARY KEY (${newPkCols.map(q).join(", ")})`);
    }
  }

  // 2. Column renames
  for (const col of current.columns) {
    if (col.isNew) continue;
    if (col.originalName && col.originalName !== col.name) {
      sqls.push(
        `ALTER TABLE ${qualified} RENAME COLUMN ${q(col.originalName)} TO ${q(col.name)}`
      );
    }
  }

  // 3. Constraint deletions (toDelete=true)
  for (const fk of current.foreignKeys) {
    if (!fk.toDelete) continue;
    const constraintName = fk.originalConstraintName || resolveFkConstraintName(tableName, fk);
    sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT ${q(constraintName)}`);
  }
  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (!uq.toDelete) continue;
    const constraintName = uq.originalConstraintName || resolveUqConstraintName(tableName, uq, i);
    sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT ${q(constraintName)}`);
  }
  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (!chk.toDelete) continue;
    const constraintName = chk.originalConstraintName || resolveChkConstraintName(tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT ${q(constraintName)}`);
  }

  // 4. Constraint additions (isNew=true)
  for (const fk of current.foreignKeys) {
    if (!fk.isNew) continue;
    const constraintName = resolveFkConstraintName(tableName, fk);
    sqls.push(
      `ALTER TABLE ${qualified} ADD CONSTRAINT ${q(constraintName)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.refSchema)}.${q(fk.refTable)} (${q(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
    );
  }

  // 4b. FK modifications (existing FK changed)
  const origFkMap = new Map<string, ForeignKeyDef>(
    original.foreignKeys.map((fk) => [(fk.constraintName ?? "").toLowerCase(), fk])
  );
  for (const fk of current.foreignKeys) {
    if (fk.isNew || fk.toDelete) continue;
    const lookupKey = (fk.originalConstraintName || fk.constraintName || "").toLowerCase();
    const orig = origFkMap.get(lookupKey);
    if (!orig) continue;
    const changed =
      orig.constraintName !== fk.constraintName ||
      orig.column !== fk.column ||
      orig.refSchema !== fk.refSchema ||
      orig.refTable !== fk.refTable ||
      orig.refColumn !== fk.refColumn ||
      orig.onDelete !== fk.onDelete ||
      orig.onUpdate !== fk.onUpdate;
    if (changed) {
      const oldName = fk.originalConstraintName || orig.constraintName || resolveFkConstraintName(tableName, orig);
      sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT ${q(oldName)}`);
      const newName = resolveFkConstraintName(tableName, fk);
      sqls.push(
        `ALTER TABLE ${qualified} ADD CONSTRAINT ${q(newName)} FOREIGN KEY (${q(fk.column)}) REFERENCES ${q(fk.refSchema)}.${q(fk.refTable)} (${q(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
      );
    }
  }
  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (!uq.isNew) continue;
    const constraintName = resolveUqConstraintName(tableName, uq, i);
    const cols = uq.columns.split(",").map((c) => q(c.trim())).join(", ");
    sqls.push(`ALTER TABLE ${qualified} ADD CONSTRAINT ${q(constraintName)} UNIQUE (${cols})`);
  }
  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (!chk.isNew) continue;
    const constraintName = resolveChkConstraintName(tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualified} ADD CONSTRAINT ${q(constraintName)} CHECK (${chk.expression})`);
  }

  // 4c. Unique constraint modifications
  const origUqMap = new Map<string, UniqueConstraintDef>(
    original.uniqueConstraints.map((uq) => [(uq.constraintName ?? "").toLowerCase(), uq])
  );
  for (const uq of current.uniqueConstraints) {
    if (uq.isNew || uq.toDelete) continue;
    const lookupKey = (uq.originalConstraintName || uq.constraintName || "").toLowerCase();
    const orig = origUqMap.get(lookupKey);
    if (!orig) continue;
    const origCols = orig.columns.split(",").map((c) => c.trim()).sort().join(",");
    const newCols = uq.columns.split(",").map((c) => c.trim()).sort().join(",");
    if (orig.constraintName !== uq.constraintName || origCols !== newCols) {
      const oldName = uq.originalConstraintName || orig.constraintName || "";
      if (oldName) sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT ${q(oldName)}`);
      const newName = resolveUqConstraintName(tableName, uq, 0);
      const cols = uq.columns.split(",").map((c) => q(c.trim())).join(", ");
      sqls.push(`ALTER TABLE ${qualified} ADD CONSTRAINT ${q(newName)} UNIQUE (${cols})`);
    }
  }

  // 4d. Check constraint modifications
  const origChkMap = new Map<string, CheckConstraintDef>(
    original.checkConstraints.map((chk) => [(chk.constraintName ?? "").toLowerCase(), chk])
  );
  for (const chk of current.checkConstraints) {
    if (chk.isNew || chk.toDelete) continue;
    const lookupKey = (chk.originalConstraintName || chk.constraintName || "").toLowerCase();
    const orig = origChkMap.get(lookupKey);
    if (!orig) continue;
    if (orig.constraintName !== chk.constraintName || orig.expression !== chk.expression) {
      const oldName = chk.originalConstraintName || orig.constraintName || "";
      if (oldName) sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT ${q(oldName)}`);
      const newName = resolveChkConstraintName(tableName, chk, 0);
      sqls.push(`ALTER TABLE ${qualified} ADD CONSTRAINT ${q(newName)} CHECK (${chk.expression})`);
    }
  }

  // 5. Index deletions (toDelete=true)
  for (const idx of current.indexes) {
    if (!idx.toDelete) continue;
    const idxName = resolveIndexName(tableName, idx);
    sqls.push(`DROP INDEX ${q(schema)}.${q(idxName)}`);
  }

  // 6. Index additions (isNew=true)
  for (const idx of current.indexes) {
    if (!idx.isNew) continue;
    const idxName = resolveIndexName(tableName, idx);
    const unique = idx.unique ? "UNIQUE " : "";
    const cols = idx.columns.map(q).join(", ");
    sqls.push(`CREATE ${unique}INDEX ${q(idxName)} ON ${qualified} USING ${idx.indexType} (${cols})`);
  }

  // 7. Index modifications (existing index changed: name/type/columns/unique)
  const origIdxMap = new Map<string, IndexDef>(
    original.indexes.map((idx) => [idx.name.toLowerCase(), idx])
  );
  for (const idx of current.indexes) {
    if (idx.isNew || idx.toDelete) continue;
    // Use originalName to find the original record (handles name changes)
    const lookupKey = (idx.originalName || idx.name).toLowerCase();
    const orig = origIdxMap.get(lookupKey);
    if (!orig) continue;
    const nameChanged = orig.name !== idx.name;
    const typeChanged = orig.indexType !== idx.indexType;
    const uniqueChanged = orig.unique !== idx.unique;
    const colsChanged = JSON.stringify([...orig.columns].sort()) !== JSON.stringify([...idx.columns].sort());
    if (nameChanged || typeChanged || uniqueChanged || colsChanged) {
      // DROP old, CREATE new
      sqls.push(`DROP INDEX ${q(schema)}.${q(orig.name)}`);
      const unique = idx.unique ? "UNIQUE " : "";
      const cols = idx.columns.map(q).join(", ");
      const newIdxName = resolveIndexName(tableName, idx);
      sqls.push(`CREATE ${unique}INDEX ${q(newIdxName)} ON ${qualified} USING ${idx.indexType} (${cols})`);
    }
  }

  // 7. Comments
  // Table comment: only if changed
  if (current.tableComment !== original.tableComment) {
    if (current.tableComment.trim()) {
      sqls.push(`COMMENT ON TABLE ${qualified} IS '${current.tableComment.replace(/'/g, "''")}'`);
    } else {
      sqls.push(`COMMENT ON TABLE ${qualified} IS NULL`);
    }
  }

  // Column comments: only if changed or non-empty for new columns
  for (const col of current.columns) {
    const origKey = (col.originalName || col.name).toLowerCase();
    const orig = origColMap.get(origKey);
    const origComment = orig?.comment ?? "";
    const newComment = col.comment ?? "";
    if (col.isNew) {
      if (newComment.trim()) {
        sqls.push(`COMMENT ON COLUMN ${qualified}.${q(col.name)} IS '${newComment.replace(/'/g, "''")}'`);
      }
    } else if (newComment !== origComment) {
      if (newComment.trim()) {
        sqls.push(`COMMENT ON COLUMN ${qualified}.${q(col.name)} IS '${newComment.replace(/'/g, "''")}'`);
      } else {
        sqls.push(`COMMENT ON COLUMN ${qualified}.${q(col.name)} IS NULL`);
      }
    }
  }

  return sqls;
}

// ─── Legacy exports (backward compatibility with old create/edit components) ──

/** @deprecated Use buildDdlStatements instead */
export function buildCreateTableSql(
  schema: string,
  tableName: string,
  columns: TableColumn[],
  uniqueConstraints: UniqueConstraint[],
  checkConstraints: CheckConstraint[],
  foreignKeys: ForeignKeyConstraint[]
): string[] {
  const emptyOriginal: OriginalState = {
    tableName,
    tableComment: "",
    columns: [],
    indexes: [],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
  };
  return buildDdlStatements(schema, tableName, "create", emptyOriginal, {
    tableName,
    tableComment: "",
    columns,
    indexes: [],
    foreignKeys: foreignKeys.map((fk) => ({
      column: fk.column,
      refSchema: fk.refSchema,
      refTable: fk.refTable,
      refColumn: fk.refColumn,
      onDelete: "NO ACTION" as FKAction,
      onUpdate: "NO ACTION" as FKAction,
    })),
    uniqueConstraints: uniqueConstraints.map((uq) => ({ columns: uq.columns })),
    checkConstraints: checkConstraints.map((chk) => ({ expression: chk.expression })),
  });
}

/** @deprecated Use buildDdlStatements instead */
export function buildAlterTableSql(
  schema: string,
  tableName: string,
  originalColumns: TableColumn[],
  newColumns: TableColumn[]
): string[] {
  const emptyOriginal: OriginalState = {
    tableName,
    tableComment: "",
    columns: originalColumns,
    indexes: [],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
  };
  return buildDdlStatements(schema, tableName, "edit", emptyOriginal, {
    tableName,
    tableComment: "",
    columns: newColumns,
    indexes: [],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
  });
}

/** @deprecated Common PostgreSQL types list */
export const COMMON_TYPES: string[] = [
  "bigint", "bigserial", "boolean", "bytea", "char", "character varying",
  "date", "decimal", "double precision", "integer", "json", "jsonb",
  "numeric", "real", "serial", "smallint", "text", "time", "timestamp",
  "timestamptz", "uuid", "varchar",
];
