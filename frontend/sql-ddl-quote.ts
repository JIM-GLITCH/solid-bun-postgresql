/** 侧栏 DDL 弹窗等：按方言引用标识符 */

export function pgQuoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}


export function mysqlBacktickIdent(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}

/** T-SQL 方括号标识符 */
export function sqlBracketIdent(id: string): string {
  return "[" + id.replace(/\]/g, "]]") + "]";
}
