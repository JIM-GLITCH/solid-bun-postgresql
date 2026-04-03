/**
 * Microsoft SQL Server：node-mssql（tedious）
 */
import sql from "mssql";
import { TYPES as TediousTYPES } from "tedious";
import type {
  ColumnEditableInfo,
  ConnectDbRequest,
  DatabaseCapabilities,
  DbKind,
  PostgresLoginParams,
  SSEMessage,
} from "../shared/src";
import { getSqlSegments } from "../shared/src";
import { getSqlServerDbConfig, openSqlServerPool } from "./connect-sqlserver";
import type { SessionConnection, SqlServerSessionConnection } from "./session-connection";
import { runSqlServerQueryWithTdsMetadata, type SqlServerTdsColumnMeta } from "./sqlserver-tedious-query";

function sqlServerSession(getSWithDb: (cid: string) => SessionConnection, cid: string): SqlServerSessionConnection {
  const s = getSWithDb(cid);
  if (s.dbKind !== "sqlserver") throw new Error("内部错误：期望 SQL Server 会话");
  return s;
}

function getStatementsFromSql(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}

/** node-mssql（tedious）挂在 recordset.columns 上的单列元数据 */
type MssqlRecordsetColumnMeta = {
  index?: number;
  name?: string;
  length?: number;
  type?: unknown;
  scale?: number;
  precision?: number;
  nullable?: boolean;
  udt?: { name?: string; database?: string; schema?: string; assembly?: string };
};

function resolveMssqlColumnMeta(
  colMeta: Record<string, MssqlRecordsetColumnMeta> | MssqlRecordsetColumnMeta[] | undefined,
  name: string,
  idx: number
): MssqlRecordsetColumnMeta {
  if (!colMeta) return {};
  if (Array.isArray(colMeta)) return colMeta[idx] ?? {};
  const m = colMeta[name];
  return m != null && typeof m === "object" ? m : {};
}

/**
 * 与 `mssql/lib/datatypes` 中 `declare()` 规则一致，生成表头展示用类型字符串。
 */
function mssqlColumnDataTypeLabel(col: MssqlRecordsetColumnMeta): string {
  const udtName = col.udt?.name != null ? String(col.udt.name).trim() : "";
  const t = col.type as ({ declaration?: string } & ((...args: unknown[]) => unknown)) | undefined;
  const decl = t?.declaration != null ? String(t.declaration) : "";
  const L = col.length;
  const prec = col.precision;
  const sc = col.scale;

  if (t == null) return udtName || "unknown";

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

function columnEditableFromMssqlMeta(
  name: string,
  columnID: number,
  meta: MssqlRecordsetColumnMeta
): ColumnEditableInfo {
  const col: ColumnEditableInfo = {
    name,
    tableID: 0,
    columnID,
    isEditable: false,
    dataTypeLabel: mssqlColumnDataTypeLabel(meta),
    sqlDialect: "sqlserver",
  };
  if (typeof meta.nullable === "boolean") col.nullable = meta.nullable;
  return col;
}

const TDS_INST_SEP = "\x1e";

function bracketIdentSqlServer(id: string): string {
  return "[" + id.replace(/\]/g, "]]") + "]";
}

/** tedious 列元数据 → 与 node-mssql recordset.columns 一致的 type 映射（用于 dataTypeLabel） */
function tediousColumnToMssqlRecordsetMeta(col: SqlServerTdsColumnMeta): MssqlRecordsetColumnMeta {
  const t = col.type;
  const L = col.dataLength;
  let mssqlType: unknown;
  if (typeof t === "object" && t !== null) {
    const T = TediousTYPES;
    switch (t) {
      case T.Char:
        mssqlType = sql.TYPES.Char;
        break;
      case T.NChar:
        mssqlType = sql.TYPES.NChar;
        break;
      case T.VarChar:
        mssqlType = sql.TYPES.VarChar;
        break;
      case T.NVarChar:
        mssqlType = sql.TYPES.NVarChar;
        break;
      case T.Text:
        mssqlType = sql.TYPES.Text;
        break;
      case T.NText:
        mssqlType = sql.TYPES.NText;
        break;
      case T.Int:
        mssqlType = sql.TYPES.Int;
        break;
      case T.BigInt:
        mssqlType = sql.TYPES.BigInt;
        break;
      case T.TinyInt:
        mssqlType = sql.TYPES.TinyInt;
        break;
      case T.SmallInt:
        mssqlType = sql.TYPES.SmallInt;
        break;
      case T.Bit:
        mssqlType = sql.TYPES.Bit;
        break;
      case T.Float:
        mssqlType = sql.TYPES.Float;
        break;
      case T.Real:
        mssqlType = sql.TYPES.Real;
        break;
      case T.Money:
        mssqlType = sql.TYPES.Money;
        break;
      case T.SmallMoney:
        mssqlType = sql.TYPES.SmallMoney;
        break;
      case T.Numeric:
        mssqlType = sql.TYPES.Numeric;
        break;
      case T.Decimal:
        mssqlType = sql.TYPES.Decimal;
        break;
      case T.DateTime:
        mssqlType = sql.TYPES.DateTime;
        break;
      case T.Time:
        mssqlType = sql.TYPES.Time;
        break;
      case T.Date:
        mssqlType = sql.TYPES.Date;
        break;
      case T.DateTime2:
        mssqlType = sql.TYPES.DateTime2;
        break;
      case T.DateTimeOffset:
        mssqlType = sql.TYPES.DateTimeOffset;
        break;
      case T.SmallDateTime:
        mssqlType = sql.TYPES.SmallDateTime;
        break;
      case T.UniqueIdentifier:
        mssqlType = sql.TYPES.UniqueIdentifier;
        break;
      case T.Image:
        mssqlType = sql.TYPES.Image;
        break;
      case T.Binary:
        mssqlType = sql.TYPES.Binary;
        break;
      case T.VarBinary:
        mssqlType = sql.TYPES.VarBinary;
        break;
      case T.Xml:
        mssqlType = sql.TYPES.Xml;
        break;
      case T.UDT:
        mssqlType = sql.TYPES.UDT;
        break;
      case T.TVP:
        mssqlType = sql.TYPES.TVP;
        break;
      case T.Variant:
        mssqlType = sql.TYPES.Variant;
        break;
      default: {
        const id = (t as { id?: number }).id;
        if (id === 0x68) mssqlType = sql.TYPES.Bit;
        else if (id === 0x6c) mssqlType = sql.TYPES.Numeric;
        else if (id === 0x6a) mssqlType = sql.TYPES.Decimal;
        else if (id === 0x26) {
          if (L === 8) mssqlType = sql.TYPES.BigInt;
          else if (L === 4) mssqlType = sql.TYPES.Int;
          else if (L === 2) mssqlType = sql.TYPES.SmallInt;
          else mssqlType = sql.TYPES.TinyInt;
        } else if (id === 0x6d) mssqlType = L === 8 ? sql.TYPES.Float : sql.TYPES.Real;
        else if (id === 0x6e) mssqlType = L === 8 ? sql.TYPES.Money : sql.TYPES.SmallMoney;
        else if (id === 0x6f) mssqlType = L === 8 ? sql.TYPES.DateTime : sql.TYPES.SmallDateTime;
        break;
      }
    }
  }
  return {
    length: L,
    type: mssqlType,
    precision: col.precision,
    scale: col.scale,
    nullable: !!(col.flags & 0x01),
    udt: col.udtInfo ? { name: col.udtInfo.typeName } : undefined,
  };
}

