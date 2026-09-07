/**
 * SQL Server 查询结果列：根据 TDS 列元数据 + browse（sys.dm_exec_describe_first_result_set）
 * + INFORMATION_SCHEMA 主键/唯一键，判断结果列是否可编辑（与 MySQL 逻辑同构）。
 *
 * 逻辑忠实复刻自已删除的 sqlserver-db-handlers.ts，供新 Effect query-stream handler 复用。
 */
import sql from "mssql";
import type { ColumnEditableInfo } from "../shared/src";
import {
  normalizeMssqlJsType,
  type SqlServerColumnMeta,
} from "./sqlserver-mssql-query";

/**
 * 与 `mssql/lib/datatypes` 的 `declare()` 规则一致，生成表头展示用类型字符串。
 * 直接读 `SqlServerColumnMeta`（驱动列经 `mssqlRecordsetColumnsToSqlServerMeta` 一次转换即可）。
 */
function mssqlColumnDataTypeLabel(col: SqlServerColumnMeta): string {
  const udtName = col.udt?.name != null ? String(col.udt.name).trim() : "";
  const tRaw = col.mssqlType as ({ declaration?: string } & ((...args: unknown[]) => unknown)) | undefined;
  const decl = tRaw?.declaration != null ? String(tRaw.declaration) : "";
  const t = normalizeMssqlJsType(col.mssqlType);
  const L = col.dataLength;
  const prec = col.precision;
  const sc = col.scale;

  if (t == null) return decl || udtName || "unknown";

  if (t === sql.TYPES.VarChar || t === sql.TYPES.VarBinary) {
    const len = L == null || L > 8000 ? "MAX" : String(L);
    return `${decl}(${len})`;
  }
  if (t === sql.TYPES.NVarChar) {
    const len = L == null || L > 4000 ? "MAX" : String(L);
    return `${decl}(${len})`;
  }
  if (t === sql.TYPES.Char || t === sql.TYPES.NChar || t === sql.TYPES.Binary) {
    return `${decl}(${L == null ? 1 : L})`;
  }
  if (t === sql.TYPES.Decimal || t === sql.TYPES.Numeric) {
    const p = prec == null ? 18 : prec;
    const s = sc == null ? 0 : sc;
    return `${decl}(${p}, ${s})`;
  }
  if (t === sql.TYPES.Time || t === sql.TYPES.DateTime2 || t === sql.TYPES.DateTimeOffset) {
    const scale = sc == null ? 7 : sc;
    return `${decl}(${scale})`;
  }
  if (t === sql.TYPES.UDT && udtName) return udtName;
  if (decl) return decl;
  return udtName || "unknown";
}

function columnEditableFromSqlServerMeta(col: SqlServerColumnMeta, columnID: number): ColumnEditableInfo {
  const out: ColumnEditableInfo = {
    name: col.colName,
    tableID: 0,
    columnID,
    isEditable: false,
    dataTypeLabel: mssqlColumnDataTypeLabel(col),
    sqlDialect: "sqlserver",
  };
  out.nullable = !!(col.flags & 0x01);
  return out;
}

const TDS_INST_SEP = "\x1e";

function bracketIdentSqlServer(id: string): string {
  return "[" + id.replace(/\]/g, "]]") + "]";
}

function parseTdsTableParts(col: SqlServerColumnMeta): { schema: string; table: string } | undefined {
  const tn = col.tableName;
  const parts = Array.isArray(tn)
    ? tn.filter(Boolean).map((x) => String(x))
    : tn != null && String(tn).length > 0
      ? [String(tn)]
      : [];
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return { schema: "dbo", table: parts[0]! };
  if (parts.length === 2) return { schema: parts[0]!, table: parts[1]! };
  return { schema: parts[parts.length - 2]!, table: parts[parts.length - 1]! };
}

function tdsTableKey(schema: string, table: string): string {
  return `${schema}${TDS_INST_SEP}${table}`;
}

interface MssqlConstraintRow {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  CONSTRAINT_TYPE: string;
  CONSTRAINT_NAME: string;
  COLUMN_NAME: string;
  ORDINAL_POSITION: number;
}

