/**
 * EXPLAIN ANALYZE 执行计划树形可视化
 */

import { For, Show } from "solid-js";
import { vscode } from "./theme";

export interface PlanNode {
  "Node Type": string;
  "Startup Cost"?: number;
  "Total Cost"?: number;
  "Plan Rows"?: number;
  "Plan Width"?: number;
  "Actual Startup Time"?: number;
  "Actual Total Time"?: number;
  "Actual Rows"?: number;
  "Actual Loops"?: number;
  "Relation Name"?: string;
  Alias?: string;
  "Index Name"?: string;
  "Filter"?: string;
  "Index Cond"?: string;
  "Join Type"?: string;
  "Hash Cond"?: string;
  "Sort Key"?: string | string[];
  Plans?: PlanNode[];
  [key: string]: unknown;
}

export interface ExplainPlanViewerProps {
  plan: Array<{ Plan: PlanNode; "Planning Time"?: number; "Execution Time"?: number }>;
  onClose?: () => void;
}

function formatTime(ms: number | undefined): string {
  if (ms == null) return "—";
  return ms < 1 ? `${(ms * 1000).toFixed(2)} µs` : `${ms.toFixed(2)} ms`;
}

function formatCost(cost: number | undefined): string {
  if (cost == null) return "—";
  return cost.toFixed(2);
}

function PlanNodeRow(props: { node: PlanNode; depth: number; totalTime?: number }) {
  const node = () => props.node;
  const depth = () => props.depth;
  const totalTime = () => props.totalTime;
  const hasChildren = () => (node().Plans?.length ?? 0) > 0;

  const time = () => node()["Actual Total Time"] as number | undefined;
  const cost = () => node()["Total Cost"] as number | undefined;
  const rows = () => (node()["Actual Rows"] ?? node()["Plan Rows"]) as number | undefined;

  const timeRatio = () => {
    const t = time();
    const tot = totalTime();
    if (t == null || tot == null || tot <= 0) return 0;
    return Math.min(1, t / tot);
  };

  const barColor = () => {
    const r = timeRatio();
    if (r > 0.5) return vscode.error;
    if (r > 0.2) return vscode.warning;
    return vscode.success;
  };

  const details = () => {
    const n = node();
    const parts: string[] = [];
    if (n["Relation Name"]) parts.push(`on ${n.Alias ?? n["Relation Name"]}`);
    if (n["Index Name"]) parts.push(`using ${n["Index Name"]}`);
    if (n["Join Type"]) parts.push(`(${n["Join Type"]})`);
    if (n["Filter"]) parts.push(`Filter: ${n["Filter"]}`);
    if (n["Index Cond"]) parts.push(`Index Cond: ${n["Index Cond"]}`);
    if (n["Hash Cond"]) parts.push(`Hash Cond: ${n["Hash Cond"]}`);
    if (n["Sort Key"]) parts.push(`Sort: ${Array.isArray(n["Sort Key"]) ? n["Sort Key"].join(", ") : n["Sort Key"]}`);
    return parts.join(" · ");
  };

  return (
    <div style={{ display: "flex", "flex-direction": "column" }}>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "8px",
          padding: "6px 8px",
          "padding-left": `${12 + depth() * 20}px`,
          "font-size": "13px",
          "background-color": depth() % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
          "border-left": `3px solid ${depth() === 0 ? vscode.accent : vscode.border}`,
        }}
      >
        <span style={{ "font-weight": "600", color: vscode.accent, "min-width": "140px" }}>
          {node()["Node Type"]}
        </span>
        <span style={{ color: vscode.foregroundDim, "font-size": "12px" }}>
          cost={formatCost(node()["Startup Cost"] as number | undefined)}..{formatCost(cost())}
        </span>
        <span style={{ color: vscode.foregroundDim, "font-size": "12px" }}>
          rows={rows() ?? "—"}
        </span>
        <Show when={time() != null}>
          <span style={{ color: barColor(), "font-weight": "500", "font-size": "12px" }}>
            time={formatTime(time())}
          </span>
        </Show>
        <div
          style={{
            flex: 1,
            height: "6px",
            "max-width": "120px",
            "background-color": vscode.inputBg,
            "border-radius": "3px",
            overflow: "hidden",
          }}
          title={`${((timeRatio() || 0) * 100).toFixed(0)}% of total time`}
        >
          <div
            style={{
              width: `${(timeRatio() || 0) * 100}%`,
              height: "100%",
              "background-color": barColor(),
              "border-radius": "3px",
            }}
          />
        </div>
        <span style={{ color: vscode.foregroundDim, "font-size": "11px", "max-width": "300px", overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }} title={details()}>
          {details()}
        </span>
      </div>
      <Show when={hasChildren()}>
        <For each={node().Plans}>
          {(child) => <PlanNodeRow node={child} depth={depth() + 1} totalTime={totalTime()} />}
        </For>
      </Show>
    </div>
  );
}

export default function ExplainPlanViewer(props: ExplainPlanViewerProps) {
  const root = () => props.plan?.[0];
  const planNode = () => root()?.Plan;
  const planningTime = () => root()?.["Planning Time"];
  const executionTime = () => root()?.["Execution Time"];

  const totalTime = () => {
    const t = executionTime();
    if (t != null && t > 0) return t;
    const p = planNode();
    return p?.["Actual Total Time"] ?? 0;
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        overflow: "auto",
        "background-color": vscode.editorBg,
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": `1px solid ${vscode.border}`,
          display: "flex",
          "align-items": "center",
          gap: "16px",
          "flex-shrink": 0,
        }}
      >
        <span style={{ "font-size": "16px", "font-weight": "600", color: vscode.foreground }}>
          📊 执行计划
        </span>
        <span style={{ color: vscode.foregroundDim, "font-size": "13px" }}>
          规划: {formatTime(planningTime())} · 执行: {formatTime(executionTime())}
        </span>
        <Show when={props.onClose}>
          <button
            onClick={props.onClose}
            style={{
              "margin-left": "auto",
              padding: "6px 12px",
              "font-size": "12px",
              "background-color": vscode.inputBg,
              border: `1px solid ${vscode.border}`,
              color: vscode.foreground,
              "border-radius": "4px",
              cursor: "pointer",
            }}
          >
            关闭
          </button>
        </Show>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
        <Show when={planNode()} fallback={<div style={{ padding: "16px", color: vscode.foregroundDim }}>无执行计划</div>}>
          {(p) => <PlanNodeRow node={p()} depth={0} totalTime={totalTime()} />}
        </Show>
      </div>
    </div>
  );
}
