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
  autoIncrement?: boolean;  // create 模式：生成 GENERATED ALWAYS AS IDENTITY
  comment?: string;         // 列注释
  isNew?: boolean;          // true = 新增列（edit 模式）
  isExisting?: boolean;     // true = 已存在于数据库的列
}

export type FKAction = "NO ACTION" | "RESTRICT" | "CASCADE" | "SET NULL" | "SET DEFAULT";

/** MySQL information_schema.REFERENTIAL_CONSTRAINTS 的 DELETE_RULE / UPDATE_RULE → 设计器枚举 */
export function normalizeMysqlReferentialAction(rule: unknown): FKAction {
  const s = String(rule ?? "NO ACTION")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ");
  if (s === "SET NULL") return "SET NULL";
  if (s === "SET DEFAULT") return "SET DEFAULT";
  if (s === "CASCADE") return "CASCADE";
  if (s === "RESTRICT") return "RESTRICT";
  if (s === "NO ACTION" || s === "NOACTION") return "NO ACTION";
  return "NO ACTION";
}

/** SQL Server sys.foreign_keys *_referential_action_desc（如 NO_ACTION）→ 设计器枚举 */
export function normalizeSqlServerReferentialAction(rule: unknown): FKAction {
  const s = String(rule ?? "NO_ACTION")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ");
  if (s === "SET NULL") return "SET NULL";
  if (s === "SET DEFAULT") return "SET DEFAULT";
  if (s === "CASCADE") return "CASCADE";
  if (s === "RESTRICT") return "RESTRICT";
  if (s === "NO ACTION" || s === "NOACTION") return "NO ACTION";
  return "NO ACTION";
}

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
  /** SQL Server 等：编辑时删除/重建主键需要真实约束名 */
  primaryKeyConstraintName?: string;
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

const TYPES_NEEDING_LENGTH = [
  "varchar", "char", "bit", "varbit", "character varying", "character",
  "binary", "varbinary",
  "nvarchar", "nchar",
];
const TYPES_NEEDING_PRECISION = ["numeric", "decimal"];

export type SqlDialect = "postgres" | "mysql" | "sqlserver";

export function quoteIdent(dialect: SqlDialect, id: string): string {
  if (dialect === "mysql") {
    return "`" + id.replace(/`/g, "``") + "`";
  }
  if (dialect === "sqlserver") {
    return "[" + id.replace(/\]/g, "]]") + "]";
  }
  return '"' + id.replace(/"/g, '""') + '"';
}

export function qualifiedTableName(dialect: SqlDialect, schema: string, table: string): string {
  return `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, table)}`;
}

function mysqlStringLiteral(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

function mysqlBaseType(dataType: string): string {
  const t = dataType.toLowerCase().trim();
  const paren = t.indexOf("(");
  return paren >= 0 ? t.slice(0, paren).trim() : t;
}

function mysqlSupportsAutoIncrement(dataType: string): boolean {
  const base = mysqlBaseType(dataType);
  return (
    base === "tinyint" ||
    base === "smallint" ||
    base === "mediumint" ||
    base === "int" ||
    base === "integer" ||
    base === "bigint"
  );
}

/** CREATE / ALTER 中列定义里类型之后的部分（不含列名） */
function mysqlColumnTail(col: TableColumn): string {
  let tail = buildColumnTypeSql(col);
  if (!col.nullable) tail += " NOT NULL";
  if (col.autoIncrement && mysqlSupportsAutoIncrement(col.dataType)) tail += " AUTO_INCREMENT";
  if (!col.autoIncrement && col.defaultValue.trim()) {
    tail += ` DEFAULT ${formatDefaultValue(col.defaultValue.trim())}`;
  }
  if (col.comment?.trim()) tail += ` COMMENT ${mysqlStringLiteral(col.comment)}`;
  return tail;
}

const DEFAULT_VALUE_RAW_RE = /^[0-9]+(\.[0-9]+)?$|^true$|^false$|^null$|^now\(\)$|^current_timestamp$/i;

// ─── Helper functions ─────────────────────────────────────────────────────────

/** 类型串里是否已带 (n) 或 (p,s)（长度/精度已写在 dataType 里，不再单独占一列） */
function dataTypeAlreadyHasNumericTypmod(type: string): boolean {
  return /\(\s*\d+(\s*,\s*\d+)?\s*\)/.test(type.toLowerCase());
}

export function needsLength(type: string): boolean {
  const lower = type.toLowerCase().trim();
  const base = TYPES_NEEDING_LENGTH.some((t) => lower === t || lower.startsWith(t + "("));
  if (!base) return false;
  if (dataTypeAlreadyHasNumericTypmod(lower)) return false;
  return true;
}

export function needsPrecision(type: string): boolean {
  const lower = type.toLowerCase().trim();
  const base = TYPES_NEEDING_PRECISION.some((t) => lower === t || lower.startsWith(t + "("));
  if (!base) return false;
  if (dataTypeAlreadyHasNumericTypmod(lower)) return false;
  return true;
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

function buildPgColumnInlineSql(col: TableColumn): string {
  const q = (id: string) => quoteIdent("postgres", id);
  let sql = `  ${q(col.name)} ${buildColumnTypeSql(col)}`;
  if (col.autoIncrement) {
    sql += " GENERATED ALWAYS AS IDENTITY";
  }
  if (!col.nullable) sql += " NOT NULL";
  if (col.primaryKey) sql += " PRIMARY KEY";
  if (!col.autoIncrement && col.defaultValue.trim()) {
    sql += ` DEFAULT ${formatDefaultValue(col.defaultValue.trim())}`;
  }
  return sql;
}

type DesignerDdlCurrent = {
  tableName: string;
  tableComment: string;
  columns: TableColumn[];
  indexes: IndexDef[];
  foreignKeys: ForeignKeyDef[];
  uniqueConstraints: UniqueConstraintDef[];
  checkConstraints: CheckConstraintDef[];
};

function mysqlBuildCreateDdl(schema: string, tableName: string, current: DesignerDdlCurrent): string[] {
  const qi = (id: string) => quoteIdent("mysql", id);
  const qualifiedTbl = qualifiedTableName("mysql", schema, tableName);
  const sqls: string[] = [];

  const pkCols = current.columns.filter((c) => c.primaryKey);
  const lines = current.columns.map((col) => `  ${qi(col.name)} ${mysqlColumnTail(col)}`);
  if (pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.map((c) => qi(c.name)).join(", ")})`);
  }

  let createSql = `CREATE TABLE ${qualifiedTbl} (\n${lines.join(",\n")}\n)`;
  if (current.tableComment.trim()) {
    createSql += ` COMMENT=${mysqlStringLiteral(current.tableComment)}`;
  }
  sqls.push(createSql);

  for (const idx of current.indexes) {
    if (idx.toDelete) continue;
    const idxName = resolveIndexName(current.tableName, idx);
    const unique = idx.unique ? "UNIQUE " : "";
    const cols = idx.columns.map((c) => qi(c)).join(", ");
    sqls.push(`CREATE ${unique}INDEX ${qi(idxName)} ON ${qualifiedTbl} (${cols})`);
  }

  for (const fk of current.foreignKeys) {
    if (fk.toDelete) continue;
    const constraintName = resolveFkConstraintName(current.tableName, fk);
    const ref = qualifiedTableName("mysql", fk.refSchema, fk.refTable);
    sqls.push(
      `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} FOREIGN KEY (${qi(fk.column)}) REFERENCES ${ref} (${qi(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
    );
  }

  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (uq.toDelete) continue;
    const constraintName = resolveUqConstraintName(current.tableName, uq, i);
    const cols = uq.columns.split(",").map((c) => qi(c.trim())).join(", ");
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} UNIQUE (${cols})`);
  }

  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (chk.toDelete) continue;
    const constraintName = resolveChkConstraintName(current.tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} CHECK (${chk.expression})`);
  }

  return sqls;
}

