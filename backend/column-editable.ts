import type { Client, Pool, FieldDef } from "pg";
import { parse, type Statement, type SelectedColumn, type ExprRef } from "pgsql-ast-parser";

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
  uniqueKeyFieldIndices?: number[]; // 对应唯一键列名在结果集中的字段索引（用于 self join 场景）
  tableAlias?: string; // 表别名（用于 self join 场景）
}

interface UniqueConstraintInfo {
  tableOid: number;
  tableName: string;
  schemaName: string;
  constraintType: string; // 'p' = 主键, 'u' = 唯一约束
  columnNumbers: number[];
}

/**
 * 解析后的 SELECT 字段信息
 */
interface ParsedSelectField {
  tableAlias?: string;  // 表别名（如 a.id 中的 a）
  columnName?: string;  // 列名（如 a.id 中的 id）
  isExpression: boolean; // 是否是表达式（如 COUNT(*), 1+1）
}

/**
 * 使用 pgsql-ast-parser 解析 SQL 的 SELECT 子句
 * 提取每个字段的表别名和列名
 */
function parseSelectColumns(sql: string): ParsedSelectField[] {
  try {
    const ast = parse(sql);
    if (ast.length === 0) return [];
    
    const stmt = ast[0] as Statement;
    if (stmt.type !== 'select') return [];
    
    const columns = stmt.columns;
    if (!columns || !Array.isArray(columns)) return [];
    
    return columns.map((col: SelectedColumn): ParsedSelectField => {
      const expr = col.expr;
      
      // 检查是否是简单的列引用 (ExprRef 类型)
      if (expr.type === 'ref') {
        const ref = expr as ExprRef;
        return {
          tableAlias: ref.table?.name,
          columnName: ref.name,
          isExpression: false
        };
      }
      
      // 其他类型（函数调用、表达式等）
      return {
        isExpression: true
      };
    });
  } catch (e) {
    // 解析失败时返回空数组，回退到无 SQL 解析的逻辑
    console.warn('SQL parse failed:', e);
    return [];
  }
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
 * 查询列的名称映射（tableOid -> columnNumber -> columnName）
 */
async function getColumnNames(client: QueryClient, tableOids: number[]): Promise<Map<number, Map<number, string>>> {
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
 * 3. 唯一约束的所有列都必须在当前查询结果中（对于同一表别名）
 * 
 * @param client - PostgreSQL 客户端
 * @param fields - 查询结果的字段定义
 * @param sql - 原始 SQL 语句（用于解析表别名，处理 self join 场景）
 */
export async function calculateColumnEditable(
  client: QueryClient,
  fields: FieldDef[],
  sql?: string
): Promise<ColumnEditableInfo[]> {
  // 使用 pgsql-ast-parser 解析 SQL 获取每个字段的表别名
  const parsedFields = sql ? parseSelectColumns(sql) : [];
  
  // 为每个 field 关联解析出的表别名
  // 解析的字段数量应该与 fields 一致，按顺序对应
  const fieldAliases: (string | undefined)[] = fields.map((field, index) => {
    if (index < parsedFields.length && !parsedFields[index].isExpression) {
      return parsedFields[index].tableAlias;
    }
    return undefined;
  });

  // 收集所有涉及的表 OID（排除计算列，tableID = 0）
  const tableOids = [...new Set(fields.map(f => f.tableID).filter(id => id !== 0))];

  // 并行查询所需信息
  const [uniqueConstraints, columnNameMap, tableNameMap] = await Promise.all([
    getUniqueConstraints(client, tableOids),
    getColumnNames(client, tableOids),
    getTableNames(client, tableOids)
  ]);

  // 表实例信息（用于处理 self join：同一表的不同别名视为不同的"表实例"）
  interface TableInstance {
    columnsInResult: Set<number>;  // 该实例在结果中存在的列号
    fieldIndices: Map<number, number[]>;  // columnID -> 字段索引列表
    constraint?: UniqueConstraintInfo;  // 可用的唯一约束
  }
  
  // tableID -> alias -> TableInstance
  // alias 为 undefined 表示无别名
  const tableInstances = new Map<number, Map<string | undefined, TableInstance>>();
  
  // 辅助函数：获取或创建表实例
  function getOrCreateInstance(tableID: number, alias: string | undefined): TableInstance {
    if (!tableInstances.has(tableID)) {
      tableInstances.set(tableID, new Map());
    }
    const aliasMap = tableInstances.get(tableID)!;
    if (!aliasMap.has(alias)) {
      aliasMap.set(alias, {
        columnsInResult: new Set(),
        fieldIndices: new Map()
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
    
    // 记录该表实例中，每个 columnID 对应的字段索引
    if (!instance.fieldIndices.has(field.columnID)) {
      instance.fieldIndices.set(field.columnID, []);
    }
    instance.fieldIndices.get(field.columnID)!.push(i);
  }

  // 为每个 "表实例" 找到可用的唯一约束
  for (const [tableOid, aliasMap] of tableInstances) {
    for (const [, instance] of aliasMap) {
      // 找到该表的约束
      for (const constraint of uniqueConstraints) {
        if (constraint.tableOid !== tableOid) continue;
        
        // 检查唯一约束的所有列是否都在该表实例的结果中
        const allColumnsPresent = constraint.columnNumbers.every(
          colNum => instance.columnsInResult.has(colNum)
        );
        if (allColumnsPresent && !instance.constraint) {
          instance.constraint = constraint;
          break; // 使用第一个满足条件的约束（主键优先）
        }
      }
    }
  }

  // 计算每列的可编辑信息
  return fields.map((field, fieldIndex) => {
    const info: ColumnEditableInfo = {
      name: field.name,
      tableID: field.tableID,
      columnID: field.columnID,
      isEditable: false
    };

    // 计算列不属于任何表
    if (field.tableID === 0) return info;

    // 获取该字段的表别名和表实例
    const alias = fieldAliases[fieldIndex];
    const instance = tableInstances.get(field.tableID)?.get(alias);
    if (!instance) return info;

    // 检查该表实例是否有可用的唯一约束
    const constraint = instance.constraint;
    if (!constraint) return info;

    // 获取表名和列名
    const tableInfo = tableNameMap.get(field.tableID);
    const tableColumnNames = columnNameMap.get(field.tableID);
    if (!tableInfo || !tableColumnNames) return info;
    
    const columnName = tableColumnNames.get(field.columnID);
    if (!columnName) return info;

    // 获取唯一键的列名列表和对应的字段索引
    const uniqueKeyColumns: string[] = [];
    const uniqueKeyFieldIndices: number[] = [];
    
    for (const colNum of constraint.columnNumbers) {
      const keyColName = tableColumnNames.get(colNum);
      if (!keyColName) return info;
      
      uniqueKeyColumns.push(keyColName);
      
      // 找到该列在当前表实例中的字段索引
      const indices = instance.fieldIndices.get(colNum);
      if (!indices || indices.length === 0) return info;
      
      // 如果同一列在同一表实例中出现多次，选择第一个
      uniqueKeyFieldIndices.push(indices[0]);
    }

    info.isEditable = true;
    info.tableName = tableInfo.schemaName === 'public' 
      ? tableInfo.tableName 
      : `${tableInfo.schemaName}.${tableInfo.tableName}`;
    info.columnName = columnName;
    info.uniqueKeyColumns = uniqueKeyColumns;
    info.uniqueKeyFieldIndices = uniqueKeyFieldIndices;
    info.tableAlias = alias;

    return info;
  });
}
