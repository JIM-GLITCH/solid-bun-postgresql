/**
 * 表设计器 - 新建表/编辑表 共享逻辑
 */

export interface TableColumn {
  name: string;
  dataType: string;
  length?: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
  isNew?: boolean;
}

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

export const TYPES_NEEDING_LENGTH = ["varchar", "char", "character varying", "character", "numeric", "decimal"];
export const DEFAULT_VALUE_RAW_RE = /^\w+\(\)$|^['"]/;
export const COMMON_TYPES = ["integer", "bigint", "smallint", "serial", "bigserial", "real", "double precision", "numeric", "varchar", "char", "text", "boolean", "date", "timestamp", "timestamptz", "jsonb", "uuid"];

export function needsLength(type: string): boolean {
  const lower = type.toLowerCase();
  return TYPES_NEEDING_LENGTH.some((t) => lower.includes(t));
}

export function formatDefaultValue(d: string): string {
  return DEFAULT_VALUE_RAW_RE.test(d) ? d : "'" + d.replace(/'/g, "''") + "'";
}

export function buildCreateTableSql(
  schema: string,
  tableName: string,
  columns: TableColumn[],
  constraints?: {
    unique?: UniqueConstraint[];
    check?: CheckConstraint[];
    foreignKey?: ForeignKeyConstraint[];
  }
): string {
  if (!tableName.trim()) return "";
  const validColumns = columns.filter((c) => c.name.trim());
  if (validColumns.length === 0) return "";

  const parts = validColumns.map((c) => {
    let def = `"${c.name}" ${c.dataType}`;
    if (needsLength(c.dataType) && c.length?.trim()) def += `(${c.length})`;
    if (!c.nullable) def += " NOT NULL";
    if (c.primaryKey) def += " PRIMARY KEY";
    if (c.defaultValue.trim()) {
      def += ` DEFAULT ${formatDefaultValue(c.defaultValue.trim())}`;
    }
    return def;
  });

  if (constraints?.unique?.length) {
    for (const u of constraints.unique) {
      const cols = u.columns.split(",").map((s) => s.trim()).filter(Boolean);
      if (cols.length) parts.push(`UNIQUE (${cols.map((c) => `"${c}"`).join(", ")})`);
    }
  }
  if (constraints?.check?.length) {
    for (const c of constraints.check) {
      if (c.expression.trim()) parts.push(`CHECK (${c.expression})`);
    }
  }
  if (constraints?.foreignKey?.length) {
    for (const fk of constraints.foreignKey) {
      if (fk.column.trim() && fk.refTable.trim() && fk.refColumn.trim()) {
        const ref = fk.refSchema.trim() ? `"${fk.refSchema}"."${fk.refTable}"` : `"${fk.refTable}"`;
        parts.push(`FOREIGN KEY ("${fk.column}") REFERENCES ${ref} ("${fk.refColumn}")`);
      }
    }
  }

  return `CREATE TABLE "${schema}"."${tableName}" (\n  ${parts.join(",\n  ")}\n);`;
}

export function buildAlterTableSql(
  schema: string,
  tableName: string,
  originalColumns: TableColumn[],
  newColumns: TableColumn[]
): string[] {
  const sqls: string[] = [];
  const origMap = new Map(originalColumns.map((c) => [c.name.toLowerCase(), c]));
  const newMap = new Map(newColumns.filter((c) => c.name.trim()).map((c) => [c.name.toLowerCase(), c]));
  const qualified = `"${schema}"."${tableName}"`;

  for (const col of newColumns) {
    if (!col.name.trim()) continue;
    const key = col.name.toLowerCase();
    const orig = origMap.get(key);
    if (!orig) {
      let def = `"${col.name}" ${col.dataType}`;
      if (needsLength(col.dataType) && col.length?.trim()) def += `(${col.length})`;
      if (!col.nullable) def += " NOT NULL";
      if (col.defaultValue.trim()) {
        def += ` DEFAULT ${formatDefaultValue(col.defaultValue.trim())}`;
      }
      sqls.push(`ALTER TABLE ${qualified} ADD COLUMN ${def};`);
    } else if (
      orig.dataType !== col.dataType ||
      (needsLength(col.dataType) && orig.length !== col.length) ||
      orig.nullable !== col.nullable ||
      orig.defaultValue !== col.defaultValue ||
      orig.primaryKey !== col.primaryKey
    ) {
      if (orig.primaryKey && !col.primaryKey) {
        sqls.push(`ALTER TABLE ${qualified} DROP CONSTRAINT "${tableName}_pkey";`);
      }
      if (!orig.primaryKey && col.primaryKey) {
        sqls.push(`ALTER TABLE ${qualified} ADD PRIMARY KEY ("${col.name}");`);
      }
      if (orig.dataType !== col.dataType || (needsLength(col.dataType) && orig.length !== col.length)) {
        let typeStr = col.dataType;
        if (needsLength(col.dataType) && col.length?.trim()) typeStr += `(${col.length})`;
        sqls.push(`ALTER TABLE ${qualified} ALTER COLUMN "${col.name}" TYPE ${typeStr};`);
      }
      if (orig.nullable !== col.nullable) {
        sqls.push(`ALTER TABLE ${qualified} ALTER COLUMN "${col.name}" ${col.nullable ? "DROP" : "SET"} NOT NULL;`);
      }
      if (orig.defaultValue !== col.defaultValue) {
        const d = col.defaultValue.trim();
        if (d) {
          sqls.push(`ALTER TABLE ${qualified} ALTER COLUMN "${col.name}" SET DEFAULT ${formatDefaultValue(d)};`);
        } else {
          sqls.push(`ALTER TABLE ${qualified} ALTER COLUMN "${col.name}" DROP DEFAULT;`);
        }
      }
    }
  }

  for (const [name] of origMap) {
    if (!newMap.has(name)) {
      sqls.push(`ALTER TABLE ${qualified} DROP COLUMN "${originalColumns.find((c) => c.name.toLowerCase() === name)!.name}";`);
    }
  }
  return sqls;
}
