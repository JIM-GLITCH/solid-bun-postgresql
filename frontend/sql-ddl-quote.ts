/** 侧栏 DDL 弹窗等：按方言引用标识符 */

import { isMysqlFamily, isSqlServer, type DbKind } from "../shared/src";

/** `schema.table` 限定名，用于 DROP / TRUNCATE 等与驱动一致的引用方式 */
export function qualifiedTableForDdl(kind: DbKind, schema: string, table: string): string {
  if (isSqlServer(kind)) return `${sqlBracketIdent(schema)}.${sqlBracketIdent(table)}`;
  if (isMysqlFamily(kind)) return `${mysqlBacktickIdent(schema)}.${mysqlBacktickIdent(table)}`;
  return `${pgQuoteIdent(schema)}.${pgQuoteIdent(table)}`;
}

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
