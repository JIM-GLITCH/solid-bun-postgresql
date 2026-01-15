import { createSignal, For, Show, onMount, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import EditableCell from "./editable-cell";
import { type ColumnEditableInfo } from "../backend/column-editable";
import { getSessionId } from "./session";

// SSE 消息类型
interface SSEMessage {
  type: 'notice' | 'error' | 'info' | 'warning' | 'query' | 'notification';
  message: string;
  timestamp: number;
  detail?: string;
}

// 待执行的 UPDATE 语句
interface PendingUpdate {
  sql: string;
  rowIndex: number;
  colIndex: number;
  oldValue: any;  // 原始值，用于还原
}

export default function QueryInterface() {
  const [sql, setSql] = createSignal(`select * from student`);
  const [result, setResult] = createStore<any[][]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [columns, setColumns] = createSignal<ColumnEditableInfo[]>([]);
  const [pendingUpdates, setPendingUpdates] = createSignal<PendingUpdate[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [showPendingSql, setShowPendingSql] = createSignal(false);
  const [columnWidths, setColumnWidths] = createStore<number[]>([]);
  const [tableWidth, setTableWidth] = createSignal<number | null>(null);  // 表格总宽度
  const [modifiedCells, setModifiedCells] = createStore<boolean[][]>([]);  // 单元格修改状态
  const [queryDuration, setQueryDuration] = createSignal<number | null>(null);  // 查询耗时（毫秒）
  const [notices, setNotices] = createSignal<SSEMessage[]>([]);  // 数据库通知消息
  const [sseConnected, setSseConnected] = createSignal(false);  // SSE 连接状态
  const [messagesCollapsed, setMessagesCollapsed] = createSignal(true);  // 消息面板折叠状态，默认折叠
  const [hasMore, setHasMore] = createSignal(false);  // 是否还有更多数据
  const [loadingMore, setLoadingMore] = createSignal(false);  // 是否正在加载更多

  // 虚拟滚动相关状态
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(600);
  const ROW_HEIGHT = 40; // 预估行高
  const OVERSCAN = 10; // 预渲染行数

  const visibleRange = () => {
    const start = Math.floor(scrollTop() / ROW_HEIGHT);
    const end = Math.ceil((scrollTop() + containerHeight()) / ROW_HEIGHT);
    return {
      start: Math.max(0, start - OVERSCAN),
      end: Math.min(result.length, end + OVERSCAN)
    };
  };

  const visibleRows = () => {
    const { start, end } = visibleRange();
    return result.slice(start, end).map((row, i) => ({ row, index: start + i }));
  };

  const totalHeight = () => result.length * ROW_HEIGHT;
  const offsetY = () => visibleRange().start * ROW_HEIGHT;

  // SSE 连接 - 依赖 EventSource 的自动重连机制
  let eventSource: EventSource | null = null;

  onMount(() => {
    // 监听窗口大小变化以更新容器高度
    const updateHeight = () => {
      const el = document.getElementById('table-container');
      if (el) setContainerHeight(el.clientHeight);
    };
    window.addEventListener('resize', updateHeight);
    updateHeight();
    onCleanup(() => window.removeEventListener('resize', updateHeight));

    const sessionId = getSessionId();
    eventSource = new EventSource(`/api/events?sessionId=${sessionId}`);

    eventSource.onopen = () => {
      console.log('SSE 连接已建立');
      setSseConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);
        console.log('收到 SSE 消息:', message);
        setNotices(prev => [...prev.slice(-49), message]);
      } catch (e) {
        console.error('解析 SSE 消息失败:', e);
      }
    };

    eventSource.onerror = () => {
      // EventSource 会自动重连，这里只更新状态
      // readyState: 0=CONNECTING, 1=OPEN, 2=CLOSED
      if (eventSource?.readyState === EventSource.CONNECTING) {
        console.log('SSE 重连中...');
      }
      setSseConnected(false);
    };
  });

  onCleanup(() => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
  });

  // 清除所有通知
  function clearNotices() {
    setNotices([]);
  }

  // 格式化查询耗时
  function formatDuration(ms: number): string {
    if (ms < 1000) {
      return `${Math.round(ms)} ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)} s`;
    } else {
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(1);
      return `${minutes} m ${seconds} s`;
    }
  }

  // 判断值是否为数字类型
  function isNumericValue(value: any): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return true;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed !== '' && !isNaN(Number(trimmed));
    }
    return false;
  }

  // 根据值类型获取对齐方式
  function getAlignment(value: any): "left" | "right" {
    if (typeof value === 'number' || typeof value === 'boolean' || isNumericValue(value)) {
      return "right";
    }
    return "left";
  }

  // 开始拖动调整列宽
  function startResize(colIndex: number, e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = columnWidths[colIndex] || 120;

    const onMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(60, startWidth + diff);
      setColumnWidths(colIndex, newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // 开始拖动调整表格总宽度
  function startTableResize(e: MouseEvent) {
    e.preventDefault();
    const startX = e.clientX;
    // 获取当前表格宽度，如果没有设置过就用所有列宽之和
    const startWidth = tableWidth() || columnWidths.reduce((sum, w) => sum + (w || 120), 0);

    const onMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(200, startWidth + diff);  // 最小宽度200px
      setTableWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  async function runQuery() {
    setLoading(true);
    setError(null);
    setResult([]);  // 清空 store
    setPendingUpdates([]);  // 清空待执行的更新
    setQueryDuration(null);  // 清空上次查询耗时
    setHasMore(false);
    setModifiedCells([]);
    const startTime = performance.now();  // 记录开始时间
    try {
      const sessionId = getSessionId();
      const response = await fetch('/api/postgres/query-stream', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql(), sessionId, batchSize: 100 })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "查询失败");
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // 设置列信息
      setColumns(data.columns || []);
      setColumnWidths((data.columns || []).map(() => 120));

      // 设置行数据
      const rows = data.rows || [];
      setResult(rows);

      // 初始化修改状态矩阵
      const colCount = (data.columns || []).length;
      setModifiedCells(rows.map(() => Array(colCount).fill(false)));

      // 记录是否还有更多数据
      setHasMore(data.hasMore || false);

      setQueryDuration(performance.now() - startTime);
      console.log(`查询完成: ${rows.length} 行, hasMore: ${data.hasMore}`);
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  }

  // 加载更多数据
  async function loadMore() {
    if (loadingMore() || !hasMore()) return;

    setLoadingMore(true);
    try {
      const sessionId = getSessionId();
      const response = await fetch('/api/postgres/query-stream-more', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, batchSize: 100 })
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "加载失败");
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      // 追加行数据
      const newRows = data.rows || [];
      if (newRows.length > 0) {
        setResult(prev => [...prev, ...newRows]);

        // 同步更新修改状态矩阵
        const colCount = columns().length;
        const newModifiedRows = newRows.map(() => Array(colCount).fill(false));
        setModifiedCells(prev => [...prev, ...newModifiedRows]);
      }

      setHasMore(data.hasMore || false);
      console.log(`加载更多: +${newRows.length} 行, hasMore: ${data.hasMore}`);
    } catch (e: any) {
      console.error("加载更多失败:", e.message);
    } finally {
      setLoadingMore(false);
    }
  }

  // 检测是否滚动到底部附近
  function handleScroll(e: Event) {
    const target = e.currentTarget as HTMLElement;
    setScrollTop(target.scrollTop);

    // 当滚动到距离底部 200px 时，加载更多
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (scrollBottom < 200 && hasMore() && !loadingMore()) {
      loadMore();
    }
  }

  // 取消正在执行的查询
  async function cancelQuery() {
    try {
      const sessionId = getSessionId();
      const response = await fetch('/api/postgres/cancel-query', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId })
      });
      const { success, message, error: err } = await response.json();
      if (success) {
        console.log("查询取消:", message);
      } else {
        console.warn("取消失败:", err || message);
      }
    } catch (e: any) {
      console.error("取消请求失败:", e.message);
    }
  }

  // 格式化 SQL 值（处理字符串转义、null 等）
  function formatSqlValue(value: any): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    // 字符串需要转义单引号
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  // 生成 UPDATE SQL
  function generateUpdateSql(rowIndex: number, colIndex: number, newValue: string): string {
    const colInfo = columns()[colIndex];
    const row = result[rowIndex];

    // 构建 WHERE 条件
    const whereConditions = colInfo.uniqueKeyColumns!.map(keyColName => {
      // 找到唯一键列在 columns 中的索引
      const keyColIndex = columns().findIndex(c => c.columnName === keyColName);
      const keyValue = row[keyColIndex];
      return `${keyColName} = ${formatSqlValue(keyValue)}`;
    });

    return `UPDATE ${colInfo.tableName} SET ${colInfo.columnName} = ${formatSqlValue(newValue)} WHERE ${whereConditions.join(' AND ')}`;
  }

  // 处理单元格保存
  function handleCellSave(rowIndex: number, colIndex: number, newValue: string) {
    const currentValue = result[rowIndex][colIndex];

    // 如果值没有变化，不生成 UPDATE
    if (String(currentValue) === newValue) return;

    // 查找是否已有该单元格的更新记录（保留最初的原始值）
    const existingUpdate = pendingUpdates().find(u => u.rowIndex === rowIndex && u.colIndex === colIndex);
    const originalValue = existingUpdate ? existingUpdate.oldValue : currentValue;

    // 生成 UPDATE SQL
    const updateSql = generateUpdateSql(rowIndex, colIndex, newValue);

    // 更新本地数据
    setResult(rowIndex, colIndex, newValue);
    // 标记为已修改
    setModifiedCells(rowIndex, colIndex, true);

    // 添加到待执行列表（如果同一个单元格已有更新，替换它，但保留原始值）
    setPendingUpdates(prev => {
      const filtered = prev.filter(u => !(u.rowIndex === rowIndex && u.colIndex === colIndex));
      return [...filtered, { sql: updateSql, rowIndex, colIndex, oldValue: originalValue }];
    });
  }

  // 删除一条待执行的更新，并还原单元格的值
  function removePendingUpdate(index: number) {
    const update = pendingUpdates()[index];
    if (!update) return;

    // 还原单元格的值
    setResult(update.rowIndex, update.colIndex, update.oldValue);
    // 取消修改标记
    setModifiedCells(update.rowIndex, update.colIndex, false);

    // 从待执行列表中移除
    setPendingUpdates(prev => prev.filter((_, i) => i !== index));
  }

  // 执行所有待保存的 UPDATE（使用 adminClient）
  async function saveAllChanges() {
    if (pendingUpdates().length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const sessionId = getSessionId();
      for (const update of pendingUpdates()) {
        const response = await fetch('/api/postgres/save-changes', {
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: update.sql, sessionId })
        });

        if (!response.ok) {
          const { error: err } = await response.json();
          throw new Error(err || `执行失败: ${update.sql}`);
        }
      }

      // 全部成功，清空修改标记（只更新被修改过的单元格）
      for (const update of pendingUpdates()) {
        setModifiedCells(update.rowIndex, update.colIndex, false);
      }
      // 清空待执行列表
      setPendingUpdates([]);
      alert('保存成功！');
    } catch (e: any) {
      setError(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function renderResult() {
    if (loading()) {
      return (<div style={{ padding: "16px", "text-align": "center" }}>
        查询中...
      </div>);
    }
    if (error()) {
      return (<div style={{ color: "red", padding: "16px" }}>
        {error()}
      </div>);
    }
    return (
      <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
        <div style={{
          "margin-bottom": "12px",
          color: "#6b7280",
          "font-size": "14px",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          "flex-shrink": "0"
        }}>
          <span>
            查询结果：{hasMore() ? "已加载" : "共"} {result.length} 行，{columns().length} 列
            <Show when={hasMore()}>
              <span style={{ "margin-left": "8px", color: "#3b82f6" }}>
                (滚动加载更多)
              </span>
            </Show>
            <Show when={loadingMore()}>
              <span style={{ "margin-left": "8px", color: "#f59e0b" }}>
                加载中...
              </span>
            </Show>
            <Show when={queryDuration() !== null}>
              <span style={{ "margin-left": "12px", color: "#10b981" }}>
                耗时 {formatDuration(queryDuration()!)}
              </span>
            </Show>
          </span>
          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <span style={{ color: pendingUpdates().length > 0 ? "#f59e0b" : "#9ca3af" }}>
              {pendingUpdates().length} 个待保存的修改
            </span>
            <button
              onClick={() => setShowPendingSql(!showPendingSql())}
              style={{
                padding: "6px 16px",
                "font-size": "14px",
                "background-color": "#6b7280",
                color: "#fff",
                border: "none",
                "border-radius": "4px",
                cursor: "pointer"
              }}
            >
              {showPendingSql() ? "隐藏 SQL" : "查看修改"}
            </button>
            <button
              onClick={saveAllChanges}
              disabled={saving() || pendingUpdates().length === 0}
              style={{
                padding: "6px 16px",
                "font-size": "14px",
                "background-color": pendingUpdates().length > 0 ? "#10b981" : "#9ca3af",
                color: "#fff",
                border: "none",
                "border-radius": "4px",
                cursor: (saving() || pendingUpdates().length === 0) ? "not-allowed" : "pointer"
              }}
            >
              {saving() ? "保存中..." : "保存修改"}
            </button>
          </div>
        </div>
        <Show when={showPendingSql()}>
          <div style={{
            "margin-bottom": "12px",
            padding: "12px",
            "background-color": "#fef3c7",
            "border-radius": "4px",
            border: "1px solid #f59e0b",
            "flex-shrink": "0"
          }}>
            <div style={{ "font-weight": "bold", "margin-bottom": "8px", color: "#92400e" }}>
              待执行的 UPDATE SQL:
            </div>
            <Show when={pendingUpdates().length === 0}>
              <div style={{ color: "#9ca3af", "font-size": "13px" }}>暂无修改</div>
            </Show>
            <div style={{
              "max-height": "200px",
              "overflow-y": "auto",
              display: "flex",
              "flex-direction": "column",
              gap: "6px"
            }}>
              <For each={pendingUpdates()}>
                {(update, index) => (
                  <div style={{
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                    padding: "6px 8px",
                    "background-color": "#fffbeb",
                    "border-radius": "4px",
                    border: "1px solid #fcd34d"
                  }}>
                    <span style={{
                      flex: "1",
                      "font-family": "monospace",
                      "font-size": "13px",
                      "word-break": "break-all"
                    }}>
                      {index() + 1}. {update.sql};
                    </span>
                    <button
                      onClick={() => removePendingUpdate(index())}
                      style={{
                        padding: "2px 8px",
                        "font-size": "12px",
                        "background-color": "#ef4444",
                        color: "#fff",
                        border: "none",
                        "border-radius": "4px",
                        cursor: "pointer",
                        "flex-shrink": "0"
                      }}
                      title="删除此修改并还原值"
                    >
                      删除
                    </button>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* 虚拟滚动表格容器 */}
        <div
          id="table-container"
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflow: "auto",
            position: "relative",
            border: "1px solid #d1d5db",
            "background-color": "#fff"
          }}
        >
          {/* 撑开滚动条的占位层 */}
          <div style={{ height: `${totalHeight()}px`, width: "100%", position: "absolute", top: 0, left: 0, "pointer-events": "none" }} />

          <div style={{
            position: "sticky",
            top: 0,
            left: 0,
            width: "max-content",
            "z-index": 10
          }}>
            <table style={{
              "border-collapse": "collapse",
              width: tableWidth() ? `${tableWidth()}px` : "auto",
              "min-width": "100%",
              "table-layout": "fixed",
            }}>
              <colgroup>
                <For each={columns()}>
                  {(_, colIndex) => (
                    <col style={{ width: `${columnWidths[colIndex()] || 120}px` }} />
                  )}
                </For>
              </colgroup>
              <thead style={{ position: "sticky", top: 0, "z-index": 20, "background-color": "#f3f4f6" }}>
                <tr>
                  <For each={columns()}>
                    {(col, colIndex) => (
                      <th
                        scope="col"
                        style={{
                          padding: "8px 12px",
                          "text-align": "center",
                          "font-weight": "600",
                          border: "1px solid #d1d5db",
                          position: "relative",
                          "user-select": "none",
                          height: `${ROW_HEIGHT}px`,
                          "box-sizing": "border-box"
                        }}
                      >
                        {col.name}
                        <div
                          onMouseDown={(e) => startResize(colIndex(), e)}
                          style={{
                            position: "absolute",
                            right: "-3px",
                            top: "0",
                            bottom: "0",
                            width: "6px",
                            cursor: "col-resize",
                            "background-color": "transparent",
                            "z-index": "10"
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2563eb")}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        />
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody style={{
                // 使用占位行来实现虚拟滚动，这样可以保持完美的表格布局
              }}>
                {/* 顶部占位行 */}
                <tr style={{ height: `${offsetY()}px` }}>
                  <td colSpan={columns().length} style={{ padding: 0, border: "none" }} />
                </tr>

                <For each={visibleRows()}>
                  {({ row, index: rowIndex }) => (
                    <tr style={{ height: `${ROW_HEIGHT}px`, "box-sizing": "border-box" }}>
                      <For each={row}>
                        {(col, colIndex) => (
                          <EditableCell
                            value={col}
                            isEditable={columns()[colIndex()].isEditable}
                            isModified={modifiedCells[rowIndex]?.[colIndex()] ?? false}
                            align={getAlignment(col)}
                            onSave={(newValue) => {
                              handleCellSave(rowIndex, colIndex(), newValue);
                            }}
                          />
                        )}
                      </For>
                    </tr>
                  )}
                </For>

                {/* 底部占位行 */}
                <tr style={{ height: `${Math.max(0, totalHeight() - offsetY() - (visibleRows().length * ROW_HEIGHT))}px` }}>
                  <td colSpan={columns().length} style={{ padding: 0, border: "none" }} />
                </tr>
              </tbody>
            </table>

            {/* 调整表格总宽度的手柄 */}
            <div
              onMouseDown={startTableResize}
              style={{
                position: "absolute",
                right: "-4px",
                top: "0",
                bottom: "0",
                width: "8px",
                cursor: "ew-resize",
                "background-color": "transparent",
                "z-index": "20"
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#10b981")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      height: "100vh",
      padding: "24px",
      overflow: "hidden",
      "box-sizing": "border-box"
    }}>
      {/* SQL输入部分 - 固定高度 */}
      <div style={{ "flex-shrink": "0", "margin-bottom": "16px", display: "flex", "flex-direction": "column" }}>
        <textarea
          style={{
            height: "120px",
            width: "100%",
            "font-size": "16px",
            "font-family": "monospace",
            "border-radius": "4px",
            padding: "12px",
            border: "1px solid #d1d5db",
            resize: "vertical",
            "box-sizing": "border-box"
          }}
          placeholder="在这里输入SQL语句，例如：SELECT * FROM your_table;"
          value={sql()}
          onInput={e => setSql(e.currentTarget.value)}
        />
        <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
          <button
            onClick={runQuery}
            disabled={loading() || sql().trim().length === 0}
            style={{
              margin: "8px 0",
              padding: "8px 18px",
              "font-size": "16px",
              "background-color": "#2563eb",
              color: "#fff",
              border: "none",
              "border-radius": "4px",
              cursor: loading() ? "not-allowed" : "pointer"
            }}
          >执行</button>
          <Show when={loading()}>
            <button
              onClick={cancelQuery}
              style={{
                margin: "8px 0",
                padding: "8px 18px",
                "font-size": "16px",
                "background-color": "#ef4444",
                color: "#fff",
                border: "none",
                "border-radius": "4px",
                cursor: "pointer"
              }}
            >中断查询</button>
          </Show>
        </div>
      </div>
      {/* 结果显示部分 */}
      <div style={{ flex: 1, "min-height": "200px", "background-color": "#f9fafb", padding: "16px", "border-radius": "4px", overflow: "hidden", display: "flex", "flex-direction": "column" }}>
        {renderResult()}
      </div>

      {/* 数据库通知消息区域 - 可折叠，固定高度不挤压上方内容 */}
      <div style={{
        "margin-top": "16px",
        "background-color": "#1e293b",
        "border-radius": "4px",
        padding: "12px",
        "flex-shrink": "0"
      }}>
        {/* 标题栏 - 固定不滚动 */}
        <div style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          cursor: "pointer",
          "user-select": "none"
        }} onClick={() => setMessagesCollapsed(!messagesCollapsed())}>
          <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
            <span style={{
              color: "#94a3b8",
              "font-size": "12px",
              transition: "transform 0.2s",
              transform: messagesCollapsed() ? "rotate(-90deg)" : "rotate(0deg)"
            }}>▼</span>
            <span style={{ color: "#94a3b8", "font-size": "13px", "font-weight": "600" }}>
              数据库消息
            </span>
            <span style={{
              width: "8px",
              height: "8px",
              "border-radius": "50%",
              "background-color": sseConnected() ? "#22c55e" : "#ef4444"
            }} title={sseConnected() ? "SSE 已连接" : "SSE 未连接"} />
            <Show when={notices().length > 0}>
              <span style={{
                color: "#64748b",
                "font-size": "12px",
                "background-color": "#475569",
                padding: "1px 6px",
                "border-radius": "10px"
              }}>
                {notices().length}
              </span>
            </Show>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); clearNotices(); }}
            style={{
              padding: "2px 8px",
              "font-size": "12px",
              "background-color": "#475569",
              color: "#e2e8f0",
              border: "none",
              "border-radius": "4px",
              cursor: "pointer"
            }}
          >
            清除
          </button>
        </div>

        {/* 消息列表 - 可折叠、可滚动 */}
        <Show when={!messagesCollapsed()}>
          <div style={{
            "margin-top": "8px",
            "max-height": "180px",
            "overflow-y": "auto"
          }}>
            <Show when={notices().length === 0}>
              <div style={{ color: "#64748b", "font-size": "13px" }}>暂无消息</div>
            </Show>
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
              <For each={notices()}>
                {(notice) => {
                  // 根据消息类型设置颜色
                  const typeColors: Record<string, { bg: string; label: string; text: string }> = {
                    error: { bg: '#4c1d1d', label: '#fca5a5', text: '#fecaca' },
                    warning: { bg: '#422006', label: '#fbbf24', text: '#fde68a' },
                    notice: { bg: '#1e3a5f', label: '#60a5fa', text: '#93c5fd' },
                    info: { bg: '#334155', label: '#94a3b8', text: '#cbd5e1' },
                    query: { bg: '#1e3a3a', label: '#2dd4bf', text: '#99f6e4' },
                    notification: { bg: '#3b1d4a', label: '#c084fc', text: '#d8b4fe' },
                  };
                  const colors = typeColors[notice.type] || typeColors.info;

                  return (
                    <div style={{
                      "font-family": "monospace",
                      "font-size": "13px",
                      "padding": "4px 8px",
                      "background-color": colors.bg,
                      "border-radius": "4px",
                      display: "flex",
                      gap: "8px",
                      "flex-wrap": "wrap"
                    }}>
                      <span style={{ color: "#64748b", "flex-shrink": "0" }}>
                        {new Date(notice.timestamp).toLocaleTimeString()}
                      </span>
                      <span style={{
                        color: colors.label,
                        "font-weight": "500",
                        "flex-shrink": "0"
                      }}>
                        [{notice.type.toUpperCase()}]
                      </span>
                      <span style={{ color: colors.text }}>{notice.message}</span>
                      {notice.detail && (
                        <span style={{ color: "#9ca3af", "font-size": "12px", width: "100%", "padding-left": "70px" }}>
                          ↳ {notice.detail}
                        </span>
                      )}
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