// ─── SQL Server (T-SQL) DDL ───────────────────────────────────────────────────

function sqlServerLit(s: string): string {
  return s.replace(/'/g, "''");
}

function sqlServerBaseType(dataType: string): string {
  const t = dataType.toLowerCase().trim();
  const p = t.indexOf("(");
  return p >= 0 ? t.slice(0, p).trim() : t;
}

function sqlServerNeedsLength(type: string): boolean {
  const base = sqlServerBaseType(type);
  return ["varchar", "nvarchar", "char", "nchar", "binary", "varbinary"].includes(base);
}

function sqlServerNeedsPrecision(type: string): boolean {
  const base = sqlServerBaseType(type);
  return base === "decimal" || base === "numeric";
}

function sqlServerBuildColumnTypeSql(col: TableColumn): string {
  const raw = col.dataType.trim();
  if (raw.includes("(")) return raw;
  let typeStr = raw;
  if (sqlServerNeedsPrecision(raw)) {
    if (col.precision?.trim()) {
      typeStr += col.scale?.trim()
        ? `(${col.precision.trim()}, ${col.scale.trim()})`
        : `(${col.precision.trim()})`;
    }
  } else if (sqlServerNeedsLength(raw)) {
    const len = col.length?.trim() ?? "";
    if (len === "-1" || len.toLowerCase() === "max") typeStr += "(MAX)";
    else if (len) typeStr += `(${len})`;
  }
  return typeStr;
}

function sqlServerSupportsIdentity(dataType: string): boolean {
  const b = sqlServerBaseType(dataType);
  return b === "tinyint" || b === "smallint" || b === "int" || b === "bigint";
}

function sqlServerDefaultParen(d: string): string {
  const t = d.trim();
  if (DEFAULT_VALUE_RAW_RE.test(t)) return `(${t})`;
  return `(N'${t.replace(/'/g, "''")}')`;
}

function sqlServerColumnDefTail(col: TableColumn): string {
  let part = sqlServerBuildColumnTypeSql(col);
  if (col.autoIncrement && sqlServerSupportsIdentity(col.dataType)) {
    part += " IDENTITY(1,1)";
  }
  if (!col.nullable) part += " NOT NULL";
  else part += " NULL";
  if (!col.autoIncrement && col.defaultValue.trim()) {
    part += ` DEFAULT ${sqlServerDefaultParen(col.defaultValue.trim())}`;
  }
  return part;
}

function sqlServerColumnDefForCreate(col: TableColumn): string {
  const qi = (id: string) => quoteIdent("sqlserver", id);
  return `${qi(col.name)} ${sqlServerColumnDefTail(col)}`;
}

function sqlServerNonClustered(_idx: IndexDef): string {
  return "NONCLUSTERED";
}

/** T-SQL 外键无 RESTRICT，与 NO ACTION 等价 */
function sqlServerFkRule(a: FKAction): string {
  return a === "RESTRICT" ? "NO ACTION" : a;
}

function sqlServerTableCommentStatements(schema: string, table: string, newComment: string): string[] {
  const sch = sqlServerLit(schema);
  const tbl = sqlServerLit(table);
  const dropIf = `IF EXISTS (SELECT 1 FROM sys.extended_properties ep INNER JOIN sys.tables tb ON ep.major_id = tb.object_id INNER JOIN sys.schemas s ON tb.schema_id = s.schema_id WHERE s.name = N'${sch}' AND tb.name = N'${tbl}' AND ep.class = 1 AND ep.minor_id = 0 AND ep.name = N'MS_Description')`;
  if (!newComment.trim()) {
    return [
      `${dropIf} EXEC sys.sp_dropextendedproperty @name = N'MS_Description', @level0type = N'SCHEMA', @level0name = N'${sch}', @level1type = N'TABLE', @level1name = N'${tbl}'`,
    ];
  }
  const val = sqlServerLit(newComment.trim());
  return [
    `${dropIf} EXEC sys.sp_updateextendedproperty @name = N'MS_Description', @value = N'${val}', @level0type = N'SCHEMA', @level0name = N'${sch}', @level1type = N'TABLE', @level1name = N'${tbl}' ELSE EXEC sys.sp_addextendedproperty @name = N'MS_Description', @value = N'${val}', @level0type = N'SCHEMA', @level0name = N'${sch}', @level1type = N'TABLE', @level1name = N'${tbl}'`,
  ];
}

function sqlServerDropDefaultDynamicBatch(schema: string, table: string, column: string): string {
  const sch = sqlServerLit(schema);
  const tbl = sqlServerLit(table);
  const col = sqlServerLit(column);
  // 勿用 EXEC(N'...' + QUOTENAME(...)) 单行形式：部分环境会误解析，报 “Incorrect syntax near 'QUOTENAME'”
  return `DECLARE @sch sysname = N'${sch}', @tbl sysname = N'${tbl}', @col sysname = N'${col}', @dc sysname, @sql nvarchar(max);
SELECT @dc = dc.name FROM sys.default_constraints dc
INNER JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
INNER JOIN sys.tables t ON c.object_id = t.object_id
INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = @sch AND t.name = @tbl AND c.name = @col;
IF @dc IS NOT NULL
BEGIN
  SET @sql = N'ALTER TABLE ' + QUOTENAME(@sch) + N'.' + QUOTENAME(@tbl) + N' DROP CONSTRAINT ' + QUOTENAME(@dc);
  EXEC (@sql);
END`;
}

function sqlServerPkConstraintName(tableName: string, original: OriginalState): string {
  return original.primaryKeyConstraintName?.trim() || `PK_${tableName}`.replace(/[^\w]/g, "_");
}

function sqlServerBuildCreateDdl(schema: string, tableName: string, current: DesignerDdlCurrent): string[] {
  const qi = (id: string) => quoteIdent("sqlserver", id);
  const qualifiedTbl = qualifiedTableName("sqlserver", schema, tableName);
  const sqls: string[] = [];
  const pkCols = current.columns.filter((c) => c.primaryKey);
  const lines = current.columns.map((col) => `  ${sqlServerColumnDefForCreate(col)}`);
  if (pkCols.length > 0) {
    const pkName = `PK_${tableName}`.replace(/[^\w]/g, "_");
    lines.push(`  CONSTRAINT ${qi(pkName)} PRIMARY KEY (${pkCols.map((c) => qi(c.name)).join(", ")})`);
  }
  sqls.push(`CREATE TABLE ${qualifiedTbl} (\n${lines.join(",\n")}\n)`);
  for (const stmt of sqlServerTableCommentStatements(schema, tableName, current.tableComment)) {
    sqls.push(stmt);
  }
  for (const idx of current.indexes) {
    if (idx.toDelete) continue;
    const idxName = resolveIndexName(current.tableName, idx);
    const unique = idx.unique ? "UNIQUE " : "";
    const nc = sqlServerNonClustered(idx);
    const cols = idx.columns.map((c) => qi(c)).join(", ");
    sqls.push(`CREATE ${unique}${nc} INDEX ${qi(idxName)} ON ${qualifiedTbl} (${cols})`);
  }
  for (const fk of current.foreignKeys) {
    if (fk.toDelete) continue;
    const constraintName = resolveFkConstraintName(current.tableName, fk);
    const ref = qualifiedTableName("sqlserver", fk.refSchema, fk.refTable);
    sqls.push(
      `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} FOREIGN KEY (${qi(fk.column)}) REFERENCES ${ref} (${qi(fk.refColumn)}) ON DELETE ${sqlServerFkRule(fk.onDelete)} ON UPDATE ${sqlServerFkRule(fk.onUpdate)}`
    );
  }
  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (uq.toDelete) continue;
    const constraintName = resolveUqConstraintName(current.tableName, uq, i);
    const cols = uq.columns.split(",").map((c) => qi(c.trim())).join(", ");
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} UNIQUE (${cols})`);
  }
  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (chk.toDelete) continue;
    const constraintName = resolveChkConstraintName(current.tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} CHECK (${chk.expression})`);
  }
  return sqls;
}

