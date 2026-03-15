/**
 * SQL 格式化：缩进、关键字大小写等
 * 基于 sql-formatter，方言固定为 PostgreSQL
 */

import { format } from "sql-formatter";

export type SqlFormatKeywordCase = "upper" | "lower" | "preserve";

export interface SqlFormatOptions {
  /** 缩进空格数，默认 2 */
  indent?: number;
  /** 关键字大小写：upper 大写、lower 小写、preserve 保持，默认 upper */
  keywordCase?: SqlFormatKeywordCase;
  /** 多条语句之间的空行数，默认 1 */
  linesBetweenQueries?: number;
}

const defaultOptions: Required<SqlFormatOptions> = {
  indent: 2,
  keywordCase: "upper",
  linesBetweenQueries: 1,
};

/**
 * 格式化 SQL 文本。解析失败时返回原文本。
 */
export function formatSql(sql: string, options?: SqlFormatOptions): string {
  const s = sql.trim();
  if (!s) return sql;
  const opts = { ...defaultOptions, ...options };
  try {
    return format(s, {
      language: "postgresql",
      tabWidth: opts.indent,
      keywordCase: opts.keywordCase,
      linesBetweenQueries: opts.linesBetweenQueries,
    });
  } catch {
    return sql;
  }
}
