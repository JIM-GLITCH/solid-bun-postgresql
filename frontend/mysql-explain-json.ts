/**
 * 将 MySQL EXPLAIN FORMAT=JSON 结果转为与 ExplainPlanViewer 兼容的 PlanNode 树
 * （MySQL 使用 query_block / nested_loop / table 等结构，与 PostgreSQL 的 Plan 不同）
 */

import type { PlanNode } from "./explain-plan-viewer";

function parseNum(s: unknown): number | undefined {
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string") {
    const n = parseFloat(s.replace(/,/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function costFromInfo(ci: unknown): number | undefined {
  if (!ci || typeof ci !== "object") return undefined;
  const c = ci as Record<string, unknown>;
  return parseNum(c.query_cost ?? c.prefix_cost ?? c.read_cost);
}

export function isMysqlExplainJsonRoot(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (o.query_block != null && typeof o.query_block === "object") return true;
  if (o.nested_loop != null || (o.table != null && typeof o.table === "object")) return true;
  if (o.select_id != null && (o.cost_info != null || o.table != null || o.nested_loop != null)) return true;
  return false;
}

function convertTable(t: Record<string, unknown>): PlanNode {
  const access = String(t.access_type ?? "UNKNOWN");
  const name = String(t.table_name ?? "?");
  const rows = parseNum(t.rows_examined_per_scan ?? t.rows_produced_per_scan);
  const cost = costFromInfo(t.cost_info);
  const key = t.key != null && String(t.key) !== "null" ? String(t.key) : undefined;
  const filt = t.filtered != null ? String(t.filtered) : undefined;
  const parts: string[] = [`access=${access}`];
  if (key) parts.push(`key=${key}`);
  if (filt) parts.push(`filtered=${filt}%`);
  return {
    "Node Type": `${access} · ${name}`,
    "Relation Name": name,
    "Index Name": key,
    "Total Cost": cost,
    "Plan Rows": rows,
    Filter: parts.join(" · "),
  };
}

function collectFromQueryBlockLike(op: Record<string, unknown>): PlanNode[] {
  const out: PlanNode[] = [];
  if (Array.isArray(op.nested_loop)) {
    for (const item of op.nested_loop) {
      out.push(...fromNestedLoopItem(item));
    }
  }
  if (op.table && typeof op.table === "object") {
    out.push(convertTable(op.table as Record<string, unknown>));
  }
  if (op.ordering_operation && typeof op.ordering_operation === "object") {
    out.push(convertOrderingOp(op.ordering_operation as Record<string, unknown>));
  }
  if (op.grouping_operation && typeof op.grouping_operation === "object") {
    out.push(convertGroupingOp(op.grouping_operation as Record<string, unknown>));
  }
  if (op.union_result && typeof op.union_result === "object") {
    out.push(convertUnionResult(op.union_result as Record<string, unknown>));
  }
  return out;
}

function convertOrderingOp(op: Record<string, unknown>): PlanNode {
  const ch = collectFromQueryBlockLike(op);
  const fs = op.using_filesort ? " (filesort)" : "";
  return {
    "Node Type": `Ordering${fs}`,
    Plans: ch.length ? ch : undefined,
  };
}

function convertGroupingOp(op: Record<string, unknown>): PlanNode {
  const ch = collectFromQueryBlockLike(op);
  const tmp = op.using_temporary_table ? " · tmp table" : "";
  return {
    "Node Type": `Grouping${tmp}`,
    Plans: ch.length ? ch : undefined,
  };
}

function convertUnionResult(op: Record<string, unknown>): PlanNode {
  const ch = collectFromQueryBlockLike(op);
  return {
    "Node Type": "Union",
    Plans: ch.length ? ch : undefined,
  };
}

function wrapSubqueryOp(label: string, op: Record<string, unknown>): PlanNode {
  if (op.query_block && typeof op.query_block === "object") {
    return {
      "Node Type": label,
      Plans: [convertQueryBlock(op.query_block as Record<string, unknown>)],
    };
  }
  const ch = collectFromQueryBlockLike(op);
  return {
    "Node Type": label,
    Plans: ch.length ? ch : undefined,
  };
}

function fromNestedLoopItem(item: unknown): PlanNode[] {
  if (!item || typeof item !== "object") return [];
  const o = item as Record<string, unknown>;
  const out: PlanNode[] = [];

  if (o.table && typeof o.table === "object") {
    out.push(convertTable(o.table as Record<string, unknown>));
  }
  if (o.query_block && typeof o.query_block === "object") {
    out.push(convertQueryBlock(o.query_block as Record<string, unknown>));
  }
  if (Array.isArray(o.nested_loop)) {
    for (const x of o.nested_loop) {
      out.push(...fromNestedLoopItem(x));
    }
  }
  for (const key of ["materialized_from_subquery", "optimized_away_subquery", "subquery"] as const) {
    const v = o[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(wrapSubqueryOp(key.replace(/_/g, " "), v as Record<string, unknown>));
    }
  }
  if (o.ordering_operation && typeof o.ordering_operation === "object") {
    out.push(convertOrderingOp(o.ordering_operation as Record<string, unknown>));
  }
  if (o.grouping_operation && typeof o.grouping_operation === "object") {
    out.push(convertGroupingOp(o.grouping_operation as Record<string, unknown>));
  }
  return out;
}

function convertQueryBlock(qb: Record<string, unknown>): PlanNode {
  const id = qb.select_id;
  const cost = costFromInfo(qb.cost_info);
  const children: PlanNode[] = collectFromQueryBlockLike(qb);

  for (const key of ["semi_join", "first_match", "loose_scan", "duplicate_removal", "buffer_result"] as const) {
    const v = qb[key];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      children.push(wrapSubqueryOp(key.replace(/_/g, " "), v as Record<string, unknown>));
    }
  }

  const msg = qb.message ? String(qb.message) : undefined;
  return {
    "Node Type": `Query Block (select_id=${id ?? "?"})`,
    "Total Cost": cost,
    ...(msg ? { Filter: msg } : {}),
    Plans: children.length ? children : undefined,
  };
}

/**
 * 将 MySQL EXPLAIN FORMAT=JSON 根对象转为单棵 PlanNode 树
 */
export function convertMysqlExplainJsonToPlanNode(root: unknown): PlanNode {
  if (!root || typeof root !== "object") {
    return { "Node Type": "(空执行计划)" };
  }
  const o = root as Record<string, unknown>;
  if (o.query_block && typeof o.query_block === "object") {
    return convertQueryBlock(o.query_block as Record<string, unknown>);
  }
  return convertQueryBlock(o);
}
