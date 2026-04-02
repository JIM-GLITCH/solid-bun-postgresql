/**
 * MySQL 查询结果列：根据 Field 元数据 + information_schema 判断是否可编辑（需主键/唯一键列均在结果中）。
 */
import type { FieldPacket } from "mysql2";
import type { Pool } from "mysql2/promise";
import type { ColumnEditableInfo } from "../shared/src";

function backtickIdent(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}

const SEP = "\x1e";

function instKey(db: string, orgTable: string, alias: string): string {
  return `${db}${SEP}${orgTable}${SEP}${alias}`;
}

function tableKey(db: string, orgTable: string): string {
  return `${db}${SEP}${orgTable}`;
}

interface ConstraintRow {
  table_schema: string;
  table_name: string;
  constraint_type: string;
  constraint_name: string;
  column_name: string;
  ordinal_position: number;
}

interface NullableRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  is_nullable: string;
}

/** mysql2 协议列类型码 → 表头展示用名称（与 information_schema 略不同，仅作提示） */
const MYSQL_TYPE_LABEL: Record<number, string> = {
  0x00: "decimal",
  0x01: "tinyint",
  0x02: "smallint",
  0x03: "int",
  0x04: "float",
  0x05: "double",
  0x06: "null",
  0x07: "timestamp",
  0x08: "bigint",
  0x09: "mediumint",
  0x0a: "date",
  0x0b: "time",
  0x0c: "datetime",
  0x0d: "year",
  0x0e: "date",
  0x0f: "varchar",
  0x10: "bit",
  0xf2: "vector",
  0xf5: "json",
  0xf6: "decimal",
  0xf7: "enum",
  0xf8: "set",
  0xf9: "tinyblob",
  0xfa: "mediumblob",
  0xfb: "longblob",
  0xfc: "blob",
  0xfd: "varchar",
  0xfe: "char",
  0xff: "geometry",
};

function mysqlFieldDataTypeLabel(f: FieldPacket): string {
  const tn = f.typeName != null ? String(f.typeName).trim() : "";
  if (tn) return tn.toLowerCase();

  const codeRaw = f.columnType ?? f.type;
  const code = typeof codeRaw === "number" ? codeRaw : NaN;
  if (!Number.isFinite(code)) return "";

  let base = MYSQL_TYPE_LABEL[code] ?? `type_0x${code.toString(16)}`;
  const maxLen = f.columnLength ?? f.length;
  if (maxLen != null && maxLen > 0 && (code === 0xfd || code === 0xfe || code === 0x0f)) {
    base = `${base}(${maxLen})`;
  }
  if ((code === 0x00 || code === 0xf6) && f.length != null && f.decimals != null) {
    base = `${base}(${f.length},${f.decimals})`;
  }
  return base;
}

