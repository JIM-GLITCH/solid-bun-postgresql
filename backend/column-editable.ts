import type { Client, Pool, FieldDef } from "pg";

// 支持 Client 或 Pool 查询
type QueryClient = Client | Pool;

export interface ColumnEditableInfo {
  name: string;
  tableID: number;
  columnID: number;
  isEditable: boolean;
  // 如果可编辑，提供更新所需的信息
  tableName?: string;
  columnName?: string;
  uniqueKeyColumns?: string[]; // 用于 WHERE 条件的唯一键列名
}

interface UniqueConstraintInfo {
  tableOid: number;
  tableName: string;
  schemaName: string;
  constraintType: string; // 'p' = 主键, 'u' = 唯一约束
  columnNumbers: number[];
}

/**
 * 查询指定表的唯一约束信息
 */
async function getUniqueConstraints(client: QueryClient, tableOids: number[]): Promise<UniqueConstraintInfo[]> {
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
      AND c.contype IN ('p', 'u')  -- 主键或唯一约束
    ORDER BY 
      c.conrelid,
      CASE c.contype WHEN 'p' THEN 0 ELSE 1 END  -- 主键优先
  `;

  const result = await client.query(query, [tableOids]);
  return result.rows.map(row => ({
    tableOid: row.table_oid,
    tableName: row.table_name,
    schemaName: row.schema_name,
    constraintType: row.constraint_type,
    columnNumbers: row.column_numbers
  }));
}

/**
 * 查询列的名称映射（tableOid + columnNumber -> columnName）
 */
async function getColumnNames(client: QueryClient, tableOids: number[]): Promise<Map<string, string>> {
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
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(`${row.table_oid}_${row.column_number}`, row.column_name);
  }
  return map;
}

/**
 * 查询表名映射（tableOid -> tableName）
 */
async function getTableNames(client: QueryClient, tableOids: number[]): Promise<Map<number, { tableName: string; schemaName: string }>> {
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
    map.set(row.table_oid, { tableName: row.table_name, schemaName: row.schema_name });
  }
  return map;
}

/**
 * 计算每列是否可编辑
 * 
 * 规则：
 * 1. 列必须属于某个表（tableID != 0）
 * 2. 该表必须有唯一约束（主键或唯一索引）
 * 3. 唯一约束的所有列都必须在当前查询结果中
 */
export async function calculateColumnEditable(
  client: QueryClient,
  fields: FieldDef[]
): Promise<ColumnEditableInfo[]> {
  // 收集所有涉及的表 OID（排除计算列，tableID = 0）
  const tableOids = [...new Set(fields.map(f => f.tableID).filter(id => id !== 0))];

  // 并行查询所需信息
  const [uniqueConstraints, columnNameMap, tableNameMap] = await Promise.all([
    getUniqueConstraints(client, tableOids),
    getColumnNames(client, tableOids),
    getTableNames(client, tableOids)
  ]);

  // 构建每个表在查询结果中存在的列号集合
  const tableColumnsInResult = new Map<number, Set<number>>();
  for (const field of fields) {
    if (field.tableID === 0) continue;
    if (!tableColumnsInResult.has(field.tableID)) {
      tableColumnsInResult.set(field.tableID, new Set());
    }
    tableColumnsInResult.get(field.tableID)!.add(field.columnID);
  }

  // 为每个表找到可用的唯一约束（所有约束列都在查询结果中）
  const tableUsableConstraint = new Map<number, UniqueConstraintInfo>();
  for (const constraint of uniqueConstraints) {
    const columnsInResult = tableColumnsInResult.get(constraint.tableOid);
    if (!columnsInResult) continue;

    // 检查唯一约束的所有列是否都在查询结果中
    const allColumnsPresent = constraint.columnNumbers.every(colNum => columnsInResult.has(colNum));
    if (allColumnsPresent && !tableUsableConstraint.has(constraint.tableOid)) {
      // 优先使用第一个满足条件的约束（主键优先，已排序）
      tableUsableConstraint.set(constraint.tableOid, constraint);
    }
  }

  // 计算每列的可编辑信息
  return fields.map(field => {
    const info: ColumnEditableInfo = {
      name: field.name,
      tableID: field.tableID,
      columnID: field.columnID,
      isEditable: false
    };

    // 计算列不属于任何表
    if (field.tableID === 0) return info;

    // 检查该表是否有可用的唯一约束
    const constraint = tableUsableConstraint.get(field.tableID);
    if (!constraint) return info;

    // 获取表名和列名
    const tableInfo = tableNameMap.get(field.tableID);
    const columnName = columnNameMap.get(`${field.tableID}_${field.columnID}`);
    if (!tableInfo || !columnName) return info;

    // 获取唯一键的列名列表
    const uniqueKeyColumns = constraint.columnNumbers.map(
      colNum => columnNameMap.get(`${field.tableID}_${colNum}`)!
    );

    info.isEditable = true;
    info.tableName = tableInfo.schemaName === 'public' 
      ? tableInfo.tableName 
      : `${tableInfo.schemaName}.${tableInfo.tableName}`;
    info.columnName = columnName;
    info.uniqueKeyColumns = uniqueKeyColumns;

    return info;
  });
}
