import type { Client, Pool, FieldDef } from "pg";
import { parse, type Statement, type SelectedColumn, type ExprRef } from "pgsql-ast-parser";
import type { ColumnEditableInfo } from "../shared/src";

// 支持 Client 或 Pool 查询
type QueryClient = Client | Pool;

/** 结果编辑 DML 用的 PostgreSQL 标识符引用（与裸 relname/nspname 一致，避免空格等破坏语法） */
function pgQuoteIdent(ident: string): string {
  return '"' + String(ident).replace(/"/g, '""') + '"';
}

interface UniqueConstraintInfo {
  tableOid: number;
  tableName: string;
  schemaName: string;
  constraintType: string;
  columnNumbers: number[];
}

interface ParsedSelectField {
  tableAlias?: string;
  columnName?: string;
  isExpression: boolean;
}

function parseSelectColumns(sql: string): ParsedSelectField[] {
  try {
    const ast = parse(sql);
    if (ast.length === 0) return [];

    const stmt = ast[0] as Statement;
    if (stmt.type !== "select") return [];

    const columns = stmt.columns;
    if (!columns || !Array.isArray(columns)) return [];

    return columns.map((col: SelectedColumn): ParsedSelectField => {
      const expr = col.expr;

      if (expr.type === "ref") {
        const ref = expr as ExprRef;
        return {
          tableAlias: ref.table?.name,
          columnName: ref.name,
          isExpression: false,
        };
      }

      return { isExpression: true };
    });
  } catch (e) {
    console.warn("SQL parse failed:", e);
    return [];
  }
}

async function getUniqueConstraints(
  client: QueryClient,
  tableOids: number[]
): Promise<UniqueConstraintInfo[]> {
  if (tableOids.length === 0) return [];

  const query = `
    SELECT 
      c.conrelid as table_oid,
      t.relname as table_name,
      n.nspname as schema_name,
      c.contype as constraint_type,
      c.conkey as column_numbers
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conrelid = ANY($1)
      AND c.contype IN ('p', 'u')
    ORDER BY 
      c.conrelid,
      CASE c.contype WHEN 'p' THEN 0 ELSE 1 END
  `;

  const result = await client.query(query, [tableOids]);
  return result.rows.map((row) => ({
    tableOid: row.table_oid,
    tableName: row.table_name,
    schemaName: row.schema_name,
    constraintType: row.constraint_type,
    columnNumbers: row.column_numbers,
  }));
}

interface ColumnMeta {
  name: string;
  attnotnull: boolean;
}

async function getColumnMeta(
  client: QueryClient,
  tableOids: number[]
): Promise<Map<number, Map<number, ColumnMeta>>> {
  if (tableOids.length === 0) return new Map();

  const query = `
    SELECT 
      attrelid as table_oid,
      attnum as column_number,
      attname as column_name,
      attnotnull as attnotnull
    FROM pg_attribute
    WHERE attrelid = ANY($1)
      AND attnum > 0
      AND NOT attisdropped
  `;

  const result = await client.query(query, [tableOids]);
  const map = new Map<number, Map<number, ColumnMeta>>();
  for (const row of result.rows) {
    if (!map.has(row.table_oid)) {
      map.set(row.table_oid, new Map());
    }
    map.get(row.table_oid)!.set(row.column_number, {
      name: row.column_name,
      attnotnull: row.attnotnull === true,
    });
  }
  return map;
}

async function getTableNames(
  client: QueryClient,
  tableOids: number[]
): Promise<Map<number, { tableName: string; schemaName: string }>> {
  if (tableOids.length === 0) return new Map();

  const query = `
    SELECT 
      t.oid as table_oid,
      t.relname as table_name,
      n.nspname as schema_name
    FROM pg_class t
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE t.oid = ANY($1)
  `;

  const result = await client.query(query, [tableOids]);
  const map = new Map<number, { tableName: string; schemaName: string }>();
  for (const row of result.rows) {
    map.set(row.table_oid, {
      tableName: row.table_name,
      schemaName: row.schema_name,
    });
  }
  return map;
}

/** 物理列在目录中的 SQL 类型串（含数组维数，如 integer[][]）；表达式列无此项 */
async function getAttributeFormatTypes(
  client: QueryClient,
  fields: FieldDef[]
): Promise<Map<string, string>> {
  const seen = new Set<string>();
  const pairs: Array<{ rel: number; att: number }> = [];
  for (const f of fields) {
    if (f.tableID === 0 || f.columnID === 0) continue;
    const key = `${f.tableID}:${f.columnID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ rel: f.tableID, att: f.columnID });
  }
  if (pairs.length === 0) return new Map();

  const placeholders: string[] = [];
  const params: number[] = [];
  let n = 1;
  for (const p of pairs) {
    placeholders.push(`($${n}::oid, $${n + 1}::int2)`);
    params.push(p.rel, p.att);
    n += 2;
  }
  const sql = `
    SELECT a.attrelid, a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod) AS fmt
    FROM pg_catalog.pg_attribute a
    WHERE (a.attrelid, a.attnum) IN (${placeholders.join(", ")})
      AND NOT a.attisdropped
  `;
  const result = await client.query(sql, params);
  const out = new Map<string, string>();
  for (const row of result.rows as { attrelid: number; attnum: number; fmt: string }[]) {
    const fmt = row.fmt != null ? String(row.fmt).trim() : "";
    if (fmt) out.set(`${row.attrelid}:${row.attnum}`, fmt);
  }
  return out;
}

export async function calculateColumnEditable(
  client: QueryClient,
  fields: FieldDef[],
  sql?: string
): Promise<ColumnEditableInfo[]> {
  const parsedFields = sql ? parseSelectColumns(sql) : [];

  const fieldAliases: (string | undefined)[] = fields.map((field, index) => {
    if (index < parsedFields.length && !parsedFields[index].isExpression) {
      return parsedFields[index].tableAlias;
    }
    return undefined;
  });

  const tableOids = [...new Set(fields.map((f) => f.tableID).filter((id) => id !== 0))];

  const [uniqueConstraints, columnMetaMap, tableNameMap, formatTypeMap] = await Promise.all([
    getUniqueConstraints(client, tableOids),
    getColumnMeta(client, tableOids),
    getTableNames(client, tableOids),
    getAttributeFormatTypes(client, fields),
  ]);

  interface TableInstance {
    columnsInResult: Set<number>;
    fieldIndices: Map<number, number[]>;
    constraint?: UniqueConstraintInfo;
  }

  const tableInstances = new Map<number, Map<string | undefined, TableInstance>>();

  function getOrCreateInstance(
    tableID: number,
    alias: string | undefined
  ): TableInstance {
    if (!tableInstances.has(tableID)) {
      tableInstances.set(tableID, new Map());
    }
    const aliasMap = tableInstances.get(tableID)!;
    if (!aliasMap.has(alias)) {
      aliasMap.set(alias, {
        columnsInResult: new Set(),
        fieldIndices: new Map(),
      });
    }
    return aliasMap.get(alias)!;
  }

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (field.tableID === 0) continue;

    const alias = fieldAliases[i];
    const instance = getOrCreateInstance(field.tableID, alias);

    instance.columnsInResult.add(field.columnID);

    if (!instance.fieldIndices.has(field.columnID)) {
      instance.fieldIndices.set(field.columnID, []);
    }
    instance.fieldIndices.get(field.columnID)!.push(i);
  }

  for (const [tableOid, aliasMap] of tableInstances) {
    for (const [, instance] of aliasMap) {
      for (const constraint of uniqueConstraints) {
        if (constraint.tableOid !== tableOid) continue;

        const allColumnsPresent = constraint.columnNumbers.every((colNum) =>
          instance.columnsInResult.has(colNum)
        );
        if (allColumnsPresent && !instance.constraint) {
          instance.constraint = constraint;
          break;
        }
      }
    }
  }

  return fields.map((field, fieldIndex) => {
    const info: ColumnEditableInfo = {
      name: field.name,
      tableID: field.tableID,
      columnID: field.columnID,
      isEditable: false,
      dataTypeOid: field.dataTypeID,
      sqlDialect: "postgres",
    };

    if (field.tableID !== 0 && field.columnID !== 0) {
      const fmt = formatTypeMap.get(`${field.tableID}:${field.columnID}`);
      if (fmt) info.dataTypeLabel = fmt;
    }

    // 对于来自表的列，从 pg_attribute 获取 nullable（无论是否可编辑）
    if (field.tableID !== 0) {
      const meta = columnMetaMap.get(field.tableID)?.get(field.columnID);
      if (meta) info.nullable = !meta.attnotnull;
    }

    if (field.tableID === 0) return info;

    const alias = fieldAliases[fieldIndex];
    const instance = tableInstances.get(field.tableID)?.get(alias);
    if (!instance) return info;

    const tableInfo = tableNameMap.get(field.tableID);
    const tableColumnMeta = columnMetaMap.get(field.tableID);
    if (!tableInfo || !tableColumnMeta) return info;

    const columnMeta = tableColumnMeta.get(field.columnID);
    if (!columnMeta) return info;

    const columnName = columnMeta.name;

    // 来自表的列：始终设置已引用的 tableName/columnName，便于生成 INSERT/UPDATE/DELETE（含空格、关键字）
    info.tableName = `${pgQuoteIdent(tableInfo.schemaName)}.${pgQuoteIdent(tableInfo.tableName)}`;
    info.columnName = pgQuoteIdent(columnName);
    info.tableAlias = alias;

    // 有主键/唯一约束时才能编辑行（UPDATE/DELETE 需定位行）
    const constraint = instance.constraint;
    if (!constraint) return info;

    const uniqueKeyColumns: string[] = [];
    const uniqueKeyFieldIndices: number[] = [];

    for (const colNum of constraint.columnNumbers) {
      const keyColMeta = tableColumnMeta.get(colNum);
      if (!keyColMeta) return info;

      uniqueKeyColumns.push(pgQuoteIdent(keyColMeta.name));

      const indices = instance.fieldIndices.get(colNum);
      if (!indices || indices.length === 0) return info;

      uniqueKeyFieldIndices.push(indices[0]);
    }

    info.isEditable = true;
    info.uniqueKeyColumns = uniqueKeyColumns;
    info.uniqueKeyFieldIndices = uniqueKeyFieldIndices;

    return info;
  });
}