function mysqlBuildEditDdl(
  schema: string,
  tableName: string,
  original: OriginalState,
  current: DesignerDdlCurrent
): string[] {
  const qi = (id: string) => quoteIdent("mysql", id);
  const qualifiedTbl = qualifiedTableName("mysql", schema, tableName);
  const sqls: string[] = [];

  const origColMap = new Map<string, TableColumn>(
    original.columns.map((c) => [c.name.toLowerCase(), c])
  );
  const origFkMap = new Map<string, ForeignKeyDef>(
    original.foreignKeys.map((fk) => [(fk.constraintName ?? "").toLowerCase(), fk])
  );
  const origUqMap = new Map<string, UniqueConstraintDef>(
    original.uniqueConstraints.map((uq) => [(uq.constraintName ?? "").toLowerCase(), uq])
  );
  const origChkMap = new Map<string, CheckConstraintDef>(
    original.checkConstraints.map((chk) => [(chk.constraintName ?? "").toLowerCase(), chk])
  );
  const origIdxMap = new Map<string, IndexDef>(
    original.indexes.map((idx) => [idx.name.toLowerCase(), idx])
  );

  // Phase A：先删外键 / 唯一与检查约束 / 索引（MySQL 要求先 DROP FOREIGN KEY 再 DROP COLUMN 等）
  for (const fk of current.foreignKeys) {
    if (!fk.toDelete) continue;
    const constraintName = fk.originalConstraintName || resolveFkConstraintName(tableName, fk);
    sqls.push(`ALTER TABLE ${qualifiedTbl} DROP FOREIGN KEY ${qi(constraintName)}`);
  }
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
      sqls.push(`ALTER TABLE ${qualifiedTbl} DROP FOREIGN KEY ${qi(oldName)}`);
    }
  }

  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (!uq.toDelete) continue;
    const constraintName = uq.originalConstraintName || resolveUqConstraintName(tableName, uq, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} DROP INDEX ${qi(constraintName)}`);
  }
  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (!chk.toDelete) continue;
    const constraintName = chk.originalConstraintName || resolveChkConstraintName(tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CHECK ${qi(constraintName)}`);
  }

  for (const idx of current.indexes) {
    if (!idx.toDelete) continue;
    const idxName = resolveIndexName(tableName, idx);
    sqls.push(`DROP INDEX ${qi(idxName)} ON ${qualifiedTbl}`);
  }
  for (const idx of current.indexes) {
    if (idx.isNew || idx.toDelete) continue;
    const lookupKey = (idx.originalName || idx.name).toLowerCase();
    const orig = origIdxMap.get(lookupKey);
    if (!orig) continue;
    const nameChanged = orig.name !== idx.name;
    const typeChanged = orig.indexType !== idx.indexType;
    const uniqueChanged = orig.unique !== idx.unique;
    const colsChanged = JSON.stringify([...orig.columns].sort()) !== JSON.stringify([...idx.columns].sort());
    if (nameChanged || typeChanged || uniqueChanged || colsChanged) {
      sqls.push(`DROP INDEX ${qi(orig.name)} ON ${qualifiedTbl}`);
    }
  }

  for (const uq of current.uniqueConstraints) {
    if (uq.isNew || uq.toDelete) continue;
    const lookupKey = (uq.originalConstraintName || uq.constraintName || "").toLowerCase();
    const orig = origUqMap.get(lookupKey);
    if (!orig) continue;
    const origCols = orig.columns.split(",").map((c) => c.trim()).sort().join(",");
    const newCols = uq.columns.split(",").map((c) => c.trim()).sort().join(",");
    if (orig.constraintName !== uq.constraintName || origCols !== newCols) {
      const oldName = uq.originalConstraintName || orig.constraintName || "";
      if (oldName) sqls.push(`ALTER TABLE ${qualifiedTbl} DROP INDEX ${qi(oldName)}`);
    }
  }
  for (const chk of current.checkConstraints) {
    if (chk.isNew || chk.toDelete) continue;
    const lookupKey = (chk.originalConstraintName || chk.constraintName || "").toLowerCase();
    const orig = origChkMap.get(lookupKey);
    if (!orig) continue;
    if (orig.constraintName !== chk.constraintName || orig.expression !== chk.expression) {
      const oldName = chk.originalConstraintName || orig.constraintName || "";
      if (oldName) sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CHECK ${qi(oldName)}`);
    }
  }

  // Phase B：列结构（ADD / DROP / MODIFY / PK / RENAME）
  for (const col of current.columns) {
    if (!col.isNew) continue;
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD COLUMN ${qi(col.name)} ${mysqlColumnTail(col)}`);
  }

  const currentOriginalNames = new Set(
    current.columns.map((c) => (c.originalName || c.name).toLowerCase())
  );
  for (const origCol of original.columns) {
    if (!currentOriginalNames.has(origCol.name.toLowerCase())) {
      sqls.push(`ALTER TABLE ${qualifiedTbl} DROP COLUMN ${qi(origCol.name)}`);
    }
  }

  for (const col of current.columns) {
    if (col.isNew) continue;
    const origKey = (col.originalName || col.name).toLowerCase();
    const orig = origColMap.get(origKey);
    if (!orig) continue;

    const typeChanged = buildColumnTypeSql(orig) !== buildColumnTypeSql(col);
    const nullChanged = orig.nullable !== col.nullable;
    const defaultChanged = orig.defaultValue !== col.defaultValue;
    const aiChanged = !!orig.autoIncrement !== !!col.autoIncrement;
    const commentChanged = (orig.comment ?? "") !== (col.comment ?? "");

    if (typeChanged || nullChanged || defaultChanged || aiChanged || commentChanged) {
      sqls.push(`ALTER TABLE ${qualifiedTbl} MODIFY COLUMN ${qi(col.name)} ${mysqlColumnTail(col)}`);
    }
  }

  const origPkSet = new Set(original.columns.filter((c) => c.primaryKey).map((c) => c.name.toLowerCase()));
  const newPkCols = current.columns.filter((c) => c.primaryKey).map((c) => c.name);
  const newPkSet = new Set(newPkCols.map((n) => n.toLowerCase()));
  const pkChanged =
    origPkSet.size !== newPkSet.size ||
    [...origPkSet].some((col) => !newPkSet.has(col)) ||
    [...newPkSet].some((col) => !origPkSet.has(col));
  if (pkChanged) {
    if (origPkSet.size > 0) {
      sqls.push(`ALTER TABLE ${qualifiedTbl} DROP PRIMARY KEY`);
    }
    if (newPkCols.length > 0) {
      sqls.push(`ALTER TABLE ${qualifiedTbl} ADD PRIMARY KEY (${newPkCols.map(qi).join(", ")})`);
    }
  }

  for (const col of current.columns) {
    if (col.isNew) continue;
    if (col.originalName && col.originalName !== col.name) {
      sqls.push(
        `ALTER TABLE ${qualifiedTbl} RENAME COLUMN ${qi(col.originalName)} TO ${qi(col.name)}`
      );
    }
  }

  // Phase C：新建 / 重建外键、唯一、检查、索引
  for (const fk of current.foreignKeys) {
    if (!fk.isNew) continue;
    const constraintName = resolveFkConstraintName(tableName, fk);
    const ref = qualifiedTableName("mysql", fk.refSchema, fk.refTable);
    sqls.push(
      `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} FOREIGN KEY (${qi(fk.column)}) REFERENCES ${ref} (${qi(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
    );
  }
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
    if (!changed) continue;
    const newName = resolveFkConstraintName(tableName, fk);
    const ref = qualifiedTableName("mysql", fk.refSchema, fk.refTable);
    sqls.push(
      `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(newName)} FOREIGN KEY (${qi(fk.column)}) REFERENCES ${ref} (${qi(fk.refColumn)}) ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
    );
  }

  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (!uq.isNew) continue;
    const constraintName = resolveUqConstraintName(tableName, uq, i);
    const cols = uq.columns.split(",").map((c) => qi(c.trim())).join(", ");
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} UNIQUE (${cols})`);
  }
  for (const uq of current.uniqueConstraints) {
    if (uq.isNew || uq.toDelete) continue;
    const lookupKey = (uq.originalConstraintName || uq.constraintName || "").toLowerCase();
    const orig = origUqMap.get(lookupKey);
    if (!orig) continue;
    const origCols = orig.columns.split(",").map((c) => c.trim()).sort().join(",");
    const newCols = uq.columns.split(",").map((c) => c.trim()).sort().join(",");
    if (orig.constraintName !== uq.constraintName || origCols !== newCols) {
      const newName = resolveUqConstraintName(tableName, uq, 0);
      const cols = uq.columns.split(",").map((c) => qi(c.trim())).join(", ");
      sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(newName)} UNIQUE (${cols})`);
    }
  }

  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (!chk.isNew) continue;
    const constraintName = resolveChkConstraintName(tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} CHECK (${chk.expression})`);
  }
  for (const chk of current.checkConstraints) {
    if (chk.isNew || chk.toDelete) continue;
    const lookupKey = (chk.originalConstraintName || chk.constraintName || "").toLowerCase();
    const orig = origChkMap.get(lookupKey);
    if (!orig) continue;
    if (orig.constraintName === chk.constraintName && orig.expression === chk.expression) continue;
    const newName = resolveChkConstraintName(tableName, chk, 0);
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(newName)} CHECK (${chk.expression})`);
  }

  for (const idx of current.indexes) {
    if (!idx.isNew) continue;
    const idxName = resolveIndexName(tableName, idx);
    const unique = idx.unique ? "UNIQUE " : "";
    const cols = idx.columns.map((c) => qi(c)).join(", ");
    sqls.push(`CREATE ${unique}INDEX ${qi(idxName)} ON ${qualifiedTbl} (${cols})`);
  }
  for (const idx of current.indexes) {
    if (idx.isNew || idx.toDelete) continue;
    const lookupKey = (idx.originalName || idx.name).toLowerCase();
    const orig = origIdxMap.get(lookupKey);
    if (!orig) continue;
    const nameChanged = orig.name !== idx.name;
    const typeChanged = orig.indexType !== idx.indexType;
    const uniqueChanged = orig.unique !== idx.unique;
    const colsChanged = JSON.stringify([...orig.columns].sort()) !== JSON.stringify([...idx.columns].sort());
    if (!nameChanged && !typeChanged && !uniqueChanged && !colsChanged) continue;
    const unique = idx.unique ? "UNIQUE " : "";
    const cols = idx.columns.map((c) => qi(c)).join(", ");
    const newIdxName = resolveIndexName(tableName, idx);
    sqls.push(`CREATE ${unique}INDEX ${qi(newIdxName)} ON ${qualifiedTbl} (${cols})`);
  }

  if (current.tableComment !== original.tableComment) {
    if (current.tableComment.trim()) {
      sqls.push(`ALTER TABLE ${qualifiedTbl} COMMENT = ${mysqlStringLiteral(current.tableComment)}`);
    } else {
      sqls.push(`ALTER TABLE ${qualifiedTbl} COMMENT = ''`);
    }
  }

  return sqls;
}

