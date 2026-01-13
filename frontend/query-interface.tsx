import { createSignal, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import EditableCell from "./editable-cell";
import { type ColumnEditableInfo } from "../backend/column-editable";

// 待执行的 UPDATE 语句
interface PendingUpdate {
  sql: string;
  rowIndex: number;
  colIndex: number;
  oldValue: any;  // 原始值，用于还原
}

export default function QueryInterface() {
  const [sql, setSql] = createSignal('select * from student order by id');
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
    try {
      const response = await fetch('/api/postgres/query', {
        method: 'POST',
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql() })
      });
      const { error: err, result: data, columns } = await response.json();
      if (response.ok) {
        setResult(data);
        setColumns(columns);
        // 初始化列宽
        setColumnWidths(columns.map(() => 120));
        // 初始化修改状态（全部为 false）
        setModifiedCells(data.map((row: any[]) => row.map(() => false)));
      } else {
        setError(err || "查询失败");
      }
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
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

  // 执行所有待保存的 UPDATE
  async function saveAllChanges() {
    if (pendingUpdates().length === 0) return;

    setSaving(true);
    setError(null);

    try {
      for (const update of pendingUpdates()) {
        const response = await fetch('/api/postgres/query', {
          method: 'POST',
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: update.sql })
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
      <div>
        <div style={{
          "margin-bottom": "12px",
          color: "#6b7280",
          "font-size": "14px",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center"
        }}>
          <span>查询结果：共 {result.length} 行，{columns().length} 列</span>
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
            border: "1px solid #f59e0b"
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
        <div style={{ position: "relative", display: "inline-block" }}>
        <table style={{
          "border-collapse": "collapse",
          width: tableWidth() ? `${tableWidth()}px` : "auto",
          "min-width": "200px",
          "table-layout": "fixed",
          border: "1px solid #d1d5db"
        }}>
          <colgroup>
            <For each={columns()}>
              {(_, colIndex) => (
                <col style={{ width: `${columnWidths[colIndex()] || 120}px` }} />
              )}
            </For>
          </colgroup>
          <thead>
            <tr style={{ "background-color": "#f3f4f6" }}>
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
                      "user-select": "none"
                    }}
                  >
                    {col.name}
                    {/* 拖动调整列宽的手柄 */}
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
          <tbody>
            <For each={result}>
              {(row, rowIndex) => (
                <tr>
                  <For each={row}>
                    {(col, colIndex) => (
                      <EditableCell
                        value={col}
                        isEditable={columns()[colIndex()].isEditable}
                        isModified={modifiedCells[rowIndex()]?.[colIndex()] ?? false}
                        align={getAlignment(col)}
                        onSave={(newValue) => {
                          handleCellSave(rowIndex(), colIndex(), newValue);
                        }}
                      />
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        {/* 表格右边拖动调整整体宽度的手柄 */}
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
    );
  }

  return (
    <div style={{
      display: "flex",
      "flex-direction": "column",
      height: "100vh",
      padding: "24px"
    }}>
      {/* SQL输入部分 */}
      <div style={{ flex: 1, "margin-bottom": "16px", display: "flex", "flex-direction": "column" }}>
        <textarea
          style={{
            flex: 1,
            width: "100%",
            "font-size": "16px",
            "font-family": "monospace",
            "border-radius": "4px",
            padding: "12px",
            border: "1px solid #d1d5db",
            resize: "none",
            "box-sizing": "border-box"
          }}
          placeholder="在这里输入SQL语句，例如：SELECT * FROM your_table;"
          value={sql()}
          onInput={e => setSql(e.currentTarget.value)}
          rows={8}
        />
        <div>
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
        </div>
      </div>
      {/* 结果显示部分 */}
      <div style={{ flex: 1, "background-color": "#f9fafb", padding: "16px", "border-radius": "4px", overflow: "auto" }}>
        {renderResult()}
      </div>
    </div>
  );
}