interface MssqlNullableRow {
  TABLE_SCHEMA: string;
  TABLE_NAME: string;
  COLUMN_NAME: string;
  IS_NULLABLE: string;
}

/** sys.dm_exec_describe_first_result_set（browse=1）可见列，补全 TDS 中缺失的 source 表信息 */
interface SqlServerBrowseColumnMeta {
  columnOrdinal: number;
  resultName: string | null;
  sourceSchema: string | null;
  sourceTable: string | null;
  sourceColumn: string | null;
  isComputedColumn: boolean | null;
  isIdentityColumn: boolean | null;
}

async function fetchSqlServerBrowseColumnMetadata(
  pool: sql.ConnectionPool,
  sqlText: string
): Promise<SqlServerBrowseColumnMeta[] | undefined> {
  if (!sqlText.trim()) return undefined;
  try {
    const req = pool.request();
    req.input("batch", sql.NVarChar(sql.MAX), sqlText);
    // DMV 返回「每列一行」；会话若残留 ROWCOUNT，结果行会被截断 → browse 错位，故先 SET ROWCOUNT 0
    const r = await req.query(`
      SET ROWCOUNT 0;
      SELECT column_ordinal AS columnOrdinal,
             name AS resultName,
             source_schema AS sourceSchema,
             source_table AS sourceTable,
             source_column AS sourceColumn,
             is_computed_column AS isComputedColumn,
             is_identity_column AS isIdentityColumn
      FROM sys.dm_exec_describe_first_result_set(@batch, NULL, 1) AS d
      WHERE d.error_number IS NULL AND d.is_hidden = 0
      ORDER BY d.column_ordinal
    `);
    const rows = (r.recordset ?? []) as SqlServerBrowseColumnMeta[];
    return rows.length > 0 ? rows : undefined;
  } catch {
    return undefined;
  }
}

function indexBrowseMetadataByResultColumn(
  tdsCount: number,
  browseRows: SqlServerBrowseColumnMeta[] | undefined
): (SqlServerBrowseColumnMeta | undefined)[] {
  const out: (SqlServerBrowseColumnMeta | undefined)[] = Array.from({ length: tdsCount }, () => undefined);
  if (!browseRows?.length) return out;
  const byOrd = new Map<number, SqlServerBrowseColumnMeta>();
  for (const row of browseRows) {
    byOrd.set(row.columnOrdinal, row);
  }
  for (let i = 0; i < tdsCount; i++) {
    out[i] = byOrd.get(i + 1);
  }
  return out;
}

function resolveSqlServerBaseTable(
  tcol: SqlServerColumnMeta,
  browse: SqlServerBrowseColumnMeta | undefined
): { schema: string; table: string } | undefined {
  const tds = parseTdsTableParts(tcol);
  if (tds) return tds;
  const s = browse?.sourceSchema?.trim();
  const t = browse?.sourceTable?.trim();
  if (s && t) return { schema: s, table: t };
  return undefined;
}

function sqlServerPhysicalColumnName(
  tcol: SqlServerColumnMeta,
  browse: SqlServerBrowseColumnMeta | undefined
): string {
  const sc = browse?.sourceColumn?.trim();
  if (sc) return sc;
  return String(tcol.colName || "");
}

/**
 * 根据 TDS 表名（仅 text/ntext/image）或 browse 元数据 + INFORMATION_SCHEMA 主键/唯一键，
 * 填充 tableName、uniqueKey*、isEditable（与 MySQL 逻辑同构）。
 */
