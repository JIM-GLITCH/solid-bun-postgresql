/**
 * SQL 分块：按「分号」或可选「空行」切分，忽略引号与注释内的分隔符。
 * 前后端共用，保证执行范围与编辑器块一致。
 */

export interface SqlSegment {
  start: number;
  end: number;
}

export interface GetSqlSegmentsOptions {
  /** 是否把空行也当作块边界（默认 true，前端用；后端仅按分号拆句用 false） */
  blankLineSeparator?: boolean;
}

/**
 * 将 SQL 文本按块切分，返回每块的 [start, end) 偏移。
 * - 分号在单/双引号、行注释 --、块注释 /* *\/ 内不视为分隔符。
 * - blankLineSeparator 为 true 时，空行（仅空白的一行）也结束当前块。
 */
export function getSqlSegments(
  text: string,
  options?: GetSqlSegmentsOptions
): SqlSegment[] {
  const blankLineSeparator = options?.blankLineSeparator ?? true;
  if (!text.length) return [];

  const parts: SqlSegment[] = [];
  let blockStart = 0;
  let inSingle = false;
  let inDouble = false;
  let inDollar: string | null = null;
  let i = 0;

  const readDollarTagAt = (idx: number): string | null => {
    if (text[idx] !== "$") return null;
    let j = idx + 1;
    // PostgreSQL dollar-quote tag: $...$ ; tag body不能含'$'或换行
    while (j < text.length && text[j] !== "$" && text[j] !== "\n" && text[j] !== "\r") j++;
    if (j < text.length && text[j] === "$") {
      const body = text.slice(idx + 1, j);
      // 允许 $$ 以及更宽松的 $tag$（含 Unicode），避免空白分隔
      if (!body || !/[\s$]/.test(body)) {
        return text.slice(idx, j + 1);
      }
    }
    return null;
  };

  while (i < text.length) {
    const c = text[i];

    if (inDollar) {
      if (text.startsWith(inDollar, i)) {
        i += inDollar.length;
        inDollar = null;
      } else {
        i++;
      }
      continue;
    }

    if (inSingle) {
      if (c === "'") {
        if (i + 1 < text.length && text[i + 1] === "'") i++;
        else inSingle = false;
      }
      i++;
      continue;
    }
    if (inDouble) {
      if (c === '"' && (i === 0 || text[i - 1] !== "\\")) inDouble = false;
      i++;
      continue;
    }

    if (c === "-" && i + 1 < text.length && text[i + 1] === "-") {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && i + 1 < text.length && text[i + 1] === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (c === ";") {
      if (blockStart < i) {
        let s = blockStart;
        while (s < i + 1 && /[\s\r\n\t]/.test(text[s])) s++;
        if (s < i + 1) parts.push({ start: s, end: i + 1 });
      }
      blockStart = i + 1;
      i++;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    const dollarTag = readDollarTagAt(i);
    if (dollarTag) {
      inDollar = dollarTag;
      i += dollarTag.length;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      i++;
      continue;
    }

    if (blankLineSeparator && c === "\n") {
      let j = i + 1;
      while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\r")) j++;
      if (j >= text.length || text[j] === "\n") {
        if (blockStart < i) {
          let s = blockStart;
          while (s < i + 1 && /[\s\r\n\t]/.test(text[s])) s++;
          if (s < i + 1) parts.push({ start: s, end: i + 1 });
        }
        while (j < text.length) {
          if (text[j] === "\n") {
            j++;
            while (j < text.length && (text[j] === " " || text[j] === "\t" || text[j] === "\r")) j++;
          } else break;
        }
        blockStart = j;
        i = j - 1;
      }
    }
    i++;
  }

  if (blockStart < text.length) {
    let s = blockStart;
    while (s < text.length && /[\s\r\n\t]/.test(text[s])) s++;
    if (s < text.length) parts.push({ start: s, end: text.length });
  }
  return parts;
}

/**
 * 将 SQL 文本拆成多条语句（仅按分号，忽略引号/注释内）。
 * 前端分句后传 statements 给后端即可，后端不必再算一遍。
 */
export function getStatementsFromText(sql: string): string[] {
  const s = sql.trim();
  if (!s) return [];
  return getSqlSegments(s, { blankLineSeparator: false })
    .map((seg) => s.slice(seg.start, seg.end).trim())
    .filter(Boolean);
}
