/**
 * 分区表：查看分区结构 + EXPLAIN 文本预览（分区裁剪，不执行 DML）
 */
import { createSignal, For, Show, onMount } from "solid-js";
import { explainQueryText, getPartitionInfo } from "./api";
import { getRegisteredDbType } from "./db-session-meta";
import { mysqlBacktickIdent, pgQuoteIdent } from "./sql-ddl-quote";
import { vscode, MODAL_Z_FULLSCREEN } from "./theme";

function defaultSelectSql(connectionId: string, schema: string, table: string): string {
  if (getRegisteredDbType(connectionId) === "mysql") {
    return `SELECT * FROM ${mysqlBacktickIdent(schema)}.${mysqlBacktickIdent(table)} LIMIT 100`;
  }
  return `SELECT * FROM ${pgQuoteIdent(schema)}.${pgQuoteIdent(table)} LIMIT 100`;
}

export interface PartitionTableModalProps {
  connectionId: string;
  schema: string;
  table: string;
  onClose: () => void;
}

type PartitionInfoResult = Awaited<ReturnType<typeof getPartitionInfo>>;

export default function PartitionTableModal(props: PartitionTableModalProps) {
  const [loading, setLoading] = createSignal(true);
  const [loadErr, setLoadErr] = createSignal<string | null>(null);
  const [info, setInfo] = createSignal<PartitionInfoResult | null>(null);

  const [sql, setSql] = createSignal(defaultSelectSql(props.connectionId, props.schema, props.table));
  const [explainLoading, setExplainLoading] = createSignal(false);
  const [explainLines, setExplainLines] = createSignal<string[] | null>(null);
  const [explainErr, setExplainErr] = createSignal<string | null>(null);

  onMount(() => {
    getPartitionInfo(props.connectionId, props.schema, props.table)
      .then((r) => setInfo(r))
      .catch((e) => {
        const msg = e instanceof Error ? e.message : String(e);
        // 某些环境下底层可能抛 JSON 解析错误（与分区元信息无关），降级为可用提示，避免整块不可用
        if (/Unexpected non-whitespace character after JSON/i.test(msg)) {
          setLoadErr("分区信息读取失败（响应解析异常）。你仍可使用下方 EXPLAIN 进行分区裁剪预览。");
          return;
        }
        setLoadErr(msg);
      })
      .finally(() => setLoading(false));
  });

  const runExplain = async () => {
    setExplainLoading(true);
    setExplainErr(null);
    setExplainLines(null);
    try {
      const r = await explainQueryText(props.connectionId, sql());
      setExplainLines(r.lines ?? []);
    } catch (e) {
      setExplainErr(e instanceof Error ? e.message : String(e));
    } finally {
      setExplainLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        "background-color": "rgba(0,0,0,0.55)",
        "z-index": MODAL_Z_FULLSCREEN,
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        padding: "16px",
        "box-sizing": "border-box",
      }}
      onClick={() => props.onClose()}
    >
      <div
        style={{
          width: "min(920px, 100%)",
          "max-height": "90vh",
          overflow: "auto",
          background: vscode.editorBg,
          color: vscode.foreground,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          "box-shadow": "0 16px 48px rgba(0,0,0,0.45)",
          display: "flex",
          "flex-direction": "column",
          gap: "12px",
          padding: "16px 20px",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <span style={{ "font-size": "15px", "font-weight": "600" }}>
            分区表：{props.schema}.{props.table}
          </span>
          <button
            type="button"
            onClick={() => props.onClose()}
            style={{
              background: "transparent",
              border: "none",
              color: vscode.foregroundDim,
              cursor: "pointer",
              "font-size": "18px",
              "line-height": 1,
            }}
          >
            ×
          </button>
        </div>

        <Show when={loading()}>
          <div style={{ color: vscode.foregroundDim, "font-size": "13px" }}>加载分区信息…</div>
        </Show>
        <Show when={loadErr()}>
          <div style={{ color: vscode.error, "font-size": "13px" }}>{loadErr()}</div>
        </Show>

        <Show when={!loading() && !loadErr() && info()?.role === "none"}>
          <div
            style={{
              padding: "12px",
              background: vscode.inputBg,
              "border-radius": "6px",
              color: vscode.foregroundDim,
              "font-size": "13px",
            }}
          >
            {getRegisteredDbType(props.connectionId) === "mysql"
              ? "当前表在 information_schema 中未表现为分区表（可能为普通表）。下方仍可对任意 SQL 做 EXPLAIN 预览。"
              : "当前表即不是「分区父表」，也不在声明式分区下作为「分区子表」（可能为普通表，或仅使用传统继承）。下方仍可对任意 SQL 做 EXPLAIN 预览。"}
          </div>
        </Show>

        <Show when={info()?.role === "parent"}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
            <div style={{ "font-size": "13px", "font-weight": "600" }}>分区结构</div>
            <div style={{ "font-size": "12px", color: vscode.foregroundDim }}>
              策略：<span style={{ color: vscode.foreground }}>{(info() as { strategy?: string })?.strategy ?? "—"}</span>
              {" · "}
              分区键：<span style={{ color: vscode.foreground, "font-family": "monospace" }}>
                {(info() as { partitionKey?: string })?.partitionKey ?? "—"}
              </span>
            </div>
            <div style={{ overflow: "auto", "max-height": "220px", border: `1px solid ${vscode.border}`, "border-radius": "6px" }}>
              <table style={{ width: "100%", "border-collapse": "collapse", "font-size": "12px" }}>
                <thead>
                  <tr style={{ "text-align": "left", background: vscode.sidebarBg }}>
                    <th style={{ padding: "8px", borderBottom: `1px solid ${vscode.border}` }}>
                      {getRegisteredDbType(props.connectionId) === "mysql" ? "分区（库.分区名）" : "分区（schema.name）"}
                    </th>
                    <th style={{ padding: "8px", borderBottom: `1px solid ${vscode.border}` }}>边界 / 约束</th>
                  </tr>
                </thead>
                <tbody>
                  <For
                    each={(info() as { partitions?: { qualified: string; bound: string }[] })?.partitions ?? []}
                  >
                    {(p) => (
                      <tr>
                        <td style={{ padding: "8px", borderBottom: `1px solid ${vscode.border}`, "font-family": "monospace" }}>
                          {p.qualified}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            borderBottom: `1px solid ${vscode.border}`,
                            "font-family": "monospace",
                            color: vscode.foregroundDim,
                          }}
                        >
                          {p.bound || "—"}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </div>
        </Show>

        <Show when={info()?.role === "partition"}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "font-size": "13px" }}>
            <div style={{ "font-weight": "600" }}>分区子表</div>
            <div style={{ color: vscode.foregroundDim }}>
              父表：
              <span style={{ color: vscode.foreground, "font-family": "monospace" }}>
                {(info() as { parentQualified?: string })?.parentQualified}
              </span>
            </div>
            <div style={{ color: vscode.foregroundDim }}>
              策略 / 分区键：
              <span style={{ color: vscode.foreground }}>{(info() as { strategy?: string })?.strategy ?? "—"}</span>
              <span style={{ "font-family": "monospace", "margin-left": "6px" }}>
                {(info() as { partitionKey?: string })?.partitionKey ?? ""}
              </span>
            </div>
                <div style={{ color: vscode.foregroundDim }}>
                  本子表边界：
                  <span style={{ color: vscode.foreground, "font-family": "monospace" }}>
                    {(info() as { thisBound?: string })?.thisBound || "—"}
                  </span>
                </div>
          </div>
        </Show>

        <div style={{ height: "1px", background: vscode.border, margin: "4px 0" }} />

        <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
          <div style={{ "font-size": "13px", "font-weight": "600" }}>分区裁剪预览（EXPLAIN，不执行查询）</div>
          <div style={{ color: vscode.foregroundDim, "font-size": "12px" }}>
            {getRegisteredDbType(props.connectionId) === "mysql"
              ? "修改 WHERE 等条件后点「EXPLAIN 预览」：结果里 partitions 列会显示可能扫描的分区。需要树形/JSON 计划时，把上方内容改成 `FORMAT=TREE SELECT …` 或 `FORMAT=JSON SELECT …`（不要写开头的 EXPLAIN，后端会自动加）。"
              : "修改 WHERE / JOIN 等条件后执行 EXPLAIN，从计划中可观察实际会扫描的分区（如 Append 下的子计划）。复杂场景可配合 PostgreSQL 分区裁剪规则理解。"}
          </div>
          <textarea
            value={sql()}
            onInput={(e) => setSql(e.currentTarget.value)}
            aria-label="用于 EXPLAIN 预览的 SQL"
            placeholder="输入 SELECT … 等，仅生成执行计划，不执行查询"
            rows={6}
            style={{
              width: "100%",
              "box-sizing": "border-box",
              resize: "vertical",
              background: vscode.inputBg,
              color: vscode.inputFg,
              border: `1px solid ${vscode.inputBorder}`,
              "border-radius": "6px",
              padding: "10px",
              "font-family": "Consolas, monospace",
              "font-size": "12px",
            }}
            spellcheck={false}
          />
          <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
            <button
              type="button"
              onClick={runExplain}
              disabled={explainLoading()}
              style={{
                background: explainLoading() ? vscode.buttonSecondary : vscode.buttonBg,
                color: vscode.foreground,
                border: "none",
                "border-radius": "6px",
                padding: "6px 14px",
                cursor: explainLoading() ? "not-allowed" : "pointer",
                "font-size": "13px",
              }}
            >
              {explainLoading() ? "执行中…" : "EXPLAIN 预览"}
            </button>
            <button
              type="button"
              onClick={() => setSql(defaultSelectSql(props.connectionId, props.schema, props.table))}
              style={{
                background: vscode.buttonSecondary,
                color: vscode.foreground,
                border: "none",
                "border-radius": "6px",
                padding: "6px 14px",
                cursor: "pointer",
                "font-size": "13px",
              }}
            >
              重置示例 SQL
            </button>
          </div>
          <Show when={explainErr()}>
            <div style={{ color: vscode.error, "font-size": "12px", "white-space": "pre-wrap" }}>{explainErr()}</div>
          </Show>
          <Show when={explainLines()}>
            <pre
              style={{
                margin: 0,
                padding: "12px",
                background: vscode.sidebarBg,
                border: `1px solid ${vscode.border}`,
                "border-radius": "6px",
                "font-size": "12px",
                "line-height": "1.45",
                overflow: "auto",
                "max-height": "280px",
                "font-family": "Consolas, monospace",
              }}
            >
              {(explainLines() ?? []).join("\n")}
            </pre>
          </Show>
        </div>
      </div>
    </div>
  );
}
