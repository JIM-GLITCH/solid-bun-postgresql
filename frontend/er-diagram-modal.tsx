/**
 * ER 图查看器 - Visual Query Builder 风格
 * 无限画布 + 可拖拽表卡片 + SVG 连线
 */

import { createSignal, createEffect, Show, For, createMemo, onCleanup } from "solid-js";
import { getTables, getColumns, getForeignKeys, getPrimaryKeys } from "./api";
import { vscode } from "./theme";

export interface ErDiagramSelection {
  schemas: string[];
  tablesBySchema: Record<string, string[]>;
}

interface ErDiagramModalProps {
  connectionId: string;
  /** 单 schema 模式（从 schema 右键打开） */
  schema?: string;
  /** 多 schema 模式（从 connection 右键打开，经选择器） */
  selection?: ErDiagramSelection;
  onClose: () => void;
}

interface TableColumn {
  column_name: string;
  data_type: string;
  is_nullable: string;
  isPrimaryKey: boolean;
}

interface TableNode {
  id: string;
  schema: string;
  name: string;
  columns: TableColumn[];
  position: { x: number; y: number };
  width: number;
  height: number;
}

interface ForeignKeyEdge {
  id: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

// 生成唯一 ID
function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// 简化类型名用于显示（缩短长类型避免遮挡）
function simplifyTypeForDisplay(type: string): string {
  const t = type.replace(/\s*\([^)]*\)/g, "").toLowerCase();
  const map: Record<string, string> = {
    "character varying": "varchar",
    "character": "char",
    "timestamp without time zone": "timestamptz",
    "timestamp with time zone": "timestamptz",
    "time without time zone": "time",
    "time with time zone": "timetz",
    "double precision": "float8",
    "integer": "int4",
    "bigint": "int8",
    "smallint": "int2",
  };
  return map[t] ?? t;
}

// 根据内容预计算表宽度，避免列名/类型被遮挡
function calculateTableWidth(tableName: string, columns: TableColumn[]): number {
  const CHAR_W_NAME = 7.5;   // 列名 12px 字体约 7.5px/字符
  const CHAR_W_TYPE = 6.5;   // 类型 11px 字体约 6.5px/字符
  const CHAR_W_TITLE = 8;    // 表名 13px 字体约 8px/字符
  const PAD = 12 * 2;        // 左右 padding
  const GAP = 8;
  const PK_ICON = 16;
  const NULL_MARKER = 10;

  let maxRowWidth = 0;
  for (const col of columns) {
    const typeStr = simplifyTypeForDisplay(col.data_type);
    const rowW =
      PAD +
      PK_ICON +
      GAP +
      col.column_name.length * CHAR_W_NAME +
      GAP +
      typeStr.length * CHAR_W_TYPE +
      (col.is_nullable === "NO" && !col.isPrimaryKey ? NULL_MARKER : 0);
    maxRowWidth = Math.max(maxRowWidth, rowW);
  }

  const headerW = PAD + 20 + GAP + tableName.length * CHAR_W_TITLE; // 20=icon
  const width = Math.max(headerW, maxRowWidth, 180); // 最小 180px
  return Math.ceil(width) + 16; // 额外余量
}