async function enrichSqlServerQueryColumnsEditable(
  pool: sql.ConnectionPool,
  base: ColumnEditableInfo[],
  columnMeta: SqlServerColumnMeta[],
  browseRows?: SqlServerBrowseColumnMeta[]
): Promise<ColumnEditableInfo[]> {
  if (base.length !== columnMeta.length || base.length === 0) return base;

  const browseByIndex = indexBrowseMetadataByResultColumn(columnMeta.length, browseRows);

  const instances = new Map<string, Map<string, number[]>>();
  for (let i = 0; i < columnMeta.length; i++) {
    const tcol = columnMeta[i]!;
    const tab = resolveSqlServerBaseTable(tcol, browseByIndex[i]);
    if (!tab) continue;
    const orgName = sqlServerPhysicalColumnName(tcol, browseByIndex[i]);
    if (!orgName) continue;
    const ik = `${tab.schema}${TDS_INST_SEP}${tab.table}${TDS_INST_SEP}`;
    if (!instances.has(ik)) instances.set(ik, new Map());
    const m = instances.get(ik)!;
    if (!m.has(orgName)) m.set(orgName, []);
    m.get(orgName)!.push(i);
  }

  const tableKeys = new Set<string>();
  for (let i = 0; i < columnMeta.length; i++) {
    const tab = resolveSqlServerBaseTable(columnMeta[i]!, browseByIndex[i]);
    if (tab) tableKeys.add(tdsTableKey(tab.schema, tab.table));
  }

  const pairs = [...tableKeys].map((k) => {
    const [schema, tbl] = k.split(TDS_INST_SEP);
    return { schema: schema!, table: tbl! };
  });

  const constraintsByTable = new Map<string, { type: string; columns: string[] }[]>();
  const nullableByTable = new Map<string, Map<string, boolean>>();

  if (pairs.length > 0) {
    const reqConstraints = pool.request();
    const orTc = pairs.map((_, i) => `(tc.TABLE_SCHEMA = @s${i} AND tc.TABLE_NAME = @t${i})`).join(" OR ");
    for (let i = 0; i < pairs.length; i++) {
      reqConstraints.input(`s${i}`, sql.NVarChar, pairs[i]!.schema);
      reqConstraints.input(`t${i}`, sql.NVarChar, pairs[i]!.table);
    }
    const cSql = `
      SELECT tc.TABLE_SCHEMA AS TABLE_SCHEMA, tc.TABLE_NAME AS TABLE_NAME,
             tc.CONSTRAINT_TYPE AS CONSTRAINT_TYPE, tc.CONSTRAINT_NAME AS CONSTRAINT_NAME,
             kcu.COLUMN_NAME AS COLUMN_NAME, kcu.ORDINAL_POSITION AS ORDINAL_POSITION
      FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
      INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
        ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
        AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
      WHERE (${orTc})
        AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
      ORDER BY tc.TABLE_SCHEMA, tc.TABLE_NAME, tc.CONSTRAINT_TYPE, tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`;
    const cResult = await reqConstraints.query(cSql);
    const cRows = (cResult.recordset ?? []) as MssqlConstraintRow[];

    const byConstraint = new Map<string, MssqlConstraintRow[]>();
    for (const r of cRows) {
      const tk = tdsTableKey(String(r.TABLE_SCHEMA), String(r.TABLE_NAME));
      const ck = `${tk}${TDS_INST_SEP}${String(r.CONSTRAINT_NAME)}`;
      if (!byConstraint.has(ck)) byConstraint.set(ck, []);
      byConstraint.get(ck)!.push(r);
    }

    for (const [, rows] of byConstraint) {
      if (!rows.length) continue;
      const tk = tdsTableKey(String(rows[0].TABLE_SCHEMA), String(rows[0].TABLE_NAME));
      const ctype = String(rows[0].CONSTRAINT_TYPE);
      const cols = [...rows]
        .sort((a, b) => Number(a.ORDINAL_POSITION) - Number(b.ORDINAL_POSITION))
        .map((x) => String(x.COLUMN_NAME));
      if (!constraintsByTable.has(tk)) constraintsByTable.set(tk, []);
      constraintsByTable.get(tk)!.push({ type: ctype, columns: cols });
    }

    for (const [, list] of constraintsByTable) {
      list.sort((a, b) => {
        if (a.type === "PRIMARY KEY" && b.type !== "PRIMARY KEY") return -1;
        if (a.type !== "PRIMARY KEY" && b.type === "PRIMARY KEY") return 1;
        return 0;
      });
    }

    const reqNull = pool.request();
    const orCol = pairs.map((_, i) => `(TABLE_SCHEMA = @ns${i} AND TABLE_NAME = @nt${i})`).join(" OR ");
    for (let i = 0; i < pairs.length; i++) {
      reqNull.input(`ns${i}`, sql.NVarChar, pairs[i]!.schema);
      reqNull.input(`nt${i}`, sql.NVarChar, pairs[i]!.table);
    }
    const nSql = `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS WHERE ${orCol}`;
    const nResult = await reqNull.query(nSql);
    const nRows = (nResult.recordset ?? []) as MssqlNullableRow[];

    for (const r of nRows) {
      const tk = tdsTableKey(String(r.TABLE_SCHEMA), String(r.TABLE_NAME));
      if (!nullableByTable.has(tk)) nullableByTable.set(tk, new Map());
      nullableByTable.get(tk)!.set(String(r.COLUMN_NAME), String(r.IS_NULLABLE).toUpperCase() === "YES");
    }
  }

  for (let i = 0; i < columnMeta.length; i++) {
    const tcol = columnMeta[i]!;
    const tab = resolveSqlServerBaseTable(tcol, browseByIndex[i]);
    if (!tab) continue;
    const tk = tdsTableKey(tab.schema, tab.table);
    const physName = sqlServerPhysicalColumnName(tcol, browseByIndex[i]);
    if (!physName) continue;
    base[i].tableName = `${bracketIdentSqlServer(tab.schema)}.${bracketIdentSqlServer(tab.table)}`;
    base[i].columnName = bracketIdentSqlServer(physName);
    const nm = nullableByTable.get(tk)?.get(physName);
    if (nm !== undefined) base[i].nullable = nm;
  }

  for (const [ik, colMap] of instances) {
    const segs = ik.split(TDS_INST_SEP);
    const schema = segs[0] ?? "";
    const orgTable = segs[1] ?? "";
    const tk = tdsTableKey(schema, orgTable);
    const clist = constraintsByTable.get(tk);
    if (!clist?.length) continue;

    for (const constraint of clist) {
      if (!constraint.columns.every((c) => colMap.has(c))) continue;

      const uniqueKeyColumns = constraint.columns.map((c) => bracketIdentSqlServer(c));
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

  // TDS usUpdateable（flags bit 2，即 0x0c）在单表 SELECT 结果里常为 ReadOnly；
  // 网格编辑走带唯一键的 UPDATE，不依赖可更新游标，故不能据此关掉 isEditable。
  for (let i = 0; i < columnMeta.length; i++) {
    const f = columnMeta[i]!.flags;
    const br = browseByIndex[i];
    if (f & 0x20 || br?.isComputedColumn) base[i].isEditable = false; // fComputed（TDS 7.2+）
    if (f & 0x20 || br?.isComputedColumn === true) base[i].omitFromInsert = true;
    if (f & 0x10 || br?.isIdentityColumn === true) base[i].omitFromInsert = true; // fIdentity
  }

  return base;
}

/**
 * 由 TDS 列元数据构建网格结果列的可编辑信息（base + browse 补全 + 约束 enrich）。
 * @param columnMeta   `runSqlServerQueryWithColumnMetadata` 返回的 TDS 列元数据
 * @param browseSourceSql 用于 sys.dm_exec_describe_first_result_set 的单条 SELECT（须与结果集一致）
 */
export async function buildSqlServerGridColumnEditable(
  pool: sql.ConnectionPool,
  columnMeta: SqlServerColumnMeta[],
  browseSourceSql: string
): Promise<ColumnEditableInfo[]> {
  if (!columnMeta.length) return [];
  const base = columnMeta.map((col, idx) => columnEditableFromSqlServerMeta(col, idx + 1));
  const browseRows = await fetchSqlServerBrowseColumnMetadata(pool, browseSourceSql);
  return enrichSqlServerQueryColumnsEditable(pool, base, columnMeta, browseRows);
}