function sqlServerBuildEditDdl(
  schema: string,
  tableName: string,
  original: OriginalState,
  current: DesignerDdlCurrent
): string[] {
  const qi = (id: string) => quoteIdent("sqlserver", id);
  const qualifiedTbl = qualifiedTableName("sqlserver", schema, tableName);
  const sqls: string[] = [];

  const origColMap = new Map<string, TableColumn>(
    original.columns.map((c) => [c.name.toLowerCase(), c])
  );
  const origFkMap = new Map<string, ForeignKeyDef>(
    original.foreignKeys.map((fk) => [(fk.constraintName ?? "").toLowerCase(), fk])
  );
  const origUqMap = new Map<string, UniqueConstraintDef>(
    original.uniqueConstraints.map((uq) => [(uq.constraintName ?? "").toLowerCase(), uq])
  );
  const origChkMap = new Map<string, CheckConstraintDef>(
    original.checkConstraints.map((chk) => [(chk.constraintName ?? "").toLowerCase(), chk])
  );
  const origIdxMap = new Map<string, IndexDef>(
    original.indexes.map((idx) => [idx.name.toLowerCase(), idx])
  );

  for (const fk of current.foreignKeys) {
    if (!fk.toDelete) continue;
    const constraintName = fk.originalConstraintName || resolveFkConstraintName(tableName, fk);
    sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CONSTRAINT ${qi(constraintName)}`);
  }
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
      sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CONSTRAINT ${qi(oldName)}`);
    }
  }

  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (!uq.toDelete) continue;
    const constraintName = uq.originalConstraintName || resolveUqConstraintName(tableName, uq, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CONSTRAINT ${qi(constraintName)}`);
  }
  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (!chk.toDelete) continue;
    const constraintName = chk.originalConstraintName || resolveChkConstraintName(tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CONSTRAINT ${qi(constraintName)}`);
  }

  for (const idx of current.indexes) {
    if (!idx.toDelete) continue;
    const idxName = resolveIndexName(tableName, idx);
    sqls.push(`DROP INDEX ${qi(idxName)} ON ${qualifiedTbl}`);
  }
  for (const idx of current.indexes) {
    if (idx.isNew || idx.toDelete) continue;
    const lookupKey = (idx.originalName || idx.name).toLowerCase();
    const orig = origIdxMap.get(lookupKey);
    if (!orig) continue;
    const nameChanged = orig.name !== idx.name;
    const typeChanged = orig.indexType !== idx.indexType;
    const uniqueChanged = orig.unique !== idx.unique;
    const colsChanged = JSON.stringify([...orig.columns].sort()) !== JSON.stringify([...idx.columns].sort());
    if (nameChanged || typeChanged || uniqueChanged || colsChanged) {
      sqls.push(`DROP INDEX ${qi(orig.name)} ON ${qualifiedTbl}`);
    }
  }

  for (const uq of current.uniqueConstraints) {
    if (uq.isNew || uq.toDelete) continue;
    const lookupKey = (uq.originalConstraintName || uq.constraintName || "").toLowerCase();
    const orig = origUqMap.get(lookupKey);
    if (!orig) continue;
    const origCols = orig.columns.split(",").map((c) => c.trim()).sort().join(",");
    const newCols = uq.columns.split(",").map((c) => c.trim()).sort().join(",");
    if (orig.constraintName !== uq.constraintName || origCols !== newCols) {
      const oldName = uq.originalConstraintName || orig.constraintName || "";
      if (oldName) sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CONSTRAINT ${qi(oldName)}`);
    }
  }
  for (const chk of current.checkConstraints) {
    if (chk.isNew || chk.toDelete) continue;
    const lookupKey = (chk.originalConstraintName || chk.constraintName || "").toLowerCase();
    const orig = origChkMap.get(lookupKey);
    if (!orig) continue;
    if (orig.constraintName !== chk.constraintName || orig.expression !== chk.expression) {
      const oldName = chk.originalConstraintName || orig.constraintName || "";
      if (oldName) sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CONSTRAINT ${qi(oldName)}`);
    }
  }

  for (const col of current.columns) {
    if (!col.isNew) continue;
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD ${qi(col.name)} ${sqlServerColumnDefTail(col)}`);
  }

  const currentOriginalNames = new Set(
    current.columns.map((c) => (c.originalName || c.name).toLowerCase())
  );
  for (const origCol of original.columns) {
    if (!currentOriginalNames.has(origCol.name.toLowerCase())) {
      sqls.push(`ALTER TABLE ${qualifiedTbl} DROP COLUMN ${qi(origCol.name)}`);
    }
  }

  for (const col of current.columns) {
    if (col.isNew) continue;
    const origKey = (col.originalName || col.name).toLowerCase();
    const orig = origColMap.get(origKey);
    if (!orig) continue;
    const physical =
      col.originalName && col.originalName !== col.name ? col.originalName : col.name;

    const typeChanged = sqlServerBuildColumnTypeSql(orig) !== sqlServerBuildColumnTypeSql(col);
    const nullChanged = orig.nullable !== col.nullable;
    const defaultChanged = orig.defaultValue !== col.defaultValue;
    const aiChanged = !!orig.autoIncrement !== !!col.autoIncrement;

    if (typeChanged || nullChanged || defaultChanged || aiChanged) {
      if (typeChanged || nullChanged || defaultChanged) {
        sqls.push(sqlServerDropDefaultDynamicBatch(schema, tableName, physical));
      }
      if (typeChanged || nullChanged) {
        sqls.push(
          `ALTER TABLE ${qualifiedTbl} ALTER COLUMN ${qi(physical)} ${sqlServerBuildColumnTypeSql(col)} ${col.nullable ? "NULL" : "NOT NULL"}`
        );
      }
      if (defaultChanged && col.defaultValue.trim()) {
        const dfName = `DF_${tableName}_${col.name}`.replace(/[^\w]/g, "_");
        sqls.push(
          `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(dfName)} DEFAULT ${sqlServerDefaultParen(col.defaultValue.trim())} FOR ${qi(physical)}`
        );
      }
    }
  }

  const origPkSet = new Set(original.columns.filter((c) => c.primaryKey).map((c) => c.name.toLowerCase()));
  const newPkCols = current.columns.filter((c) => c.primaryKey).map((c) => c.name);
  const newPkSet = new Set(newPkCols.map((n) => n.toLowerCase()));
  const pkChanged =
    origPkSet.size !== newPkSet.size ||
    [...origPkSet].some((col) => !newPkSet.has(col)) ||
    [...newPkSet].some((col) => !origPkSet.has(col));
  if (pkChanged && origPkSet.size > 0) {
    sqls.push(`ALTER TABLE ${qualifiedTbl} DROP CONSTRAINT ${qi(sqlServerPkConstraintName(tableName, original))}`);
  }

  for (const col of current.columns) {
    if (col.isNew) continue;
    if (col.originalName && col.originalName !== col.name) {
      const obj = `${sqlServerLit(schema)}.${sqlServerLit(tableName)}.${sqlServerLit(col.originalName)}`;
      sqls.push(
        `EXEC sp_rename @objname = N'${obj}', @newname = N'${sqlServerLit(col.name)}', @objtype = N'COLUMN'`
      );
    }
  }

  if (pkChanged && newPkCols.length > 0) {
    const newPk = `PK_${tableName}`.replace(/[^\w]/g, "_");
    sqls.push(
      `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(newPk)} PRIMARY KEY (${newPkCols.map(qi).join(", ")})`
    );
  }

  for (const fk of current.foreignKeys) {
    if (!fk.isNew) continue;
    const constraintName = resolveFkConstraintName(tableName, fk);
    const ref = qualifiedTableName("sqlserver", fk.refSchema, fk.refTable);
    sqls.push(
      `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} FOREIGN KEY (${qi(fk.column)}) REFERENCES ${ref} (${qi(fk.refColumn)}) ON DELETE ${sqlServerFkRule(fk.onDelete)} ON UPDATE ${sqlServerFkRule(fk.onUpdate)}`
    );
  }
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
    if (!changed) continue;
    const newName = resolveFkConstraintName(tableName, fk);
    const ref = qualifiedTableName("sqlserver", fk.refSchema, fk.refTable);
    sqls.push(
      `ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(newName)} FOREIGN KEY (${qi(fk.column)}) REFERENCES ${ref} (${qi(fk.refColumn)}) ON DELETE ${sqlServerFkRule(fk.onDelete)} ON UPDATE ${sqlServerFkRule(fk.onUpdate)}`
    );
  }

  for (let i = 0; i < current.uniqueConstraints.length; i++) {
    const uq = current.uniqueConstraints[i];
    if (!uq.isNew) continue;
    const constraintName = resolveUqConstraintName(tableName, uq, i);
    const cols = uq.columns.split(",").map((c) => qi(c.trim())).join(", ");
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} UNIQUE (${cols})`);
  }
  for (const uq of current.uniqueConstraints) {
    if (uq.isNew || uq.toDelete) continue;
    const lookupKey = (uq.originalConstraintName || uq.constraintName || "").toLowerCase();
    const orig = origUqMap.get(lookupKey);
    if (!orig) continue;
    const origCols = orig.columns.split(",").map((c) => c.trim()).sort().join(",");
    const newCols = uq.columns.split(",").map((c) => c.trim()).sort().join(",");
    if (orig.constraintName !== uq.constraintName || origCols !== newCols) {
      const newName = resolveUqConstraintName(tableName, uq, 0);
      const cols = uq.columns.split(",").map((c) => qi(c.trim())).join(", ");
      sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(newName)} UNIQUE (${cols})`);
    }
  }

  for (let i = 0; i < current.checkConstraints.length; i++) {
    const chk = current.checkConstraints[i];
    if (!chk.isNew) continue;
    const constraintName = resolveChkConstraintName(tableName, chk, i);
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(constraintName)} CHECK (${chk.expression})`);
  }
  for (const chk of current.checkConstraints) {
    if (chk.isNew || chk.toDelete) continue;
    const lookupKey = (chk.originalConstraintName || chk.constraintName || "").toLowerCase();
    const orig = origChkMap.get(lookupKey);
    if (!orig) continue;
    if (orig.constraintName === chk.constraintName && orig.expression === chk.expression) continue;
    const newName = resolveChkConstraintName(tableName, chk, 0);
    sqls.push(`ALTER TABLE ${qualifiedTbl} ADD CONSTRAINT ${qi(newName)} CHECK (${chk.expression})`);
  }

  for (const idx of current.indexes) {
    if (!idx.isNew) continue;
    const idxName = resolveIndexName(tableName, idx);
    const unique = idx.unique ? "UNIQUE " : "";
    const nc = sqlServerNonClustered(idx);
    const cols = idx.columns.map((c) => qi(c)).join(", ");
    sqls.push(`CREATE ${unique}${nc} INDEX ${qi(idxName)} ON ${qualifiedTbl} (${cols})`);
  }
  for (const idx of current.indexes) {
    if (idx.isNew || idx.toDelete) continue;
    const lookupKey = (idx.originalName || idx.name).toLowerCase();
    const orig = origIdxMap.get(lookupKey);
    if (!orig) continue;
    const nameChanged = orig.name !== idx.name;
    const typeChanged = orig.indexType !== idx.indexType;
    const uniqueChanged = orig.unique !== idx.unique;
    const colsChanged = JSON.stringify([...orig.columns].sort()) !== JSON.stringify([...idx.columns].sort());
    if (!nameChanged && !typeChanged && !uniqueChanged && !colsChanged) continue;
    const unique = idx.unique ? "UNIQUE " : "";
    const nc = sqlServerNonClustered(idx);
    const cols = idx.columns.map((c) => qi(c)).join(", ");
    const newIdxName = resolveIndexName(tableName, idx);
    sqls.push(`CREATE ${unique}${nc} INDEX ${qi(newIdxName)} ON ${qualifiedTbl} (${cols})`);
  }

  if (current.tableComment !== original.tableComment) {
    sqls.push(...sqlServerTableCommentStatements(schema, tableName, current.tableComment));
  }

  return sqls;
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
  current: DesignerDdlCurrent,
  dialect: SqlDialect = "postgres"
): string[] {
  if (dialect === "mysql") {
    if (mode === "create") return mysqlBuildCreateDdl(schema, tableName, current);
    return mysqlBuildEditDdl(schema, tableName, original, current);
  }
  if (dialect === "sqlserver") {
    if (mode === "create") return sqlServerBuildCreateDdl(schema, tableName, current);
    return sqlServerBuildEditDdl(schema, tableName, original, current);
  }
  return buildPostgresDdlStatements(schema, tableName, mode, original, current);
}