export default function ErDiagramModal(props: ErDiagramModalProps) {
  const [tables, setTables] = createSignal<TableNode[]>([]);
  const [edges, setEdges] = createSignal<ForeignKeyEdge[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // 画布状态
  const [scale, setScale] = createSignal(1);
  const [panOffset, setPanOffset] = createSignal({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = createSignal(false);
  const [panStart, setPanStart] = createSignal({ x: 0, y: 0 });
  const [draggingTableId, setDraggingTableId] = createSignal<string | null>(null);
  const [dragStart, setDragStart] = createSignal({ x: 0, y: 0 });

  // 画布引用
  const [canvasRef, setCanvasRef] = createSignal<HTMLDivElement | null>(null);

  // 滚轮缩放（需 passive: false 才能 preventDefault）
  createEffect(() => {
    const canvas = canvasRef();
    if (!canvas) return;
    const handler = (e: WheelEvent) => handleWheel(e);
    canvas.addEventListener("wheel", handler, { passive: false });
    onCleanup(() => canvas.removeEventListener("wheel", handler));
  });

  // 加载数据
  createEffect(() => {
    let cancelled = false;
    onCleanup(() => { cancelled = true; });

    const { connectionId, schema, selection } = props;
    if (!connectionId) return;
    const items = schema
      ? [{ schema, tables: [] as string[] }]
      : (selection?.schemas?.length
        ? selection.schemas.map((s) => ({
            schema: s,
            tables: selection.tablesBySchema[s] || [],
          }))
        : null);
    if (!items) return;

    loadSchemaData(connectionId, items, () => cancelled);
  });

  async function loadSchemaData(
    connectionId: string,
    schemaItems: { schema: string; tables: string[] }[],
    isCancelled: () => boolean
  ) {
    setLoading(true);
    setError(null);
    try {
      const tableNodes: TableNode[] = [];
      const allEdges: ForeignKeyEdge[] = [];
      let tableIndex = 0;

      for (const { schema, tables: tablesFilter } of schemaItems) {
        if (isCancelled()) return;
        const tablesRes = await getTables(connectionId, schema);
        if (tablesRes.error) throw new Error(tablesRes.error);

        let tableNames = tablesRes.tables || [];
        if (tablesFilter.length > 0) {
          tableNames = tableNames.filter((t) => tablesFilter.includes(t));
        }

        for (const tableName of tableNames) {
          if (isCancelled()) return;
          try {
            const [colsRes, pkRes, fkRes] = await Promise.all([
              getColumns(connectionId, schema, tableName),
              getPrimaryKeys(connectionId, schema, tableName),
              getForeignKeys(connectionId, schema, tableName),
            ]);

            const pkColumns = new Set((pkRes.columns || []) as string[]);
            const columns = (colsRes.columns || []).map((c: any) => ({
              column_name: c.column_name,
              data_type: c.data_type,
              is_nullable: c.is_nullable,
              isPrimaryKey: pkColumns.has(c.column_name),
            }));

            const width = calculateTableWidth(tableName, columns);
            const height = 60 + columns.length * 28;

            tableNodes.push({
              id: `table-${schema}.${tableName}`,
              schema,
              name: tableName,
              columns,
              position: { x: 0, y: 0 },
              width,
              height,
            });

            (fkRes.outgoing || []).forEach((fk: any) => {
              allEdges.push({
                id: generateId(),
                fromSchema: schema,
                fromTable: tableName,
                fromColumn: fk.source_column,
                toSchema: fk.target_schema || schema,
                toTable: fk.target_table,
                toColumn: fk.target_column,
              });
            });
          } catch (e) {
            console.error(`加载表 ${schema}.${tableName} 失败:`, e);
          }
        }
      }

      // 网格布局
      const sorted = tableNodes.sort((a, b) =>
        a.schema !== b.schema ? a.schema.localeCompare(b.schema) : a.name.localeCompare(b.name)
      );
      const colsPerRow = Math.ceil(Math.sqrt(sorted.length));
      const gapX = 40;
      const gapY = 60;
      let maxW = 0;
      const rowHeights: number[] = [];
      for (let row = 0; row < Math.ceil(sorted.length / colsPerRow); row++) {
        let rowW = 0;
        let rowH = 0;
        for (let col = 0; col < colsPerRow; col++) {
          const i = row * colsPerRow + col;
          if (i >= sorted.length) break;
          const t = sorted[i];
          rowW += (col > 0 ? gapX : 0) + t.width;
          rowH = Math.max(rowH, t.height);
        }
        maxW = Math.max(maxW, rowW);
        rowHeights.push(rowH);
      }
      let y = 50;
      for (let row = 0; row < rowHeights.length; row++) {
        let x = 50;
        for (let col = 0; col < colsPerRow; col++) {
          const i = row * colsPerRow + col;
          if (i >= sorted.length) break;
          sorted[i].position = { x, y };
          x += sorted[i].width + gapX;
        }
        y += rowHeights[row] + gapY;
      }

      if (isCancelled()) return;
      setTables(sorted);
      setEdges(allEdges);
    } catch (e: any) {
      if (!isCancelled()) setError(e.message || "加载失败");
    } finally {
      if (!isCancelled()) setLoading(false);
    }
  }

  // 屏幕坐标转画布坐标
  function screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - panOffset().x) / scale(),
      y: (screenY - panOffset().y) / scale(),
    };
  }

  // 画布平移
  function handleCanvasMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.table-card')) return;

    e.preventDefault();
    setIsPanning(true);
    setPanStart({ x: e.clientX - panOffset().x, y: e.clientY - panOffset().y });
  }

  function handleCanvasMouseMove(e: MouseEvent) {
    if (isPanning()) {
      setPanOffset({
        x: e.clientX - panStart().x,
        y: e.clientY - panStart().y,
      });
    }

    if (draggingTableId()) {
      const canvas = canvasRef();
      if (!canvas) return;
      
      const rect = canvas.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left - panOffset().x) / scale();
      const mouseY = (e.clientY - rect.top - panOffset().y) / scale();
      
      const deltaX = mouseX - dragStart().x;
      const deltaY = mouseY - dragStart().y;

      setTables((prev) =>
        prev.map((t) =>
          t.id === draggingTableId()
            ? { ...t, position: { x: t.position.x + deltaX, y: t.position.y + deltaY } }
            : t
        )
      );

      setDragStart({ x: mouseX, y: mouseY });
    }
  }

  function handleCanvasMouseUp() {
    setIsPanning(false);
    setDraggingTableId(null);
  }

  function handleTableMouseDown(e: MouseEvent, tableId: string) {
    e.stopPropagation();
    const canvas = canvasRef();
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left - panOffset().x) / scale();
    const mouseY = (e.clientY - rect.top - panOffset().y) / scale();

    setDraggingTableId(tableId);
    setDragStart({ x: mouseX, y: mouseY });
  }

  // 缩放
  function zoomIn() {
    setScale((s) => Math.min(s * 1.2, 3));
  }

  function zoomOut() {
    setScale((s) => Math.max(s / 1.2, 0.3));
  }

  function resetView() {
    setScale(1);
    setPanOffset({ x: 0, y: 0 });
  }

  // 滚轮缩放（以鼠标位置为中心）
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const canvas = canvasRef();
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const newScale = Math.max(0.3, Math.min(3, scale() * (1 + delta)));

    // 以鼠标位置为中心缩放：调整 panOffset 使鼠标下的点保持不变
    const scaleRatio = newScale / scale();
    setPanOffset({
      x: mouseX - (mouseX - panOffset().x) * scaleRatio,
      y: mouseY - (mouseY - panOffset().y) * scaleRatio,
    });
    setScale(newScale);
  }

  // 计算连线路径（与 visual query builder 一致：优先 DOM 测量，回退到常量估算）
  const edgeLines = createMemo(() => {
    const tbls = tables();
    const canvas = canvasRef();

    const FALLBACK_HEADER_HEIGHT = 44;
    const FALLBACK_COLUMN_HEIGHT = 28;

    function measureColumnCenter(tableObj: TableNode, colName: string): number | null {
      if (!canvas) return null;
      const tableEl = canvas.querySelector(`.er-table-card[data-table-id="${tableObj.id}"]`) as HTMLElement | null;
      if (!tableEl) return null;

      const colEl = tableEl.querySelector(`.er-column-item[data-column-name="${colName}"]`) as HTMLElement | null;
      if (!colEl) return null;

      const offsetTop = colEl.offsetTop;
      const height = colEl.offsetHeight || FALLBACK_COLUMN_HEIGHT;
      return tableObj.position.y + offsetTop + height / 2;
    }

    function measureTableWidth(tableObj: TableNode): number {
      if (!canvas) return tableObj.width;
      const tableEl = canvas.querySelector(`.er-table-card[data-table-id="${tableObj.id}"]`) as HTMLElement | null;
      return tableEl?.offsetWidth ?? tableObj.width;
    }

    return edges()
      .map((edge) => {
        const fromTable = tbls.find(
          (t) => t.schema === edge.fromSchema && t.name === edge.fromTable
        );
        const toTable = tbls.find(
          (t) => t.schema === edge.toSchema && t.name === edge.toTable
        );
        if (!fromTable || !toTable) return null;

        const fromColIndex = fromTable.columns.findIndex((c) => c.column_name === edge.fromColumn);
        const toColIndex = toTable.columns.findIndex((c) => c.column_name === edge.toColumn);

        const measuredFromY = measureColumnCenter(fromTable, edge.fromColumn);
        const measuredToY = measureColumnCenter(toTable, edge.toColumn);

        const fromY =
          measuredFromY ??
          fromTable.position.y +
            FALLBACK_HEADER_HEIGHT +
            (fromColIndex >= 0 ? fromColIndex : 0) * FALLBACK_COLUMN_HEIGHT +
            FALLBACK_COLUMN_HEIGHT / 2;

        const toY =
          measuredToY ??
          toTable.position.y +
            FALLBACK_HEADER_HEIGHT +
            (toColIndex >= 0 ? toColIndex : 0) * FALLBACK_COLUMN_HEIGHT +
            FALLBACK_COLUMN_HEIGHT / 2;

        const fromWidth = measureTableWidth(fromTable);
        const toWidth = measureTableWidth(toTable);

        const fromCenterX = fromTable.position.x + fromWidth / 2;
        const toCenterX = toTable.position.x + toWidth / 2;

        const x1 = fromTable.position.x + (fromCenterX < toCenterX ? fromWidth : 0);
        const x2 = toTable.position.x + (fromCenterX < toCenterX ? 0 : toWidth);
        const y1 = fromY;
        const y2 = toY;
        const isSelfRef = fromTable.id === toTable.id;

        // 两端保留水平线段 + 中间三次贝塞尔
        const h = 14; // 两端水平段长度
        const extend = isSelfRef ? 45 : 40;
        let pathD: string;
        let labelX: number, labelY: number;
        if (fromCenterX < toCenterX) {
          const p1x = x1 + h;
          const p2x = x2 - h;
          const c1x = p1x + extend;
          const c2x = p2x - extend;
          pathD = `M ${x1} ${y1} L ${p1x} ${y1} C ${c1x} ${y1} ${c2x} ${y2} ${p2x} ${y2} L ${x2} ${y2}`;
          labelX = 0.125 * p1x + 0.375 * c1x + 0.375 * c2x + 0.125 * p2x;
          labelY = 0.125 * y1 + 0.375 * y1 + 0.375 * y2 + 0.125 * y2;
        } else {
          const p1x = x1 - h;
          const p2x = x2 + h;
          const c1x = p1x - extend;
          const c2x = p2x + extend;
          pathD = `M ${x1} ${y1} L ${p1x} ${y1} C ${c1x} ${y1} ${c2x} ${y2} ${p2x} ${y2} L ${x2} ${y2}`;
          labelX = 0.125 * p1x + 0.375 * c1x + 0.375 * c2x + 0.125 * p2x;
          labelY = 0.125 * y1 + 0.375 * y1 + 0.375 * y2 + 0.125 * y2;
        }

        return {
          ...edge,
          x1,
          y1,
          x2,
          y2,
          pathD,
          labelX,
          labelY,
        };
      })
      .filter(Boolean);
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        "background-color": "rgba(0,0,0,0.8)",
        "z-index": 300,
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
        padding: "20px",
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        style={{
          "background-color": vscode.editorBg || "#0f172a",
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          width: "95vw",
          height: "90vh",
          display: "flex",
          "flex-direction": "column",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.4)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          style={{
            padding: "12px 20px",
            "border-bottom": `1px solid ${vscode.border}`,
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            "background-color": vscode.sidebarBg,
          }}
        >
          <div>
            <h2 style={{ margin: 0, "font-size": "16px", color: vscode.foreground }}>
              🔗 ER 图: {props.schema ?? (props.selection?.schemas?.join(", ") ?? "")}
            </h2>
            <p style={{ margin: "4px 0 0 0", "font-size": "12px", color: vscode.foregroundDim }}>
              {tables().length} 个表 · {edges().length} 个关系
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", "align-items": "center" }}>
            {/* 缩放控制 */}
            <div style={{ display: "flex", gap: "4px", "margin-right": "12px" }}>
              <button
                onClick={zoomOut}
                style={{
                  padding: "6px 12px",
                  "font-size": "13px",
                  "background-color": vscode.buttonSecondary,
                  color: vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  cursor: "pointer",
                }}
              >
                −
              </button>
              <button
                onClick={resetView}
                style={{
                  padding: "6px 12px",
                  "font-size": "11px",
                  "background-color": vscode.buttonSecondary,
                  color: vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  cursor: "pointer",
                  "min-width": "50px",
                }}
              >
                {Math.round(scale() * 100)}%
              </button>
              <button
                onClick={zoomIn}
                style={{
                  padding: "6px 12px",
                  "font-size": "13px",
                  "background-color": vscode.buttonSecondary,
                  color: vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  cursor: "pointer",
                }}
              >
                +
              </button>
            </div>
            <button
              onClick={props.onClose}
              style={{
                padding: "8px 16px",
                "font-size": "13px",
                "background-color": vscode.buttonSecondary,
                color: vscode.foreground,
                border: "none",
                "border-radius": "4px",
                cursor: "pointer",
              }}
            >
              关闭
            </button>
          </div>
        </div>

        {/* 画布区域 */}
        <div
          ref={setCanvasRef}
          style={{
            flex: 1,
            overflow: "hidden",
            position: "relative",
            cursor: isPanning() ? "grabbing" : draggingTableId() ? "grabbing" : "grab",
            "background-color": "#0f172a",
            "background-image": `
              linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
            `,
            "background-size": "20px 20px",
          }}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
        >
          <Show when={loading()}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: vscode.foregroundDim,
                "font-size": "14px",
              }}
            >
              正在生成 ER 图...
            </div>
          </Show>

          <Show when={error()}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                color: vscode.error,
                "font-size": "14px",
                padding: "20px",
              }}
            >
              {error()}
            </div>
          </Show>

          <Show when={!loading() && !error()}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                transform: `translate(${panOffset().x}px, ${panOffset().y}px) scale(${scale()})`,
                "transform-origin": "0 0",
              }}
            >
              {/* SVG 连线层（先渲染，在下层，曲线绕开表不遮挡内容） */}
              <svg
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  "pointer-events": "none",
                  overflow: "visible",
                }}
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="6"
                    markerHeight="4"
                    refX="5"
                    refY="2"
                    orient="auto"
                  >
                    <polygon points="0 0, 6 2, 0 4" fill="#94a3b8" />
                  </marker>
                </defs>
                <For each={edgeLines()}>
                  {(line) => (
                    <g>
                      <path
                        d={line!.pathD}
                        fill="none"
                        stroke="#94a3b8"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        marker-end="url(#arrowhead)"
                      />
                      <circle cx={line!.x1} cy={line!.y1} r="3.5" fill="#94a3b8" stroke="#1e293b" stroke-width="1.5" />
                      <rect
                        x={(line!.labelX ?? (line!.x1 + line!.x2) / 2) - 36}
                        y={(line!.labelY ?? (line!.y1 + line!.y2) / 2) - 9}
                        width="72"
                        height="18"
                        rx="4"
                        fill="#1e293b"
                        stroke="#475569"
                        stroke-width="1"
                      />
                      <text
                        x={line!.labelX ?? (line!.x1 + line!.x2) / 2}
                        y={(line!.labelY ?? (line!.y1 + line!.y2) / 2) + 3.5}
                        fill="#cbd5e1"
                        style={{ "font-size": "10px", "font-weight": "500" }}
                        text-anchor="middle"
                      >
                        FK
                      </text>
                    </g>
                  )}
                </For>
              </svg>
              {/* 表卡片层（后渲染，在上层） */}
              <For each={tables()}>
                {(table) => (
                  <div
                    class="table-card er-table-card"
                    data-table-id={table.id}
                    style={{
                      position: "absolute",
                      left: `${table.position.x}px`,
                      top: `${table.position.y}px`,
                      width: `${table.width}px`,
                      "background-color": "#1e293b",
                      border: `2px solid ${vscode.accent || "#3b82f6"}`,
                      "border-radius": "8px",
                      "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
                      cursor: "move",
                      "user-select": "none",
                      overflow: "hidden",
                      "z-index": 5,
                    }}
                    onMouseDown={(e) => handleTableMouseDown(e, table.id)}
                  >
                    {/* 表头 */}
                    <div
                      style={{
                        padding: "10px 12px",
                        "background-color": "#0f172a",
                        "border-bottom": "1px solid #334155",
                        display: "flex",
                        "align-items": "center",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontSize: "14px" }}>📊</span>
                      <span
                        style={{
                          "font-weight": "600",
                          "font-size": "13px",
                          color: "#f1f5f9",
                          overflow: "hidden",
                          "text-overflow": "ellipsis",
                          "white-space": "nowrap",
                        }}
                      >
                        {tables().length > 0 &&
                        new Set(tables().map((t) => t.schema)).size > 1
                          ? `${table.schema}.${table.name}`
                          : table.name}
                      </span>
                    </div>

                    {/* 列列表 */}
                    <div style={{ padding: "4px 0" }}>
                      <For each={table.columns}>
                        {(col, index) => (
                          <div
                            class="er-column-item"
                            data-column-name={col.column_name}
                            style={{
                              padding: "4px 12px",
                              display: "flex",
                              "align-items": "center",
                              gap: "8px",
                              "font-size": "12px",
                              "background-color":
                                index() % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                            }}
                          >
                            {/* PK 标记 */}
                            <Show
                              when={col.isPrimaryKey}
                              fallback={<span style={{ width: "16px" }} />}
                            >
                              <span
                                style={{
                                  width: "16px",
                                  "text-align": "center",
                                  color: "#f59e0b",
                                  "font-size": "10px",
                                  "font-weight": "700",
                                }}
                                title="Primary Key"
                              >
                                🔑
                              </span>
                            </Show>

                            {/* 列名 */}
                            <span
                              style={{
                                flex: "1 1 0",
                                "min-width": 0,
                                color: col.isPrimaryKey ? "#f59e0b" : "#e2e8f0",
                                "font-weight": col.isPrimaryKey ? "500" : "400",
                                "white-space": "nowrap",
                                overflow: "hidden",
                                "text-overflow": "ellipsis",
                              }}
                            >
                              {col.column_name}
                            </span>

                            {/* 数据类型（简化显示） */}
                            <span
                              style={{
                                flex: "0 0 auto",
                                color: "#64748b",
                                "font-size": "11px",
                                "font-family": "'JetBrains Mono', monospace",
                                "white-space": "nowrap",
                              }}
                            >
                              {simplifyTypeForDisplay(col.data_type)}
                            </span>

                            {/* NULL 标记 */}
                            <Show when={col.is_nullable === "NO" && !col.isPrimaryKey}>
                              <span style={{ color: "#ef4444", "font-size": "10px" }}>•</span>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* 图例 */}
          <div
            style={{
              position: "absolute",
              bottom: "16px",
              left: "16px",
              padding: "12px 16px",
              "background-color": "rgba(15, 23, 42, 0.9)",
              border: "1px solid #334155",
              "border-radius": "8px",
              "font-size": "12px",
              color: "#94a3b8",
            }}
          >
            <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "4px" }}>
              <span style={{ color: "#f59e0b" }}>🔑</span>
              <span>主键</span>
            </div>
            <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-bottom": "4px" }}>
              <span style={{ color: "#ef4444" }}>•</span>
              <span>NOT NULL</span>
            </div>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <span style={{ color: "#64748b" }}>──→</span>
              <span>外键关系</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
