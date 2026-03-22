/**
 * SQL 格式化：缩进、关键字大小写等
 * 基于 sql-formatter，方言固定为 PostgreSQL
 */

import { format } from "sql-formatter";
import { getSqlSegments } from "./sql-split";

export type SqlFormatKeywordCase = "upper" | "lower" | "preserve";

export interface SqlFormatOptions {
  /** 缩进空格数，默认 2 */
  indent?: number;
  /** 关键字大小写：upper 大写、lower 小写、preserve 保持，默认 upper */
  keywordCase?: SqlFormatKeywordCase;
  /** 多条语句之间的空行数，默认 1 */
  linesBetweenQueries?: number;
  /** 是否按块格式化（每个分块单独格式化），默认 true */
  formatByBlock?: boolean;
}

const defaultOptions: Required<SqlFormatOptions> = {
  indent: 2,
  keywordCase: "upper",
  linesBetweenQueries: 1,
  formatByBlock: true,
};

/**
 * 格式化单个 SQL 块
 */
function formatSqlBlock(block: string, opts: Required<SqlFormatOptions>): string {
  const trimmed = block.trim();
  if (!trimmed) return block;
  
  // 预处理：修复常见问题
  let sql = trimmed;
  
  // 尝试格式化
  try {
    return format(sql, {
      language: "postgresql",
      tabWidth: opts.indent,
      keywordCase: opts.keywordCase,
      linesBetweenQueries: 0, // 单个块不需要块间空行
    });
  } catch {
    // 如果格式化失败，尝试原始字符串
    try {
      return format(trimmed, {
        language: "postgresql",
        tabWidth: opts.indent,
        keywordCase: opts.keywordCase,
        linesBetweenQueries: 0,
      });
    } catch {
      // 如果还是失败，返回原始块
      return block;
    }
  }
}

/**
 * 格式化 SQL 文本。解析失败时返回原文本。
 * 当 formatByBlock 为 true 时，按分块单独格式化每个 SQL 块。
 */
export function formatSql(sql: string, options?: SqlFormatOptions): string {
  const opts = { ...defaultOptions, ...options };
  
  if (!opts.formatByBlock) {
    // 旧行为：整个文档一起格式化
    const s = sql.trim();
    if (!s) return sql;
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
  
  // 新行为：按块单独格式化
  // 不修剪整个字符串，以保留文档开头和结尾的空白
  const segments = getSqlSegments(sql, { blankLineSeparator: true });
  if (segments.length === 0) return sql;
  
  const formattedBlocks: string[] = [];
  let lastEnd = 0;
  
  for (const segment of segments) {
    // 保留块之间的原始空白（包括空行）
    // getSqlSegments 会跳过空行，所以 segment.start 可能在空行之后
    // 需要从 lastEnd 往前找到实际的空白区域
    if (segment.start > lastEnd) {
      const between = sql.slice(lastEnd, segment.start);
      // getSqlSegments 空行分隔时，块的 end 包含第一个 \n，
      // segment.start 是空行之后的位置，between 只有第二个 \n。
      // 需要检查 lastEnd-1 处是否也是 \n（即块end前一个字符），
      // 来判断原始文本是否有空行分隔。
      const prevChar = lastEnd > 0 ? sql[lastEnd - 1] : '';
      const hasBlankLine = between.includes('\n') && prevChar === '\n';
      if (hasBlankLine) {
        // 保留空行分隔
        const blankSep = '\n' + '\n'.repeat(opts.linesBetweenQueries);
        formattedBlocks.push(blankSep);
      } else {
        formattedBlocks.push(between);
      }
    }
    
    const block = sql.slice(segment.start, segment.end);
    const formattedBlock = formatSqlBlock(block, opts);
    formattedBlocks.push(formattedBlock);
    
    lastEnd = segment.end;
  }
  
  // 保留文档末尾的空白
  if (lastEnd < sql.length) {
    formattedBlocks.push(sql.slice(lastEnd));
  }
  
  return formattedBlocks.join('');
}