function buildPostgresDdlStatements(
  schema: string,
  tableName: string,
  mode: "create" | "edit",
  original: OriginalState,
  current: DesignerDdlCurrent
): string[] {
  const sqls: string[] = [];
  const q = (id: string) => quoteIdent("postgres", id);
  const qualified = qualifiedTableName("postgres", schema, tableName);

  if (mode === "create") {
    // ── CREATE TABLE ──────────────────────────────────────────────────────────
    const colDefs = current.columns.map(buildPgColumnInlineSql);
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
    if (col.autoIncrement) {
      sql += " GENERATED ALWAYS AS IDENTITY";
    }
    if (!col.nullable) sql += " NOT NULL";
    if (!col.autoIncrement && col.defaultValue.trim()) sql += ` DEFAULT ${formatDefaultValue(col.defaultValue.trim())}`;
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
  foreignKeys: ForeignKeyConstraint[],
  dialect: SqlDialect = "postgres"
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
  },
    dialect
  );
}

/** @deprecated Use buildDdlStatements instead */
export function buildAlterTableSql(
  schema: string,
  tableName: string,
  originalColumns: TableColumn[],
  newColumns: TableColumn[],
  dialect: SqlDialect = "postgres"
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
  },
    dialect
  );
}

/** `db/columns` 与 `db/data-types` 对齐：PostgreSQL 优先 `pg_format_type`（与 `format_type` 建议列表一致，如 smallint），否则 `udt_name`；其它库用 `data_type` */
export function columnApiDataTypeLabel(c: { data_type?: string; udt_name?: string; pg_format_type?: string }): string {
  const fmt = c.pg_format_type != null ? String(c.pg_format_type).trim() : "";
  if (fmt) return fmt;
  const udt = c.udt_name != null ? String(c.udt_name).trim() : "";
  if (udt) return udt;
  return String(c.data_type ?? "").trim();
}

/**
 * 若 `dataType` 与 `list` 中某项仅大小写不同，则改为列表中的写法；不在列表中时保留用户输入（支持 integer[][] 等）。
 */
export function reconcileColumnDataTypesToDbList(columns: TableColumn[], list: string[]): void {
  if (list.length === 0) return;
  const byLower = new Map(list.map((t) => [t.toLowerCase(), t]));
  for (const col of columns) {
    const key = col.dataType.trim().toLowerCase();
    const canon = byLower.get(key);
    if (canon) col.dataType = canon;
  }
}

/** 表设计器：`db/data-types` 返回列表去重、排序（完全以库为准） */
export function normalizeDbDataTypesList(fromDb: string[] | undefined): string[] {
  const raw = fromDb?.map((t) => String(t).trim()).filter(Boolean) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}
