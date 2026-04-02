/** 侧栏 DDL 弹窗等：按方言引用标识符 */

export function pgQuoteIdent(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

export function mysqlBacktickIdent(id: string): string {
  return "`" + id.replace(/`/g, "``") + "`";
}