export async function calculateMysqlColumnEditable(
  pool: Pool,
  fields: FieldPacket[],
  fallbackDb: string | undefined
): Promise<ColumnEditableInfo[]> {
  if (!fields.length) return [];

  const base: ColumnEditableInfo[] = fields.map((f) => ({
    name: String(f.name),
    tableID: 0,
    columnID: 0,
    isEditable: false,
    dataTypeOid: undefined,
    dataTypeLabel: mysqlFieldDataTypeLabel(f),
    sqlDialect: "mysql" as const,
  }));

  const physical = fields.map((f) => {
    const db =
      (f.db != null && String(f.db).trim()) ||
      (f.schema != null && String(f.schema).trim()) ||
      (fallbackDb != null && String(fallbackDb).trim()) ||
      "";
    const orgTable = f.orgTable != null ? String(f.orgTable) : "";
    const orgName = f.orgName != null ? String(f.orgName) : "";
    const alias = f.table != null ? String(f.table) : "";
    return { db, orgTable, orgName, alias };
  });

  /** 每个「表实例」（库+物理表+别名）→ 物理列名 → 结果列下标 */
  const instances = new Map<string, Map<string, number[]>>();
  for (let i = 0; i < fields.length; i++) {
    const p = physical[i];
    if (!p.db || !p.orgTable || !p.orgName) continue;
    const ik = instKey(p.db, p.orgTable, p.alias);
    if (!instances.has(ik)) instances.set(ik, new Map());
    const m = instances.get(ik)!;
    if (!m.has(p.orgName)) m.set(p.orgName, []);
    m.get(p.orgName)!.push(i);
  }

  const tableKeys = new Set<string>();
  for (const p of physical) {
    if (p.db && p.orgTable) tableKeys.add(tableKey(p.db, p.orgTable));
  }

  const pairs: [string, string][] = [...tableKeys].map((k) => {
    const [db, tbl] = k.split(SEP);
    return [db, tbl];
  });

  const constraintsByTable = new Map<string, { type: string; columns: string[] }[]>();
  const nullableByTable = new Map<string, Map<string, boolean>>();

  if (pairs.length > 0) {
    const orTc = pairs.map(() => "(tc.table_schema = ? AND tc.table_name = ?)").join(" OR ");
    const tcParams = pairs.flatMap(([db, tbl]) => [db, tbl]);

    const [cRows] = await pool.query<ConstraintRow[]>(
      `SELECT tc.table_schema AS table_schema, tc.table_name AS table_name,
              tc.constraint_type AS constraint_type, tc.constraint_name AS constraint_name,
              kcu.column_name AS column_name, kcu.ordinal_position AS ordinal_position
       FROM information_schema.table_constraints tc
       INNER JOIN information_schema.key_column_usage kcu
         ON tc.constraint_schema = kcu.constraint_schema
         AND tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
         AND tc.table_name = kcu.table_name
       WHERE (${orTc})
         AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
       ORDER BY tc.table_schema, tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position`,
      tcParams
    );

    const byConstraint = new Map<string, ConstraintRow[]>();
    for (const r of cRows ?? []) {
      const tk = tableKey(String(r.table_schema), String(r.table_name));
      const ck = `${tk}${SEP}${String(r.constraint_name)}`;
      if (!byConstraint.has(ck)) byConstraint.set(ck, []);
      byConstraint.get(ck)!.push(r);
    }

    for (const [, rows] of byConstraint) {
      if (!rows.length) continue;
      const tk = tableKey(String(rows[0].table_schema), String(rows[0].table_name));
      const type = String(rows[0].constraint_type);
      const cols = [...rows].sort((a, b) => Number(a.ordinal_position) - Number(b.ordinal_position)).map((x) => String(x.column_name));
      if (!constraintsByTable.has(tk)) constraintsByTable.set(tk, []);
      constraintsByTable.get(tk)!.push({ type, columns: cols });
    }

    for (const [, list] of constraintsByTable) {
      list.sort((a, b) => {
        if (a.type === "PRIMARY KEY" && b.type !== "PRIMARY KEY") return -1;
        if (a.type !== "PRIMARY KEY" && b.type === "PRIMARY KEY") return 1;
        return 0;
      });
    }

    const orCol = pairs.map(() => "(table_schema = ? AND table_name = ?)").join(" OR ");
    const colParams = pairs.flatMap(([db, tbl]) => [db, tbl]);

    const [nRows] = await pool.query<NullableRow[]>(
      `SELECT table_schema AS table_schema, table_name AS table_name,
              column_name AS column_name, is_nullable AS is_nullable
       FROM information_schema.columns
       WHERE ${orCol}`,
      colParams
    );

    for (const r of nRows ?? []) {
      const tk = tableKey(String(r.table_schema), String(r.table_name));
      if (!nullableByTable.has(tk)) nullableByTable.set(tk, new Map());
      nullableByTable.get(tk)!.set(String(r.column_name), String(r.is_nullable).toUpperCase() === "YES");
    }
  }

  for (let i = 0; i < fields.length; i++) {
    const p = physical[i];
    if (!p.db || !p.orgTable || !p.orgName) continue;
    const tk = tableKey(p.db, p.orgTable);
    base[i].tableName = `${backtickIdent(p.db)}.${backtickIdent(p.orgTable)}`;
    base[i].columnName = backtickIdent(p.orgName);
    base[i].tableAlias = p.alias || undefined;
    const nm = nullableByTable.get(tk)?.get(p.orgName);
    if (nm !== undefined) base[i].nullable = nm;
  }

  for (const [ik, colMap] of instances) {
    const segs = ik.split(SEP);
    const db = segs[0] ?? "";
    const orgTable = segs[1] ?? "";
    const tk = tableKey(db, orgTable);
    const clist = constraintsByTable.get(tk);
    if (!clist?.length) continue;

    for (const constraint of clist) {
      if (!constraint.columns.every((c) => colMap.has(c))) continue;

      const uniqueKeyColumns = constraint.columns.map((c) => backtickIdent(c));
      const uniqueKeyFieldIndices = constraint.columns.map((c) => colMap.get(c)?.[0] ?? -1);
      if (uniqueKeyFieldIndices.some((x) => x < 0)) break;

      for (const idxs of colMap.values()) {
        for (const fi of idxs) {
          base[fi].isEditable = true;
          base[fi].uniqueKeyColumns = uniqueKeyColumns;
          base[fi].uniqueKeyFieldIndices = uniqueKeyFieldIndices;
        }
      }
      break;
    }
  }

  return base;
}
