/**
 * 将 SQL 解析为可视化查询构建器可用的描述结构。
 * 使用 pgsql-ast-parser 解析 SELECT 语句，提取 FROM/JOIN、SELECT 列、WHERE、ORDER BY、LIMIT 等。
 */
import { parseFirst } from "pgsql-ast-parser";
import type {
  SelectFromStatement,
  FromTable,
  FromStatement,
  FromCall,
  SelectedColumn,
  Expr,
  ExprRef,
  ExprBinary,
  ExprCall,
  OrderByStatement,
  LimitStatement,
  QNameMapped,
  JoinType as AstJoinType,
} from "pgsql-ast-parser";

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';

export interface ParsedTable {
  schema: string;
  name: string;
  alias: string;
  joinType?: JoinType;
}

export interface ParsedSelectedColumn {
  tableAlias: string;
  columnName: string;
  alias?: string;
  aggregation?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN' | '';
  expression?: string;
}

export interface ParsedJoinCondition {
  leftAlias: string;
  leftColumn: string;
  rightAlias: string;
  rightColumn: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=';
}

export interface ParsedWhereCondition {
  leftOperand: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL' | 'BETWEEN';
  rightOperand: string;
  logicalOperator: 'AND' | 'OR';
}

export interface ParsedSortColumn {
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface ParsedSqlDescriptor {
  tables: ParsedTable[];
  selectedColumns: ParsedSelectedColumn[];
  joinConditions: ParsedJoinCondition[];
  whereConditions: ParsedWhereCondition[];
  sortColumns: ParsedSortColumn[];
  distinct: boolean;
  limit?: number;
  error?: string;
  /** 为 true 时表示 SQL 可能不完整或仅部分可解析，界面应提示「已尽力解析并生成可视化图」 */
  bestEffortHint?: boolean;
}

const AST_JOIN_TO_OUR: Record<string, JoinType> = {
  'INNER JOIN': 'INNER',
  'LEFT JOIN': 'LEFT',
  'RIGHT JOIN': 'RIGHT',
  'FULL JOIN': 'FULL',
  'CROSS JOIN': 'CROSS',
};

function getSchemaAndName(q: QNameMapped): { schema: string; name: string } {
  const name = (q as { name?: string }).name ?? (q as { name: string }).name;
  const schema = (q as { schema?: string }).schema;
  if (schema) {
    return { schema, name };
  }
  return { schema: 'public', name };
}

function getAliasFromAst(q: QNameMapped): string {
  const alias = (q as { alias?: string }).alias;
  if (alias) return alias.toLowerCase();
  const name = (q as { name?: string }).name ?? (q as { name: string }).name;
  return (name || 't').toLowerCase().charAt(0);
}

/** 确保表别名在列表中唯一：冲突时在原有别名后加数字或改用 表名+序号 */
function ensureUniqueAliases(tables: ParsedTable[]): void {
  const used = new Set<string>();
  for (const t of tables) {
    let alias = t.alias.toLowerCase();
    const base = alias;
    let n = 1;
    while (used.has(alias)) {
      alias = base + String(n);
      n++;
    }
    used.add(alias);
    t.alias = alias;
  }
}

/** 从 FROM 子句展开为 (table, joinType?) 列表：第一项无 joinType，后续为 JOIN 类型；并保证别名唯一 */
function collectFromTables(from: any[]): ParsedTable[] {
  const result: ParsedTable[] = [];
  if (!from || !Array.isArray(from)) return result;

  for (let i = 0; i < from.length; i++) {
    const item = from[i];
    if (!item) continue;
    if (item.type === 'table') {
      const name = item.name as QNameMapped;
      if (!name) continue;
      const { schema, name: tableName } = getSchemaAndName(name);
      const alias = getAliasFromAst(name);
      const joinType: JoinType | undefined = item.join
        ? (AST_JOIN_TO_OUR[item.join.type as AstJoinType] ?? 'INNER')
        : undefined;
      result.push({ schema, name: tableName, alias, joinType });
    }
    // 子查询 (statement)、函数 (call) 暂不展开为画布表，可后续支持
  }
  ensureUniqueAliases(result);
  return result;
}

/** 将表达式格式化为字符串（用于 WHERE 的 operand 或 ORDER BY column） */
function exprToSqlLikeString(expr: Expr): string {
  if (!expr) return '';
  switch (expr.type) {
    case 'ref': {
      const r = expr as ExprRef;
      const t = r.table?.name;
      const n = r.name;
      return t ? `${t}.${n}` : String(n);
    }
    case 'string':
      return `'${(expr as { value: string }).value.replace(/'/g, "''")}'`;
    case 'integer':
    case 'numeric':
      return String((expr as { value: number }).value);
    case 'boolean':
      return (expr as { value: boolean }).value ? 'true' : 'false';
    case 'null':
      return 'NULL';
    case 'binary': {
      const b = expr as ExprBinary;
      const left = exprToSqlLikeString(b.left);
      const right = exprToSqlLikeString(b.right);
      const op = b.op;
      return `${left} ${op} ${right}`;
    }
    case 'unary': {
      const u = expr as { op: string; operand: Expr };
      return `${u.op} ${exprToSqlLikeString(u.operand)}`;
    }
    case 'call': {
      const c = expr as ExprCall;
      const fn = c.function?.name ?? '?';
      const args = (c.args || []).map(exprToSqlLikeString).join(', ');
      return `${fn}(${args})`;
    }
    default:
      return String((expr as { type: string }).type);
  }
}

/** 从 ON 表达式中提取 a.col = b.col 形式的条件（支持 AND 组合） */
function collectJoinOnConditions(expr: Expr | null | undefined): ParsedJoinCondition[] {
  const conditions: ParsedJoinCondition[] = [];
  if (!expr) return conditions;

  function extractRef(e: Expr): { alias: string; column: string } | null {
    if (e.type === 'ref') {
      const r = e as ExprRef;
      const alias = r.table?.name ?? '';
      const col = r.name === '*' ? '' : r.name;
      return { alias: alias.toLowerCase(), column: col };
    }
    return null;
  }

  function collect(e: Expr) {
    if (e.type === 'binary') {
      const b = e as ExprBinary;
      if (b.op === 'AND') {
        collect(b.left);
        collect(b.right);
        return;
      }
      if (b.op === '=' || b.op === '!=' || b.op === '>' || b.op === '<' || b.op === '>=' || b.op === '<=') {
        const left = extractRef(b.left);
        const right = extractRef(b.right);
        if (left && right && left.column && right.column) {
          conditions.push({
            leftAlias: left.alias,
            leftColumn: left.column,
            rightAlias: right.alias,
            rightColumn: right.column,
            operator: b.op as ParsedJoinCondition['operator'],
          });
        }
      }
    }
  }
  collect(expr);
  return conditions;
}

/** 从 SELECT 列中解析出表别名、列名、聚合、AS 别名 */
function collectSelectedColumns(columns: SelectedColumn[] | null | undefined): ParsedSelectedColumn[] {
  const result: ParsedSelectedColumn[] = [];
  if (!columns || !Array.isArray(columns)) return result;

  for (const col of columns) {
    const expr = col.expr;
    const alias = col.alias?.name;

    if (expr.type === 'ref') {
      const r = expr as ExprRef;
      const tableAlias = (r.table?.name ?? '').toLowerCase();
      const columnName = r.name === '*' ? '' : r.name;
      if (columnName) {
        result.push({ tableAlias, columnName, alias });
      }
      continue;
    }

    if (expr.type === 'call') {
      const c = expr as ExprCall;
      const fn = (c.function?.name ?? '').toUpperCase();
      const agg = ['COUNT', 'SUM', 'AVG', 'MAX', 'MIN'].includes(fn)
        ? (fn as ParsedSelectedColumn['aggregation'])
        : undefined;
      const inner = c.args?.[0];
      let tableAlias = '';
      let columnName = '';
      if (inner?.type === 'ref') {
        const r = inner as ExprRef;
        tableAlias = (r.table?.name ?? '').toLowerCase();
        columnName = r.name === '*' ? '*' : r.name;
      }
      result.push({
        tableAlias,
        columnName: columnName || fn,
        alias,
        aggregation: agg ?? '',
        expression: exprToSqlLikeString(expr),
      });
      continue;
    }

    result.push({
      tableAlias: '',
      columnName: '',
      alias,
      expression: exprToSqlLikeString(expr),
    });
  }
  return result;
}

/** 将 WHERE 表达式拆成 AND/OR 的简单条件列表（只处理二元比较 + AND/OR） */
function collectWhereConditions(expr: Expr | null | undefined): ParsedWhereCondition[] {
  const result: ParsedWhereCondition[] = [];
  if (!expr) return result;

  const opMap = (op: string): ParsedWhereCondition['operator'] => {
    const m: Record<string, ParsedWhereCondition['operator']> = {
      '=': '=', '!=': '!=', '>': '>', '<': '<', '>=': '>=', '<=': '<=',
      'LIKE': 'LIKE', 'NOT LIKE': 'LIKE', 'IN': 'IN', 'NOT IN': 'IN',
      'IS NULL': 'IS NULL', 'IS NOT NULL': 'IS NOT NULL',
      'BETWEEN': 'BETWEEN', 'NOT BETWEEN': 'BETWEEN',
    };
    return m[op] ?? '=';
  };

  function collect(e: Expr, logicalOp: 'AND' | 'OR') {
    if (e.type === 'binary') {
      const b = e as ExprBinary;
      if (b.op === 'AND' || b.op === 'OR') {
        collect(b.left, b.op as 'AND' | 'OR');
        collect(b.right, b.op as 'AND' | 'OR');
        return;
      }
      const left = exprToSqlLikeString(b.left);
      const right = exprToSqlLikeString(b.right);
      result.push({
        leftOperand: left,
        operator: opMap(b.op),
        rightOperand: right,
        logicalOperator: logicalOp,
      });
      return;
    }
    if (e.type === 'unary') {
      const u = e as { op: string; operand: Expr };
      if (u.op === 'IS NULL' || u.op === 'IS NOT NULL') {
        result.push({
          leftOperand: exprToSqlLikeString(u.operand),
          operator: u.op as ParsedWhereCondition['operator'],
          rightOperand: '',
          logicalOperator: 'AND',
        });
      }
    }
  }
  collect(expr, 'AND');
  return result;
}

function collectOrderBy(orderBy: OrderByStatement[] | null | undefined): ParsedSortColumn[] {
  const result: ParsedSortColumn[] = [];
  if (!orderBy || !Array.isArray(orderBy)) return result;
  for (const o of orderBy) {
    result.push({
      column: exprToSqlLikeString(o.by),
      direction: (o.order === 'DESC' ? 'DESC' : 'ASC') as 'ASC' | 'DESC',
    });
  }
  return result;
}

function getLimit(limitStmt: LimitStatement | null | undefined): number | undefined {
  if (!limitStmt?.limit) return undefined;
  const e = limitStmt.limit;
  if (e?.type === 'integer') return (e as { value: number }).value;
  return undefined;
}

/**
 * 将一条 SELECT SQL 解析为 ParsedSqlDescriptor。
 * 仅支持单条 SELECT（含 FROM/JOIN/WHERE/ORDER BY/LIMIT/DISTINCT）。
 */
export function parseSqlToVisualDescriptor(sql: string): ParsedSqlDescriptor {
  const empty: ParsedSqlDescriptor = {
    tables: [],
    selectedColumns: [],
    joinConditions: [],
    whereConditions: [],
    sortColumns: [],
    distinct: false,
  };

  const trimmed = sql.trim();
  if (!trimmed) return empty;

  try {
    const stmt = parseFirst(trimmed);
    if (!stmt || stmt.type !== 'select') {
      return { ...empty, error: '仅支持 SELECT 语句' };
    }

    const select = stmt as SelectFromStatement;
    const from = select.from;
    const fromArray = Array.isArray(from) ? from : from ? [from] : [];
    const tables = collectFromTables(fromArray);

    const joinConditions: ParsedJoinCondition[] = [];
    for (let i = 1; i < fromArray.length; i++) {
      const item = fromArray[i];
      if (item?.type === 'table' && item.join?.on) {
        joinConditions.push(...collectJoinOnConditions(item.join.on));
      }
    }

    const selectedColumns = collectSelectedColumns(select.columns);
    const whereConditions = collectWhereConditions(select.where);
    const sortColumns = collectOrderBy(select.orderBy);
    const limit = getLimit(select.limit);
    const distinct = select.distinct === 'distinct';

    return {
      tables,
      selectedColumns,
      joinConditions,
      whereConditions,
      sortColumns,
      distinct,
      limit,
      bestEffortHint: true, // 从 SQL 导入均为尽力解析，提示用户核对
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ...empty, error: `SQL 解析失败: ${message}` };
  }
}
