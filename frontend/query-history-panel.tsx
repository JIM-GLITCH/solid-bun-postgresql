import { createSignal, createEffect, For, Show } from "solid-js";
import {
  searchHistory,
  deleteEntry,
  clearHistory,
  type QueryHistoryEntry,
} from "./query-history";
import { vscode } from "./theme";

interface QueryHistoryPanelProps {
  onSelect: (sql: string) => void;
  /** 仅填入：在 Monaco 末尾空一行后插入，不替换 */
  onInsertAtEnd?: (sql: string) => void;
  /** 仅执行：直接执行 SQL，不修改编辑器 */
  onExecuteOnly?: (sql: string) => void;
  onSelectAndRun?: (sql: string) => void;
  onClose: () => void;
}

const PREVIEW_MAX_LEN = 80;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const entryDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (entryDate.getTime() === today.getTime()) {
    return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (entryDate.getTime() === yesterday.getTime()) {
    return `昨天 ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function truncateSql(sql: string, maxLen: number): string {
  const oneLine = sql.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen) + "…";
}

export default function QueryHistoryPanel(props: QueryHistoryPanelProps) {
  const [keyword, setKeyword] = createSignal("");
  const [timeFilter, setTimeFilter] = createSignal<"all" | "today" | "week">("all");
  const [entries, setEntries] = createSignal<QueryHistoryEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [refreshKey, setRefreshKey] = createSignal(0);
  const [expandedId, setExpandedId] = createSignal<string | null>(null);

  createEffect(() => {
    keyword();
    timeFilter();
    refreshKey(); // 删除/清空后刷新
    let opts: { keyword?: string; since?: number; until?: number } = {};
    if (keyword().trim()) opts.keyword = keyword().trim();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    if (timeFilter() === "today") {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      opts.since = todayStart.getTime();
    } else if (timeFilter() === "week") {
      opts.since = now - 7 * dayMs;
    }
    setLoading(true);
    searchHistory(opts)
      .then(setEntries)
      .catch((e) => {
        console.warn("加载查询历史失败:", e);
        setEntries([]);
      })
      .finally(() => setLoading(false));
  });

  const handleInsertAtEnd = (entry: QueryHistoryEntry) => {
    if (props.onInsertAtEnd) {
      props.onInsertAtEnd(entry.sql);
    } else {
      props.onSelect(entry.sql);
    }
  };

  const handleExecuteOnly = (entry: QueryHistoryEntry) => {
    if (props.onExecuteOnly) {
      props.onExecuteOnly(entry.sql);
    } else if (props.onSelectAndRun) {
      props.onSelectAndRun(entry.sql);
    } else {
      props.onSelect(entry.sql);
    }
  };

  const toggleExpanded = (entry: QueryHistoryEntry) => {
    setExpandedId((prev) => (prev === entry.id ? null : entry.id));
  };

  const handleDelete = async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteEntry(id);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.warn("删除失败:", e);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("确定清空全部查询历史？")) return;
    try {
      await clearHistory();
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.warn("清空失败:", e);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "background-color": vscode.sidebarBg,
        border: `1px solid ${vscode.border}`,
        "border-radius": "6px",
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: "8px 12px",
          "border-bottom": `1px solid ${vscode.border}`,
          display: "flex",
          "align-items": "center",
          "justify-content": "space-between",
        }}
      >
        <span style={{ "font-weight": "600", color: vscode.foreground }}>📜 查询历史</span>
        <button
          onClick={props.onClose}
          style={{
            padding: "4px 8px",
            "font-size": "12px",
            background: "none",
            border: "none",
            color: vscode.foregroundDim,
            cursor: "pointer",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
          onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
        >
          关闭
        </button>
      </div>

      {/* 搜索框 */}
      <div style={{ padding: "8px 12px", "border-bottom": `1px solid ${vscode.border}` }}>
        <input
          type="text"
          placeholder="按 SQL 内容搜索…"
          value={keyword()}
          onInput={(e) => setKeyword(e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            "font-size": "13px",
            "background-color": vscode.inputBg,
            color: vscode.inputFg,
            border: `1px solid ${vscode.inputBorder}`,
            "border-radius": "4px",
            "box-sizing": "border-box",
          }}
        />
        <div style={{ display: "flex", gap: "8px", "margin-top": "8px" }}>
          {(["all", "today", "week"] as const).map((f) => (
            <button
              onClick={() => setTimeFilter(f)}
              style={{
                padding: "4px 10px",
                "font-size": "12px",
                "background-color": timeFilter() === f ? vscode.buttonBg : vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "4px",
                cursor: "pointer",
              }}
            >
              {f === "all" ? "全部" : f === "today" ? "今天" : "本周"}
            </button>
          ))}
        </div>
      </div>

      {/* 操作栏 */}
      <div
        style={{
          padding: "6px 12px",
          "border-bottom": `1px solid ${vscode.border}`,
          display: "flex",
          "justify-content": "flex-end",
        }}
      >
        <Show when={entries().length > 0}>
          <button
            onClick={handleClearAll}
            style={{
              padding: "4px 10px",
              "font-size": "12px",
              "background-color": "transparent",
              color: vscode.error,
              border: `1px solid ${vscode.error}`,
              "border-radius": "4px",
              cursor: "pointer",
            }}
          >
            清空全部
          </button>
        </Show>
      </div>

      {/* 列表 */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "8px",
        }}
      >
        <Show when={loading()}>
          <div style={{ color: vscode.foregroundDim, "font-size": "13px", padding: "16px" }}>
            加载中…
          </div>
        </Show>
        <Show when={!loading() && entries().length === 0}>
          <div style={{ color: vscode.foregroundDim, "font-size": "13px", padding: "16px" }}>
            暂无历史记录
          </div>
        </Show>
        <Show when={!loading() && entries().length > 0}>
        <For each={entries()}>
          {(entry) => {
            const isExpanded = () => expandedId() === entry.id;
            return (
            <div
              style={{
                padding: "10px 12px",
                "margin-bottom": "6px",
                "background-color": vscode.inputBg,
                border: `1px solid ${vscode.border}`,
                "border-radius": "4px",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = vscode.inputBg)}
            >
              <div
                style={{
                  "font-family": "monospace",
                  "font-size": "12px",
                  color: vscode.foreground,
                  "word-break": "break-all",
                  "line-height": 1.4,
                  "margin-bottom": "6px",
                  cursor: "pointer",
                  "white-space": isExpanded() ? "pre-wrap" : "normal",
                }}
                onClick={() => toggleExpanded(entry)}
                title={isExpanded() ? "点击收起" : "点击显示完整 SQL"}
              >
                {isExpanded() ? entry.sql : truncateSql(entry.sql, PREVIEW_MAX_LEN)}
              </div>
              <div
                style={{
                  display: "flex",
                  "justify-content": "space-between",
                  "align-items": "center",
                }}
              >
                <span style={{ "font-size": "11px", color: vscode.foregroundDim }}>
                  {formatTime(entry.timestamp)}
                </span>
                <div style={{ display: "flex", gap: "4px", "flex-wrap": "wrap" }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExecuteOnly(entry);
                    }}
                    style={{
                      padding: "2px 8px",
                      "font-size": "11px",
                      "background-color": vscode.buttonBg,
                      color: "#fff",
                      border: "none",
                      "border-radius": "4px",
                      cursor: "pointer",
                    }}
                  >
                    仅执行
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleInsertAtEnd(entry);
                    }}
                    style={{
                      padding: "2px 8px",
                      "font-size": "11px",
                      "background-color": vscode.buttonSecondary,
                      color: vscode.foreground,
                      border: "none",
                      "border-radius": "4px",
                      cursor: "pointer",
                    }}
                  >
                    仅填入
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, entry.id)}
                    style={{
                      padding: "2px 8px",
                      "font-size": "11px",
                      "background-color": "transparent",
                      color: vscode.foregroundDim,
                      border: "none",
                      "border-radius": "4px",
                      cursor: "pointer",
                    }}
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>
          ); }}
        </For>
        </Show>
      </div>
    </div>
  );
}
