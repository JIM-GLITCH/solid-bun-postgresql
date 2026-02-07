import type { Client, Pool, FieldDef } from "pg";
import { parse, type Statement, type SelectedColumn, type ExprRef } from "pgsql-ast-parser";
import type { ColumnEditableInfo } from "@project/shared";

// 支持 Client 或 Pool 查询
type QueryClient = Client | Pool;

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

async function getColumnNames(
  client: QueryClient,
  tableOids: number[]
): Promise<Map<number, Map<number, string>>> {
  if (tableOids.length === 0) return new Map();

  const query = `
    SELECT 
      attrelid as table_oid,
      attnum as column_number,
      attname as column_name
    FROM pg_attribute
    WHERE attrelid = ANY($1)
      AND attnum > 0
      AND NOT attisdropped
  `;

  const result = await client.query(query, [tableOids]);
  const map = new Map<number, Map<number, string>>();
  for (const row of result.rows) {
    if (!map.has(row.table_oid)) {
      map.set(row.table_oid, new Map());
    }
    map.get(row.table_oid)!.set(row.column_number, row.column_name);
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

  const [uniqueConstraints, columnNameMap, tableNameMap] = await Promise.all([
    getUniqueConstraints(client, tableOids),
    getColumnNames(client, tableOids),
    getTableNames(client, tableOids),
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
    };

    if (field.tableID === 0) return info;

    const alias = fieldAliases[fieldIndex];
    const instance = tableInstances.get(field.tableID)?.get(alias);
    if (!instance) return info;

    const constraint = instance.constraint;
    if (!constraint) return info;

    const tableInfo = tableNameMap.get(field.tableID);
    const tableColumnNames = columnNameMap.get(field.tableID);
    if (!tableInfo || !tableColumnNames) return info;

    const columnName = tableColumnNames.get(field.columnID);
    if (!columnName) return info;

    const uniqueKeyColumns: string[] = [];
    const uniqueKeyFieldIndices: number[] = [];

    for (const colNum of constraint.columnNumbers) {
      const keyColName = tableColumnNames.get(colNum);
      if (!keyColName) return info;

      uniqueKeyColumns.push(keyColName);

      const indices = instance.fieldIndices.get(colNum);
      if (!indices || indices.length === 0) return info;

      uniqueKeyFieldIndices.push(indices[0]);
    }

    info.isEditable = true;
    info.tableName =
      tableInfo.schemaName === "public"
        ? tableInfo.tableName
        : `${tableInfo.schemaName}.${tableInfo.tableName}`;
    info.columnName = columnName;
    info.uniqueKeyColumns = uniqueKeyColumns;
    info.uniqueKeyFieldIndices = uniqueKeyFieldIndices;
    info.tableAlias = alias;

    return info;
  });
}