function parseTdsTableParts(col: SqlServerTdsColumnMeta): { schema: string; table: string } | undefined {
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

/** 根据 TDS 表名 + INFORMATION_SCHEMA 主键/唯一键，填充 tableName、uniqueKey*、isEditable（与 MySQL 逻辑同构） */
async function enrichSqlServerQueryColumnsEditable(
  pool: sql.ConnectionPool,
  base: ColumnEditableInfo[],
  tdsColumns: SqlServerTdsColumnMeta[]
): Promise<ColumnEditableInfo[]> {
  if (base.length !== tdsColumns.length || base.length === 0) return base;

  const instances = new Map<string, Map<string, number[]>>();
  for (let i = 0; i < tdsColumns.length; i++) {
    const tcol = tdsColumns[i]!;
    const tab = parseTdsTableParts(tcol);
    if (!tab) continue;
    const orgName = String(tcol.colName || "");
    if (!orgName) continue;
    const ik = `${tab.schema}${TDS_INST_SEP}${tab.table}${TDS_INST_SEP}`;
    if (!instances.has(ik)) instances.set(ik, new Map());
    const m = instances.get(ik)!;
    if (!m.has(orgName)) m.set(orgName, []);
    m.get(orgName)!.push(i);
  }

  const tableKeys = new Set<string>();
  for (const tcol of tdsColumns) {
    const tab = parseTdsTableParts(tcol);
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

  for (let i = 0; i < tdsColumns.length; i++) {
    const tcol = tdsColumns[i]!;
    const tab = parseTdsTableParts(tcol);
    if (!tab) continue;
    const tk = tdsTableKey(tab.schema, tab.table);
    const orgName = String(tcol.colName || "");
    base[i].tableName = `${bracketIdentSqlServer(tab.schema)}.${bracketIdentSqlServer(tab.table)}`;
    base[i].columnName = bracketIdentSqlServer(orgName);
    const nm = nullableByTable.get(tk)?.get(orgName);
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

  for (let i = 0; i < tdsColumns.length; i++) {
    if (!(tdsColumns[i]!.flags & 0x0c)) base[i].isEditable = false;
  }

  return base;
}

async function buildSqlServerGridQueryResult(
  pool: sql.ConnectionPool,
  sqlText: string
): Promise<{ rows: unknown[][]; columns: ColumnEditableInfo[] }> {
  const { rows, tdsColumns } = await runSqlServerQueryWithTdsMetadata(pool, sqlText);
  const base: ColumnEditableInfo[] = tdsColumns.map((tdsCol, idx) =>
    columnEditableFromMssqlMeta(tdsCol.colName, idx + 1, tediousColumnToMssqlRecordsetMeta(tdsCol))
  );
  const columns = await enrichSqlServerQueryColumnsEditable(pool, base, tdsColumns);
  return { rows, columns };
}

/**
 * node-mssql 的 recordset 为空行时仍带 `columns`（TDS 列元数据），否则前端拿不到表头。
 */
function recordsetToRowsAndColumns(recordset: unknown): {
  rows: unknown[][];
  columns: ColumnEditableInfo[];
} {
  const rs = (Array.isArray(recordset) ? recordset : []) as Record<string, unknown>[];
  const colMetaRaw =
    recordset != null && typeof recordset === "object" && "columns" in recordset
      ? (recordset as { columns?: unknown }).columns
      : undefined;

  const colMeta =
    colMetaRaw != null && typeof colMetaRaw === "object"
      ? (colMetaRaw as Record<string, MssqlRecordsetColumnMeta> | MssqlRecordsetColumnMeta[])
      : undefined;

  if (rs.length > 0) {
    const names = Object.keys(rs[0]);
    const columns: ColumnEditableInfo[] = names.map((name, idx) =>
      columnEditableFromMssqlMeta(name, idx + 1, resolveMssqlColumnMeta(colMeta, name, idx))
    );
    const rows = rs.map((row) => names.map((n) => row[n]));
    return { rows, columns };
  }

  if (colMeta && typeof colMeta === "object" && !Array.isArray(colMeta)) {
    const entries = Object.values(colMeta).filter(
      (c): c is MssqlRecordsetColumnMeta => c != null && typeof c === "object"
    );
    if (entries.length > 0) {
      const names = entries
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((c) => String(c.name ?? ""));
      const columns: ColumnEditableInfo[] = names.map((name, idx) =>
        columnEditableFromMssqlMeta(name, idx + 1, entries[idx] ?? {})
      );
      return { rows: [], columns };
    }
  }

  if (Array.isArray(colMeta) && colMeta.length > 0) {
    const names = colMeta.map((c, i) => String(c.name ?? `col${i + 1}`));
    const columns: ColumnEditableInfo[] = names.map((name, idx) =>
      columnEditableFromMssqlMeta(name, idx + 1, colMeta[idx] ?? {})
    );
    return { rows: [], columns };
  }

  return { rows: [], columns: [] };
}

/** 只读查询行数上限：SET ROWCOUNT（单批次内有效） */
function wrapReadonlyWithRowCount(innerSql: string, limit: number): string {
  const lim = Math.max(1, Math.min(100_000, Math.floor(limit)));
  return `SET ROWCOUNT ${lim};\n${innerSql}\nSET ROWCOUNT 0;`;
}

function sumRowsAffected(rowsAffected: number[] | undefined): number {
  if (!rowsAffected?.length) return 0;
  return rowsAffected.reduce((a, b) => a + (typeof b === "number" && b >= 0 ? b : 0), 0);
}

function aggregateIndexRows(
  rows: Array<Record<string, unknown>>
): Array<{
  index_name: string;
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
  columns: string[];
}> {
  type Entry = {
    index_name: string;
    index_type: string;
    is_unique: boolean;
    is_primary: boolean;
    cols: { ord: number; name: string }[];
  };
  const byName = new Map<string, Entry>();
  for (const r of rows) {
    const name = String(r.index_name ?? r.INDEX_NAME ?? "");
    if (!name) continue;
    let e = byName.get(name);
    if (!e) {
      e = {
        index_name: name,
        index_type: String(r.index_type ?? r.INDEX_TYPE ?? "NONCLUSTERED"),
        is_unique: !!(r.is_unique ?? r.IS_UNIQUE),
        is_primary: !!(r.is_primary ?? r.IS_PRIMARY),
        cols: [],
      };
      byName.set(name, e);
    }
    const ord = Number(r.key_ordinal ?? r.KEY_ORDINAL ?? 0) || 0;
    const col = String(r.column_name ?? r.COLUMN_NAME ?? "");
    e.cols.push({ ord, name: col });
  }
  return [...byName.values()]
    .map((e) => ({
      index_name: e.index_name,
      index_type: e.index_type,
      is_unique: e.is_unique,
      is_primary: e.is_primary,
      columns: e.cols.sort((a, b) => a.ord - b.ord).map((c) => c.name),
    }))
    .sort((a, b) => a.index_name.localeCompare(b.index_name));
}

function aggregateConstraintColumns(
  rows: Array<Record<string, unknown>>,
  nameKey: string,
  typeKey: string,
  colKey: string,
  ordKey: string
): Array<{ name: string; type: string; columns: string[] }> {
  const byName = new Map<string, { type: string; cols: { ord: number; name: string }[] }>();
  for (const r of rows) {
    const name = String(r[nameKey] ?? "");
    if (!name) continue;
    const typ = String(r[typeKey] ?? "");
    const col = String(r[colKey] ?? "");
    const ord = Number(r[ordKey] ?? 0) || 0;
    let e = byName.get(name);
    if (!e) {
      e = { type: typ, cols: [] };
      byName.set(name, e);
    }
    e.cols.push({ ord, name: col });
  }
  return [...byName.entries()].map(([name, e]) => ({
    name,
    type: e.type,
    columns: e.cols.sort((a, b) => a.ord - b.ord).map((c) => c.name),
  }));
}

function sqlServerBracketIdent(id: string): string {
  return "[" + id.replace(/\]/g, "]]") + "]";
}

/** node-mssql 单参数上限约 2100，预留余量 */
const MSSQL_IMPORT_MAX_PARAMS = 1800;

function sqlServerImportParamDef(value: unknown): { type: sql.ISqlType; value: unknown } {
  if (value === undefined || value === null) {
    return { type: sql.NVarChar(sql.MAX), value: null };
  }
  if (typeof value === "boolean") return { type: sql.Bit(), value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { type: sql.Float(), value };
    if (Number.isInteger(value)) {
      if (value >= -2147483648 && value <= 2147483647) return { type: sql.Int(), value };
      try {
        return { type: sql.BigInt(), value: BigInt(value) };
      } catch {
        return { type: sql.Float(), value };
      }
    }
    return { type: sql.Float(), value };
  }
  if (typeof value === "bigint") return { type: sql.BigInt(), value };
  if (value instanceof Date) return { type: sql.DateTime2(7), value };
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return { type: sql.VarBinary(sql.MAX), value };
  }
  if (typeof value === "object" && value !== null && "type" in value && (value as { type?: string }).type === "Buffer") {
    const d = (value as { data?: number[] }).data;
    if (Array.isArray(d)) {
      return { type: sql.VarBinary(sql.MAX), value: Buffer.from(d) };
    }
  }
  const s = String(value);
  if (s.length > 4000) return { type: sql.NVarChar(sql.MAX), value: s };
  return { type: sql.NVarChar(Math.max(1, s.length)), value: s };
}

async function sqlServerRunInsertChunk(
  pool: sql.ConnectionPool,
  transaction: sql.Transaction | undefined,
  schema: string,
  table: string,
  colNames: string[],
  chunk: unknown[][]
): Promise<number> {
  const req = transaction ? new sql.Request(transaction) : pool.request();
  const qualified = `${sqlServerBracketIdent(schema)}.${sqlServerBracketIdent(table)}`;
  const colsSql = colNames.map(sqlServerBracketIdent).join(", ");
  const tuples: string[] = [];
  let p = 0;
  for (const row of chunk) {
    const ph: string[] = [];
    for (let c = 0; c < colNames.length; c++) {
      const pname = `i${p++}`;
      const def = sqlServerImportParamDef(row[c]);
      req.input(pname, def.type, def.value);
      ph.push(`@${pname}`);
    }
    tuples.push(`(${ph.join(", ")})`);
  }
  const q = `INSERT INTO ${qualified} (${colsSql}) VALUES ${tuples.join(", ")}`;
  const result = await req.query(q);
  return sumRowsAffected(result.rowsAffected as number[]) || chunk.length;
}

function sqlServerNumOrUndef(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 由 INFORMATION_SCHEMA + sys 行拼装列类型（用于近似 DDL） */
function sqlServerFormatColumnTypeFromMeta(c: Record<string, unknown>): string {
  const dt = String(c.DATA_TYPE ?? c.data_type ?? "").toLowerCase();
  const charMax = c.CHARACTER_MAXIMUM_LENGTH ?? c.character_maximum_length;
  const prec = c.NUMERIC_PRECISION ?? c.numeric_precision;
  const scale = c.NUMERIC_SCALE ?? c.numeric_scale;
  const dtPrec = c.DATETIME_PRECISION ?? c.datetime_precision;

  const upperBase = dt.toUpperCase();
  if (["varchar", "nvarchar", "char", "nchar", "binary", "varbinary"].includes(dt)) {
    const n = charMax == null ? null : sqlServerNumOrUndef(charMax);
    const len = n === -1 ? "MAX" : n == null ? "" : String(n);
    return len ? `${upperBase}(${len})` : upperBase;
  }
  if (dt === "decimal" || dt === "numeric") {
    const p = prec == null ? null : sqlServerNumOrUndef(prec);
    const sc = scale == null ? null : sqlServerNumOrUndef(scale);
    if (p != null) return sc != null && sc > 0 ? `${upperBase}(${p},${sc})` : `${upperBase}(${p})`;
    return upperBase;
  }
  if (dt === "datetime2" || dt === "time" || dt === "datetimeoffset") {
    const dp = dtPrec == null ? null : sqlServerNumOrUndef(dtPrec);
    if (dp != null && dp > 0) return `${upperBase}(${dp})`;
    return upperBase;
  }
  if (dt === "float") {
    const p = prec == null ? null : sqlServerNumOrUndef(prec);
    if (p != null) return `${upperBase}(${p})`;
    return upperBase;
  }
  return upperBase;
}

function sqlServerFkRulePhrase(desc: unknown): string {
  const s = String(desc ?? "NO_ACTION")
    .trim()
    .toUpperCase()
    .replace(/_/g, " ");
  if (s === "NO ACTION" || s === "NOACTION") return "NO ACTION";
  if (s === "SET NULL") return "SET NULL";
  if (s === "SET DEFAULT") return "SET DEFAULT";
  if (s === "CASCADE") return "CASCADE";
  return "NO ACTION";
}

/**
 * 基表：由系统目录拼接近似 CREATE 脚本（非 SMO，可能与原始脚本有差异）。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sqlServerBuildBaseTableDdl(pool: any, schema: string, table: string): Promise<string> {
  const qs = sqlServerBracketIdent(schema);
  const qt = sqlServerBracketIdent(table);
  const qtbl = `${qs}.${qt}`;

  const colRes = await pool
    .request()
    .input("sch", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.CHARACTER_MAXIMUM_LENGTH,
        c.NUMERIC_PRECISION,
        c.NUMERIC_SCALE,
        c.DATETIME_PRECISION,
        c.IS_NULLABLE,
        c.COLUMN_DEFAULT,
        CAST(CASE WHEN ic.object_id IS NOT NULL AND ic.is_identity = 1 THEN 1 ELSE 0 END AS INT) AS is_identity,
        ic.seed_value,
        ic.increment_value,
        CAST(ISNULL(sc.is_rowguidcol, 0) AS INT) AS is_row_guidcol
      FROM INFORMATION_SCHEMA.COLUMNS c
      INNER JOIN sys.tables t ON t.name = c.TABLE_NAME
      INNER JOIN sys.schemas sch ON t.schema_id = sch.schema_id AND sch.name = c.TABLE_SCHEMA
      INNER JOIN sys.columns sc ON sc.object_id = t.object_id AND sc.name = c.COLUMN_NAME
      LEFT JOIN sys.identity_columns ic ON ic.object_id = sc.object_id AND ic.column_id = sc.column_id AND ic.is_identity = 1
      WHERE c.TABLE_SCHEMA = @sch AND c.TABLE_NAME = @tbl AND sc.is_computed = 0
      ORDER BY c.ORDINAL_POSITION
    `);
  const colRows = (colRes.recordset ?? []) as Record<string, unknown>[];

  const pkRes = await pool
    .request()
    .input("sch", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT kc.name AS constraint_name, col.name AS column_name, ic.key_ordinal
      FROM sys.key_constraints kc
      INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
      INNER JOIN sys.columns col ON ic.object_id = col.object_id AND ic.column_id = col.column_id
      WHERE kc.type = N'PK' AND s.name = @sch AND t.name = @tbl
      ORDER BY ic.key_ordinal
    `);
  const pkRows = (pkRes.recordset ?? []) as Record<string, unknown>[];

  const colLines: string[] = [];
  for (const c of colRows) {
    const cn = String(c.COLUMN_NAME ?? "").trim();
    if (!cn) continue;
    const qcol = sqlServerBracketIdent(cn);
    let line = `${qcol} ${sqlServerFormatColumnTypeFromMeta(c)}`;
    const isId = sqlServerNumOrUndef(c.is_identity) === 1;
    if (isId) {
      const seed = sqlServerNumOrUndef(c.seed_value) ?? 1;
      const inc = sqlServerNumOrUndef(c.increment_value) ?? 1;
      line += ` IDENTITY(${seed},${inc})`;
    }
    const nullable = String(c.IS_NULLABLE ?? "").toUpperCase() === "YES";
    line += nullable ? " NULL" : " NOT NULL";
    if (!isId) {
      const rawDef = c.COLUMN_DEFAULT;
      const defStr = rawDef == null ? "" : String(rawDef).trim();
      if (defStr) line += ` DEFAULT ${defStr}`;
    }
    if (sqlServerNumOrUndef(c.is_row_guidcol) === 1) line += " ROWGUIDCOL";
    colLines.push(line);
  }

  if (pkRows.length > 0) {
    const pkName = String(pkRows[0]?.constraint_name ?? "").trim() || `PK_${table}`.replace(/[^\w]/g, "_");
    const pkCols = [...pkRows]
      .sort((a, b) => (sqlServerNumOrUndef(a.key_ordinal) ?? 0) - (sqlServerNumOrUndef(b.key_ordinal) ?? 0))
      .map((r) => sqlServerBracketIdent(String(r.column_name ?? "")));
    colLines.push(`CONSTRAINT ${sqlServerBracketIdent(pkName)} PRIMARY KEY (${pkCols.join(", ")})`);
  }

  const chunks: string[] = [`CREATE TABLE ${qtbl} (\n  ${colLines.join(",\n  ")}\n);`];

  const uqAggRes = await pool
    .request()
    .input("sch", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT kc.name AS constraint_name, col.name AS column_name, ic.key_ordinal
      FROM sys.key_constraints kc
      INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
      INNER JOIN sys.columns col ON ic.object_id = col.object_id AND ic.column_id = col.column_id
      WHERE kc.type = N'UQ' AND s.name = @sch AND t.name = @tbl
      ORDER BY kc.name, ic.key_ordinal
    `);
  const uqByName = aggregateIndexRows(((uqAggRes.recordset ?? []) as Record<string, unknown>[]).map((r) => ({
    index_name: r.constraint_name,
    index_type: "UNIQUE",
    is_unique: true,
    is_primary: false,
    column_name: r.column_name,
    key_ordinal: r.key_ordinal,
  }))).map((x) => ({ name: x.index_name, columns: x.columns }));

  for (const uq of uqByName) {
    if (!uq.name || !uq.columns.length) continue;
    const cols = uq.columns.map((x) => sqlServerBracketIdent(x)).join(", ");
    chunks.push(
      `ALTER TABLE ${qtbl} ADD CONSTRAINT ${sqlServerBracketIdent(uq.name)} UNIQUE (${cols});`
    );
  }

  const chkRes = await pool
    .request()
    .input("sch", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT cc.name, cc.definition
      FROM sys.check_constraints cc
      INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE s.name = @sch AND t.name = @tbl
    `);
  for (const row of (chkRes.recordset ?? []) as Record<string, unknown>[]) {
    const n = String(row.name ?? "").trim();
    const def = String(row.definition ?? "").trim();
    if (!n || !def) continue;
    chunks.push(`ALTER TABLE ${qtbl} ADD CONSTRAINT ${sqlServerBracketIdent(n)} CHECK ${def};`);
  }

  const fkRes = await pool
    .request()
    .input("sch", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT fk.name AS constraint_name,
        scol.name AS source_column,
        ref_s.name AS target_schema,
        ref_t.name AS target_table,
        rcol.name AS target_column,
        fk.delete_referential_action_desc,
        fk.update_referential_action_desc
      FROM sys.foreign_keys fk
      INNER JOIN sys.tables st ON fk.parent_object_id = st.object_id
      INNER JOIN sys.schemas ss ON st.schema_id = ss.schema_id
      INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
      INNER JOIN sys.columns scol ON fkc.parent_object_id = scol.object_id AND fkc.parent_column_id = scol.column_id
      INNER JOIN sys.tables ref_t ON fk.referenced_object_id = ref_t.object_id
      INNER JOIN sys.schemas ref_s ON ref_t.schema_id = ref_s.schema_id
      INNER JOIN sys.columns rcol ON fkc.referenced_object_id = rcol.object_id AND fkc.referenced_column_id = rcol.column_id
      WHERE ss.name = @sch AND st.name = @tbl
      ORDER BY fk.name, fkc.constraint_column_id
    `);
  const fkByName = new Map<
    string,
    {
      cols: { src: string; refSch: string; refTbl: string; refCol: string }[];
      del: unknown;
      upd: unknown;
    }
  >();
  for (const r of (fkRes.recordset ?? []) as Record<string, unknown>[]) {
    const name = String(r.constraint_name ?? "").trim();
    if (!name) continue;
    let e = fkByName.get(name);
    if (!e) {
      e = {
        cols: [],
        del: r.delete_referential_action_desc,
        upd: r.update_referential_action_desc,
      };
      fkByName.set(name, e);
    }
    e.cols.push({
      src: String(r.source_column ?? ""),
      refSch: String(r.target_schema ?? ""),
      refTbl: String(r.target_table ?? ""),
      refCol: String(r.target_column ?? ""),
    });
  }
  for (const [fkName, e] of fkByName) {
    const srcCols = e.cols.map((c) => sqlServerBracketIdent(c.src)).join(", ");
    const ref0 = e.cols[0];
    const ref = `${sqlServerBracketIdent(ref0.refSch)}.${sqlServerBracketIdent(ref0.refTbl)}`;
    const refCols = e.cols.map((c) => sqlServerBracketIdent(c.refCol)).join(", ");
    const onDel = sqlServerFkRulePhrase(e.del);
    const onUpd = sqlServerFkRulePhrase(e.upd);
    chunks.push(
      `ALTER TABLE ${qtbl} ADD CONSTRAINT ${sqlServerBracketIdent(fkName)} FOREIGN KEY (${srcCols}) REFERENCES ${ref} (${refCols}) ON DELETE ${onDel} ON UPDATE ${onUpd};`
    );
  }

  const idxRes = await pool
    .request()
    .input("sch", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT
        i.name AS index_name,
        i.is_unique,
        i.type_desc,
        c.name AS column_name,
        ic.key_ordinal,
        ic.is_included_column
      FROM sys.indexes i
      INNER JOIN sys.tables t ON i.object_id = t.object_id
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE s.name = @sch AND t.name = @tbl AND i.type IN (1, 2) AND i.is_primary_key = 0
        AND NOT EXISTS (
          SELECT 1 FROM sys.key_constraints kc
          WHERE kc.parent_object_id = t.object_id AND kc.unique_index_id = i.index_id AND kc.type = N'UQ'
        )
      ORDER BY i.index_id, ic.is_included_column ASC, ic.key_ordinal ASC
    `);

  const idxRows = (idxRes.recordset ?? []) as Record<string, unknown>[];
  const idxMeta = new Map<string, { unique: boolean; clustered: boolean }>();
  for (const r of idxRows) {
    const iname = String(r.index_name ?? "").trim();
    if (!iname || idxMeta.has(iname)) continue;
    const td = String(r.type_desc ?? "").toUpperCase();
    const clustered = td.includes("CLUSTERED") && !td.includes("NONCLUSTERED");
    idxMeta.set(iname, { unique: !!(r.is_unique ?? r.IS_UNIQUE), clustered });
  }
  for (const iname of idxMeta.keys()) {
    const meta = idxMeta.get(iname)!;
    const keyEntries = idxRows.filter(
      (x) => String(x.index_name ?? "") === iname && !(x.is_included_column ?? x.IS_INCLUDED_COLUMN)
    );
    const sortedKeys = keyEntries
      .map((x) => ({ ko: sqlServerNumOrUndef(x.key_ordinal) ?? 0, c: String(x.column_name ?? "") }))
      .filter((x) => x.ko > 0)
      .sort((a, b) => a.ko - b.ko)
      .map((x) => sqlServerBracketIdent(x.c));
    const incCols = idxRows.filter(
      (x) => String(x.index_name ?? "") === iname && !!(x.is_included_column ?? x.IS_INCLUDED_COLUMN)
    );
    const sortedInc = incCols.map((x) => sqlServerBracketIdent(String(x.column_name ?? "")));
    if (!sortedKeys.length) continue;
    const uq = meta.unique ? "UNIQUE " : "";
    const cl = meta.clustered ? "CLUSTERED " : "NONCLUSTERED ";
    let stmt = `CREATE ${uq}${cl}INDEX ${sqlServerBracketIdent(iname)} ON ${qtbl} (${sortedKeys.join(", ")})`;
    if (sortedInc.length) stmt += ` INCLUDE (${sortedInc.join(", ")})`;
    stmt += ";";
    chunks.push(stmt);
  }

  return chunks.join("\n\n");
}

/** 去掉末尾分号与空白，避免部分驱动把「空语句」与上条放在同一批触发 2759 */
function normalizeSqlServerDdlBatch(ddl: string): string {
  return ddl.trim().replace(/;+\s*$/u, "");
}

/**
 * node-mssql 同批多错时：较早错误在 precedingErrors，message 常为最后一条（如 2759）。
 * 拼接后便于看到真正原因（权限、对象已存在等）。
 */
function formatMssqlErrorChain(e: unknown): string {
  const parts: string[] = [];
  const x = e as { message?: string; precedingErrors?: Array<{ message?: string }> };
  if (Array.isArray(x.precedingErrors)) {
    for (const p of x.precedingErrors) {
      const m = typeof p?.message === "string" ? p.message.trim() : "";
      if (m && !parts.includes(m)) parts.push(m);
    }
  }
  const main = e instanceof Error ? e.message.trim() : String(e ?? "").trim();
  if (main && !parts.includes(main)) parts.push(main);
  return parts.length > 0 ? parts.join(" → ") : "未知错误";
}

export async function buildSqlServerSchemaContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pool: any,
  schema?: string
): Promise<{ context: string; injected: string[] }> {
  const schemas = schema?.trim()
    ? [schema.trim()]
    : (
        await pool.request().query(`
          SELECT TOP (2) SCHEMA_NAME AS schema_name
          FROM INFORMATION_SCHEMA.SCHEMATA
          WHERE SCHEMA_NAME NOT IN (
            N'guest', N'INFORMATION_SCHEMA', N'sys', N'db_owner', N'db_accessadmin',
            N'db_backupoperator', N'db_datareader', N'db_datawriter', N'db_ddladmin',
            N'db_denydatareader', N'db_denydatawriter', N'db_securityadmin'
          )
          ORDER BY SCHEMA_NAME
        `)
      ).recordset.map((r: Record<string, unknown>) => String(r.schema_name ?? r.SCHEMA_NAME ?? "")).filter(Boolean);

  const chunks: string[] = [];
  const injected: string[] = [];
  for (const s of schemas) {
    const tablesRes = await pool
      .request()
      .input("sch", sql.NVarChar, s)
      .query(`
        SELECT TOP (6) TABLE_NAME AS table_name
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = @sch AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
      `);
    for (const tr of (tablesRes.recordset ?? []) as Array<Record<string, unknown>>) {
      const tname = String(tr.table_name ?? tr.TABLE_NAME ?? "");
      if (!tname) continue;
      const colRes = await pool
        .request()
        .input("sch", sql.NVarChar, s)
        .input("tbl", sql.NVarChar, tname)
        .query(`
          SELECT TOP (12) COLUMN_NAME AS column_name, DATA_TYPE AS data_type
          FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = @sch AND TABLE_NAME = @tbl
          ORDER BY ORDINAL_POSITION
        `);
      const cols = ((colRes.recordset ?? []) as Array<Record<string, unknown>>)
        .map((c) => {
          const cn = String(c.column_name ?? c.COLUMN_NAME ?? "");
          const dt = String(c.data_type ?? c.DATA_TYPE ?? "");
          return `${cn}:${dt}`;
        })
        .filter((x) => x !== ":");
      const tableRef = `${s}.${tname}`;
      chunks.push(`${tableRef}(${cols.join(", ")})`);
      injected.push(tableRef);
    }
  }
  return { context: chunks.join("\n"), injected };
}

export interface SqlServerDbHandlerContext {
  connectionMap: Map<string, SessionConnection>;
  getConnId: () => string;
  getS: (cid: string) => SessionConnection;
  getSWithDb: (cid: string) => SessionConnection;
  sendSSEMessage: (cid: string, msg: SSEMessage) => void;
  disconnectConnection: (cid: string) => Promise<void>;
  assertSessionDbType: (session: SessionConnection, dbType: DbKind | undefined) => void;
  capabilitiesForKind: (kind: DbKind) => DatabaseCapabilities;
  startSqlServerUserClientKeepalive: (cid: string) => void;
  stopUserClientKeepalive: (session: SessionConnection) => void;
}

export async function handleSqlServerDbRequest(
  method: string,
  payload: unknown,
  ctx: SqlServerDbHandlerContext
): Promise<unknown> {
  const {
    connectionMap,
    getConnId,
    getS,
    getSWithDb,
    sendSSEMessage,
    disconnectConnection,
    assertSessionDbType,
    capabilitiesForKind,
    startSqlServerUserClientKeepalive,
    stopUserClientKeepalive,
  } = ctx;

  const unsupported = () => {
    throw new Error(`当前 SQL Server 连接尚不支持该操作（${method}），请使用 PostgreSQL / MySQL 或等待后续版本。`);
  };

  switch (method) {
    case "db/connect": {
      const params = payload as ConnectDbRequest;
      if (params.dbType !== "sqlserver") {
        throw new Error("内部错误：db/connect 此分支须 dbType=sqlserver");
      }
      const { connectionId: cid, dbType, ...connectParams } = params;
      void dbType;
      const loginParams: PostgresLoginParams = { ...connectParams, password: connectParams.password ?? "" };

      const existing = connectionMap.get(cid);
      if (existing) {
        connectionMap.delete(cid);
        stopUserClientKeepalive(existing);
        if (existing.dbKind === "postgres") {
          await existing.userUsedClient.end().catch(() => {});
          await existing.backGroundPool.end().catch(() => {});
        } else if (existing.dbKind === "sqlserver") {
          await existing.userUsedClient.close().catch(() => {});
        } else {
          try {
            existing.userUsedClient.release();
          } catch {
            /* ignore */
          }
          await existing.backGroundPool.end().catch(() => {});
        }
        await existing.closeTunnel?.().catch(() => {});
      }

      const db = await getSqlServerDbConfig(loginParams);
      const pool = await openSqlServerPool(db);

      connectionMap.set(cid, {
        dbKind: "sqlserver",
        userUsedClient: pool,
        backGroundPool: pool,
        dbForReconnect: db,
        eventPushers: new Set(),
        closeTunnel: db.closeTunnel,
      });
      startSqlServerUserClientKeepalive(cid);
      return { success: true, connectionId: cid, dbType: "sqlserver" as const };
    }

    case "db/disconnect": {
      const { connectionId: cid, dbType } = payload as { connectionId: string; dbType: DbKind };
      assertSessionDbType(getS(cid), dbType);
      await disconnectConnection(cid);
      return { success: true };
    }

    case "db/capabilities": {
      const { connectionId, dbType } = payload as { connectionId: string; dbType: DbKind };
      const session = getS(connectionId);
      assertSessionDbType(session, dbType);
      return { capabilities: capabilitiesForKind(session.dbKind) };
    }

    case "db/query-readonly": {
      const cid = getConnId();
      const { query, limit = 1000 } = payload as {
        connectionId: string;
        query: string;
        limit?: number;
        defaultSchema?: string;
      };
      const session = sqlServerSession(getSWithDb, cid);
      const q = query.trim();
      const statements = getStatementsFromSql(q);
      if (statements.length !== 1) {
        throw new Error("SQL Server 只读查询当前仅支持单条语句");
      }
      const limited = wrapReadonlyWithRowCount(statements[0], limit);
      const pool = session.backGroundPool;
      try {
        const { rows, columns } = await buildSqlServerGridQueryResult(pool, limited);
        return { rows, columns, hasMore: false };
      } catch (e: unknown) {
        throw new Error(formatMssqlErrorChain(e));
      }
    }

    case "db/query": {
      const cid = getConnId();
      const { query } = payload as { connectionId: string; query: string; defaultSchema?: string };
      const session = sqlServerSession(getSWithDb, cid);
      const pool = session.userUsedClient;
      try {
        sendSSEMessage(cid, {
          type: "QUERY",
          message: `执行查询: ${query.slice(0, 100)}...`,
          timestamp: Date.now(),
        });
        const { rows, columns } = await buildSqlServerGridQueryResult(pool, query.trim());
        sendSSEMessage(cid, {
          type: "INFO",
          message: `完成: ${rows.length} 行`,
          timestamp: Date.now(),
        });
        return { result: rows, columns };
      } catch (e: unknown) {
        const msg = formatMssqlErrorChain(e);
        sendSSEMessage(cid, { type: "ERROR", message: `查询错误: ${msg}`, timestamp: Date.now() });
        throw new Error(msg);
      }
    }

    case "db/save-changes": {
      const cid = getConnId();
      const { sql: ddl } = payload as { connectionId: string; sql: string };
      const session = sqlServerSession(getSWithDb, cid);
      try {
        const result = await session.backGroundPool.request().query(normalizeSqlServerDdlBatch(ddl));
        const affected = sumRowsAffected(result.rowsAffected);
        sendSSEMessage(cid, {
          type: "INFO",
          message: `保存成功: ${affected} 行受影响`,
          timestamp: Date.now(),
        });
        return { success: true, rowCount: affected };
      } catch (e: unknown) {
        const msg = formatMssqlErrorChain(e);
        sendSSEMessage(cid, { type: "ERROR", message: `保存失败: ${msg}`, timestamp: Date.now() });
        throw new Error(msg);
      }
    }

    case "db/import-rows": {
      const cid = getConnId();
      const {
        schema,
        table,
        columns: colNames,
        rows,
        conflictColumns,
        onConflict,
        onError = "rollback",
      } = payload as {
        connectionId: string;
        schema: string;
        table: string;
        columns: string[];
        rows: unknown[][];
        conflictColumns?: string[];
        onConflict?: "nothing" | "update";
        onError?: "rollback" | "discard";
      };
      if (!colNames?.length || !Array.isArray(rows)) {
        throw new Error("缺少 columns 或 rows");
      }
      if (conflictColumns?.length && onConflict) {
        throw new Error("SQL Server 批量导入暂不支持 conflictColumns / UPSERT，请使用普通 INSERT");
      }
      const session = sqlServerSession(getSWithDb, cid);
      const pool = session.backGroundPool;
      const colWidth = Math.max(1, colNames.length);
      const batchRows = Math.max(1, Math.floor(MSSQL_IMPORT_MAX_PARAMS / colWidth));

      let total = 0;
      try {
        if (onError === "rollback") {
          const tx = new sql.Transaction(pool);
          await tx.begin();
          try {
            for (let i = 0; i < rows.length; i += batchRows) {
              const chunk = rows.slice(i, i + batchRows);
              total += await sqlServerRunInsertChunk(pool, tx, schema, table, colNames, chunk);
            }
            await tx.commit();
          } catch (e) {
            await tx.rollback().catch(() => {});
            throw e;
          }
        } else {
          for (let i = 0; i < rows.length; i += batchRows) {
            const chunk = rows.slice(i, i + batchRows);
            try {
              total += await sqlServerRunInsertChunk(pool, undefined, schema, table, colNames, chunk);
            } catch {
              for (const row of chunk) {
                try {
                  total += await sqlServerRunInsertChunk(pool, undefined, schema, table, colNames, [row]);
                } catch {
                  /* 丢弃该行 */
                }
              }
            }
          }
        }
      } catch (e: unknown) {
        const msg = formatMssqlErrorChain(e);
        sendSSEMessage(cid, { type: "ERROR", message: `导入失败: ${msg}`, timestamp: Date.now() });
        throw new Error(msg);
      }
      sendSSEMessage(cid, {
        type: "INFO",
        message: `导入成功: ${total} 行`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: total };
    }

    case "db/execute-ddl": {
      const cid = getConnId();
      const { sql: ddl } = payload as { connectionId: string; sql: string };
      const session = sqlServerSession(getSWithDb, cid);
      try {
        sendSSEMessage(cid, {
          type: "QUERY",
          message: `执行 DDL: ${ddl.slice(0, 80)}...`,
          timestamp: Date.now(),
        });
        await session.backGroundPool.request().query(normalizeSqlServerDdlBatch(ddl));
        sendSSEMessage(cid, { type: "INFO", message: "DDL 执行成功", timestamp: Date.now() });
        return { success: true };
      } catch (e: unknown) {
        const msg = formatMssqlErrorChain(e);
        sendSSEMessage(cid, { type: "ERROR", message: `DDL 错误: ${msg}`, timestamp: Date.now() });
        throw new Error(msg);
      }
    }

    case "db/schemas": {
      const cid = getConnId();
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool.request().query(`
        SELECT SCHEMA_NAME AS schema_name
        FROM INFORMATION_SCHEMA.SCHEMATA
        WHERE SCHEMA_NAME NOT IN (
          N'guest', N'INFORMATION_SCHEMA', N'sys', N'db_owner', N'db_accessadmin',
          N'db_backupoperator', N'db_datareader', N'db_datawriter', N'db_ddladmin',
          N'db_denydatareader', N'db_denydatawriter', N'db_securityadmin'
        )
        ORDER BY SCHEMA_NAME
      `);
      const schemas = ((r.recordset ?? []) as Array<Record<string, unknown>>)
        .map((row) => String(row.schema_name ?? row.SCHEMA_NAME ?? ""))
        .filter((name) => name.length > 0);
      return { schemas };
    }

    case "db/tables": {
      const cid = getConnId();
      const { schema } = payload as { connectionId: string; schema: string };
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool
        .request()
        .input("sch", sql.NVarChar, schema)
        .query(`
          SELECT TABLE_NAME AS table_name, TABLE_TYPE AS table_type
          FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = @sch
          ORDER BY TABLE_TYPE, TABLE_NAME
        `);
      const tableName = (row: Record<string, unknown>) => String(row.table_name ?? row.TABLE_NAME ?? "");
      const tableType = (row: Record<string, unknown>) => String(row.table_type ?? row.TABLE_TYPE ?? "");
      const resultRows = (r.recordset ?? []) as Record<string, unknown>[];
      return {
        tables: resultRows.filter((row) => tableType(row) === "BASE TABLE").map((row) => tableName(row)),
        views: resultRows.filter((row) => tableType(row) === "VIEW").map((row) => tableName(row)),
        functions: [] as Array<{ oid: number; schema: string; name: string; args: string }>,
      };
    }

    case "db/columns": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT
            col.COLUMN_NAME AS column_name,
            col.DATA_TYPE AS data_type,
            col.IS_NULLABLE AS is_nullable,
            col.COLUMN_DEFAULT AS column_default,
            col.CHARACTER_MAXIMUM_LENGTH AS character_maximum_length,
            col.NUMERIC_PRECISION AS numeric_precision,
            col.NUMERIC_SCALE AS numeric_scale,
            CAST(NULL AS NVARCHAR(MAX)) AS column_comment,
            CASE WHEN ic.object_id IS NOT NULL THEN N'ALWAYS' ELSE NULL END AS identity_generation
          FROM INFORMATION_SCHEMA.COLUMNS col
          INNER JOIN sys.schemas sch ON sch.name = col.TABLE_SCHEMA
          INNER JOIN sys.tables st ON st.schema_id = sch.schema_id AND st.name = col.TABLE_NAME
          LEFT JOIN sys.columns sc ON sc.object_id = st.object_id AND sc.name = col.COLUMN_NAME
          LEFT JOIN sys.identity_columns ic
            ON ic.object_id = sc.object_id AND ic.column_id = sc.column_id AND ic.is_identity = 1
          WHERE col.TABLE_SCHEMA = @sch AND col.TABLE_NAME = @tbl
          ORDER BY col.ORDINAL_POSITION
        `);
      return { columns: r.recordset ?? [] };
    }

    case "db/indexes": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT
            i.name AS index_name,
            i.type_desc AS index_type,
            i.is_unique AS is_unique,
            i.is_primary_key AS is_primary,
            c.name AS column_name,
            ic.key_ordinal AS key_ordinal
          FROM sys.indexes i
          INNER JOIN sys.tables t ON i.object_id = t.object_id
          INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
          INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
          INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          WHERE s.name = @sch AND t.name = @tbl AND i.type > 0
          ORDER BY i.name, ic.key_ordinal
        `);
      const rows = (r.recordset ?? []) as Array<Record<string, unknown>>;
      return { indexes: aggregateIndexRows(rows) };
    }

    case "db/primary-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT kc.name AS constraint_name, c.name AS column_name, ic.key_ordinal AS key_ordinal
          FROM sys.key_constraints kc
          INNER JOIN sys.tables t ON kc.parent_object_id = t.object_id
          INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
          INNER JOIN sys.index_columns ic ON ic.object_id = t.object_id AND ic.index_id = kc.unique_index_id
          INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
          WHERE kc.type = N'PK' AND s.name = @sch AND t.name = @tbl
          ORDER BY ic.key_ordinal
        `);
      const rows = (r.recordset ?? []) as Array<Record<string, unknown>>;
      const columns = rows
        .slice()
        .sort((a, b) => (Number(a.key_ordinal) || 0) - (Number(b.key_ordinal) || 0))
        .map((x) => String(x.column_name ?? ""));
      const constraintName =
        rows.length > 0 ? String(rows[0]?.constraint_name ?? rows[0]?.CONSTRAINT_NAME ?? "") : "";
      return {
        columns,
        ...(constraintName ? { constraintName } : {}),
      };
    }

    case "db/foreign-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const pool = session.backGroundPool;
      const outR = await pool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT fk.name AS constraint_name,
            scol.name AS source_column,
            ref_s.name AS target_schema,
            ref_t.name AS target_table,
            rcol.name AS target_column,
            fk.delete_referential_action_desc AS delete_rule,
            fk.update_referential_action_desc AS update_rule
          FROM sys.foreign_keys fk
          INNER JOIN sys.tables st ON fk.parent_object_id = st.object_id
          INNER JOIN sys.schemas ss ON st.schema_id = ss.schema_id
          INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
          INNER JOIN sys.columns scol ON fkc.parent_object_id = scol.object_id AND fkc.parent_column_id = scol.column_id
          INNER JOIN sys.tables ref_t ON fk.referenced_object_id = ref_t.object_id
          INNER JOIN sys.schemas ref_s ON ref_t.schema_id = ref_s.schema_id
          INNER JOIN sys.columns rcol ON fkc.referenced_object_id = rcol.object_id AND fkc.referenced_column_id = rcol.column_id
          WHERE ss.name = @sch AND st.name = @tbl
        `);
      const inR = await pool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT fk.name AS constraint_name,
            src_s.name AS source_schema,
            src_t.name AS source_table,
            scol.name AS source_column,
            ref_s.name AS target_schema,
            ref_t.name AS target_table,
            rcol.name AS target_column
          FROM sys.foreign_keys fk
          INNER JOIN sys.tables ref_t ON fk.referenced_object_id = ref_t.object_id
          INNER JOIN sys.schemas ref_s ON ref_t.schema_id = ref_s.schema_id
          INNER JOIN sys.tables src_t ON fk.parent_object_id = src_t.object_id
          INNER JOIN sys.schemas src_s ON src_t.schema_id = src_s.schema_id
          INNER JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
          INNER JOIN sys.columns scol ON fkc.parent_object_id = scol.object_id AND fkc.parent_column_id = scol.column_id
          INNER JOIN sys.columns rcol ON fkc.referenced_object_id = rcol.object_id AND fkc.referenced_column_id = rcol.column_id
          WHERE ref_s.name = @sch AND ref_t.name = @tbl
        `);
      const mapOut = (r: Record<string, unknown>) => ({
        constraint_name: r.constraint_name ?? r.CONSTRAINT_NAME ?? null,
        source_column: r.source_column ?? r.SOURCE_COLUMN ?? null,
        target_schema: r.target_schema ?? r.TARGET_SCHEMA ?? null,
        target_table: r.target_table ?? r.TARGET_TABLE ?? null,
        target_column: r.target_column ?? r.TARGET_COLUMN ?? null,
        delete_rule: r.delete_rule ?? r.DELETE_RULE ?? null,
        update_rule: r.update_rule ?? r.UPDATE_RULE ?? null,
        source_schema: null,
        source_table: null,
      });
      const mapIn = (r: Record<string, unknown>) => ({
        constraint_name: r.constraint_name ?? r.CONSTRAINT_NAME ?? null,
        source_schema: r.source_schema ?? r.SOURCE_SCHEMA ?? null,
        source_table: r.source_table ?? r.SOURCE_TABLE ?? null,
        source_column: r.source_column ?? r.SOURCE_COLUMN ?? null,
        target_schema: r.target_schema ?? r.TARGET_SCHEMA ?? null,
        target_table: r.target_table ?? r.TARGET_TABLE ?? null,
        target_column: r.target_column ?? r.TARGET_COLUMN ?? null,
        delete_rule: null,
        update_rule: null,
      });
      return {
        outgoing: ((outR.recordset ?? []) as Record<string, unknown>[]).map(mapOut),
        incoming: ((inR.recordset ?? []) as Record<string, unknown>[]).map(mapIn),
      };
    }

    case "db/unique-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT tc.CONSTRAINT_NAME AS constraint_name, tc.CONSTRAINT_TYPE AS constraint_type,
            kcu.COLUMN_NAME AS column_name, kcu.ORDINAL_POSITION AS ordinal_position
          FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
          INNER JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
            ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
           AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
           AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
           AND tc.TABLE_NAME = kcu.TABLE_NAME
          WHERE tc.TABLE_SCHEMA = @sch AND tc.TABLE_NAME = @tbl
            AND tc.CONSTRAINT_TYPE IN (N'UNIQUE', N'PRIMARY KEY')
          ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION
        `);
      const rows = (r.recordset ?? []) as Array<Record<string, unknown>>;
      const constraints = aggregateConstraintColumns(
        rows.map((row) => ({
          name: row.constraint_name ?? row.CONSTRAINT_NAME,
          type: row.constraint_type ?? row.CONSTRAINT_TYPE,
          column_name: row.column_name ?? row.COLUMN_NAME,
          ordinal_position: row.ordinal_position ?? row.ORDINAL_POSITION,
        })),
        "name",
        "type",
        "column_name",
        "ordinal_position"
      ).map((c) => ({ name: c.name, type: c.type, columns: c.columns }));
      return { constraints };
    }

    case "db/check-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT cc.name AS name, cc.definition AS expression
          FROM sys.check_constraints cc
          INNER JOIN sys.tables t ON cc.parent_object_id = t.object_id
          INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
          WHERE s.name = @sch AND t.name = @tbl
        `);
      const constraints = ((r.recordset ?? []) as Array<Record<string, unknown>>).map((row) => ({
        name: String(row.name ?? row.NAME ?? ""),
        expression: String(row.expression ?? row.EXPRESSION ?? ""),
      }));
      return { constraints };
    }

    case "db/table-comment": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT CAST(ep.value AS NVARCHAR(MAX)) AS comment
          FROM sys.tables t
          INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
          LEFT JOIN sys.extended_properties ep
            ON ep.major_id = t.object_id AND ep.minor_id = 0 AND ep.class = 1 AND ep.name = N'MS_Description'
          WHERE s.name = @sch AND t.name = @tbl
        `);
      const row = (r.recordset ?? [])[0] as Record<string, unknown> | undefined;
      const raw = row ? String(row.comment ?? row.COMMENT ?? "") : "";
      return { comment: raw.trim() ? raw : null };
    }

    case "db/data-types": {
      const cid = getConnId();
      const session = sqlServerSession(getSWithDb, cid);
      const r = await session.backGroundPool.request().query(`
        SELECT name FROM sys.types WHERE is_user_defined = 0 AND name NOT IN (N'sysname') ORDER BY name
      `);
      const fromSys = ((r.recordset ?? []) as Array<Record<string, unknown>>).map((x) =>
        String(x.name ?? x.NAME ?? "")
      ).filter(Boolean);
      return { types: [...new Set(fromSys)].sort((a, b) => a.localeCompare(b)) };
    }

    case "db/table-ddl": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = sqlServerSession(getSWithDb, cid);
      const pool = session.backGroundPool;

      const meta = await pool
        .request()
        .input("sch", sql.NVarChar, schema)
        .input("tbl", sql.NVarChar, table)
        .query(`
          SELECT TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES
          WHERE TABLE_SCHEMA = @sch AND TABLE_NAME = @tbl
        `);
      if (!(meta.recordset?.length)) {
        throw new Error(`表或视图 ${schema}.${table} 不存在`);
      }
      const tableType = String((meta.recordset[0] as Record<string, unknown>).TABLE_TYPE ?? "")
        .trim()
        .toUpperCase();

      if (tableType === "VIEW") {
        const defR = await pool
          .request()
          .input("sch", sql.NVarChar, schema)
          .input("tbl", sql.NVarChar, table)
          .query(`
            SELECT OBJECT_DEFINITION(OBJECT_ID(QUOTENAME(@sch) + N'.' + QUOTENAME(@tbl))) AS def
          `);
        let def = String((defR.recordset?.[0] as Record<string, unknown> | undefined)?.def ?? "").trim();
        if (!def) {
          const modR = await pool
            .request()
            .input("sch", sql.NVarChar, schema)
            .input("tbl", sql.NVarChar, table)
            .query(`
              SELECT sm.definition AS def
              FROM sys.sql_modules sm
              WHERE sm.object_id = OBJECT_ID(QUOTENAME(@sch) + N'.' + QUOTENAME(@tbl))
            `);
          def = String((modR.recordset?.[0] as Record<string, unknown> | undefined)?.def ?? "").trim();
        }
        return { ddl: def || "-- 无法读取视图定义（权限不足或非 T-SQL 视图）" };
      }

      if (tableType !== "BASE TABLE") {
        throw new Error(`对象 ${schema}.${table}（类型 ${tableType}）暂不支持导出 DDL`);
      }

      const body = await sqlServerBuildBaseTableDdl(pool, schema, table);
      return {
        ddl: `-- SQL Server 近似 DDL（由系统目录生成，可能与当时建表脚本不完全一致）\n${body}`.trim(),
      };
    }

    default:
      return unsupported();
  }
}
