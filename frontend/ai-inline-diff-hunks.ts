/**
 * AI 真·行内预览：按行 LCS diff → 连续变更块（hunk），供 gutter 逐块接受。
 *
 * Cursor 式：左侧「基线」与右侧「当前编辑器内新文」对比；新文在模型里可编辑；
 * 红区为基线独有行，绿装饰标当前多出行。
 */

export type AiLineHunk = {
  /** 在「当前旧片段」中的 1-based 行号：首行待删行；纯插入时与 oldEndLineExclusive 相等，表示插在该行之前 */
  oldStartLine1: number;
  /** 1-based，删区为 [oldStartLine1, oldEndLineExclusive) */
  oldEndLineExclusive: number;
  addedLines: string[];
};

type Op =
  | { k: "eq"; oldIdx1: number; line: string }
  | { k: "del"; oldIdx1: number; line: string }
  | { k: "add"; line: string };

function myersLineOps(oldLines: string[], newLines: string[]): Op[] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
      else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const rev: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      rev.push({ k: "eq", oldIdx1: i, line: oldLines[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      rev.push({ k: "add", line: newLines[j - 1] });
      j--;
    } else if (i > 0) {
      rev.push({ k: "del", oldIdx1: i, line: oldLines[i - 1] });
      i--;
    }
  }
  rev.reverse();
  return rev;
}

/**
 * 将当前片段文本与目标文本对比，得到按旧行号顺序排列的 hunk 列表。
 */
export function buildAiLineHunks(oldText: string, newText: string): AiLineHunk[] {
  const oldLines = oldText.length === 0 ? [] : oldText.split("\n");
  const newLines = newText.length === 0 ? [] : newText.split("\n");
  if (oldLines.length === 0 && newLines.length === 0) return [];
  const ops = myersLineOps(oldLines, newLines);
  const hunks: AiLineHunk[] = [];
  let lastOldIdx = 0;
  let p = 0;
  while (p < ops.length) {
    const op = ops[p];
    if (op.k === "eq") {
      lastOldIdx = op.oldIdx1;
      p++;
      continue;
    }
    const delIdx: number[] = [];
    while (p < ops.length && ops[p].k === "del") {
      delIdx.push((ops[p] as Extract<Op, { k: "del" }>).oldIdx1);
      p++;
    }
    const adds: string[] = [];
    while (p < ops.length && ops[p].k === "add") {
      adds.push((ops[p] as Extract<Op, { k: "add" }>).line);
      p++;
    }
    if (delIdx.length > 0) {
      const minOld = Math.min(...delIdx);
      const maxOld = Math.max(...delIdx);
      hunks.push({
        oldStartLine1: minOld,
        oldEndLineExclusive: maxOld + 1,
        addedLines: adds,
      });
    } else {
      hunks.push({
        oldStartLine1: lastOldIdx + 1,
        oldEndLineExclusive: lastOldIdx + 1,
        addedLines: adds,
      });
    }
  }
  return hunks;
}

/** 与 buildAiLineHunks 一致，但带上「当前文」中的 1-based 行区间，供接受 hunk 时更新基线 */
export type CursorStyleHunk = {
  oldStartLine1: number;
  oldEndLineExclusive: number;
  newStartLine1: number;
  newEndLineExclusive: number;
};

export type RedZonePlan = {
  /** 0 = 片段首行之上；k = 片段内第 k 行之下 */
  afterSnippetLine: number;
  lines: string[];
};

/**
 * diff(基线, 当前片段)：红区（仅基线有）+ 接受 hunk 用的行号（相对片段 1-based）。
 */
export function buildCursorStylePreview(
  baseText: string,
  currentText: string
): { redZones: RedZonePlan[]; hunks: CursorStyleHunk[] } {
  const baseLines = baseText.length === 0 ? [] : baseText.split("\n");
  const curLines = currentText.length === 0 ? [] : currentText.split("\n");
  const ops = myersLineOps(baseLines, curLines);

  const redZones: RedZonePlan[] = [];
  let pendingRed: string[] = [];
  let curNewLine = 1;
  const flushRed = (afterSnippetLine: number) => {
    if (pendingRed.length === 0) return;
    redZones.push({ afterSnippetLine, lines: [...pendingRed] });
    pendingRed = [];
  };
  for (const op of ops) {
    if (op.k === "eq") {
      flushRed(curNewLine - 1);
      curNewLine++;
    } else if (op.k === "del") {
      pendingRed.push(op.line);
    } else {
      flushRed(curNewLine - 1);
      curNewLine++;
    }
  }
  flushRed(curNewLine - 1);

  const hunks: CursorStyleHunk[] = [];
  let lastOldIdx = 0;
  let newLinePtr = 1;
  let p = 0;
  while (p < ops.length) {
    const op = ops[p];
    if (op.k === "eq") {
      lastOldIdx = op.oldIdx1;
      newLinePtr++;
      p++;
      continue;
    }
    const delIdx: number[] = [];
    while (p < ops.length && ops[p].k === "del") {
      delIdx.push((ops[p] as Extract<Op, { k: "del" }>).oldIdx1);
      p++;
    }
    const adds: string[] = [];
    while (p < ops.length && ops[p].k === "add") {
      adds.push((ops[p] as Extract<Op, { k: "add" }>).line);
      p++;
    }
    const newStartLine1 = newLinePtr;
    const newEndLineExclusive = newStartLine1 + adds.length;
    newLinePtr = newEndLineExclusive;

    if (delIdx.length > 0) {
      const minOld = Math.min(...delIdx);
      const maxOld = Math.max(...delIdx);
      hunks.push({
        oldStartLine1: minOld,
        oldEndLineExclusive: maxOld + 1,
        newStartLine1,
        newEndLineExclusive,
      });
    } else {
      hunks.push({
        oldStartLine1: lastOldIdx + 1,
        oldEndLineExclusive: lastOldIdx + 1,
        newStartLine1,
        newEndLineExclusive,
      });
    }
  }

  return { redZones, hunks };
}

/** 接受一个 hunk：把「当前片段」中该块的文字合并进基线（与模型 executeEdits 等价语义，用于消去该块 diff） */
export function applyCursorStyleHunkToBase(
  baseText: string,
  currentText: string,
  h: CursorStyleHunk
): string {
  const baseLines = baseText.length === 0 ? [] : baseText.split("\n");
  const curLines = currentText.length === 0 ? [] : currentText.split("\n");
  const mid = curLines.slice(h.newStartLine1 - 1, h.newEndLineExclusive - 1);
  const before = baseLines.slice(0, h.oldStartLine1 - 1);
  const after = baseLines.slice(h.oldEndLineExclusive - 1);
  return [...before, ...mid, ...after].join("\n");
}
