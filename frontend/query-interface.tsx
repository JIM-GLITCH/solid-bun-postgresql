import { createSignal, createMemo, For, Show, onMount, onCleanup, createEffect } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { Accessor } from "solid-js";
import Resizable from "@corvu/resizable";
import EditableCell from "./editable-cell";
import SqlEditor from "./sql-editor";
import type { ColumnEditableInfo, SSEMessage } from "../shared/src";
import { formatCellDisplay, formatCellToEditable, formatSqlValue as formatSqlValueShared, getAlignmentFromDataType, getDataTypeName, getStatementsFromText, formatSql, PG_OID } from "../shared/src";
import {
  queryStream,
  queryStreamMore,
  cancelQuery,
  saveChanges,
  queryReadonly,
  subscribeEvents,
  explainQuery,
  getAiConfig,
  setAiConfig,
  testAiConnection,
  aiSqlEdit,
  aiBuildPrompt,
  aiBuildDiffPrompt,
  setAiKeyViaVscode,
  deleteAiKeyViaVscode,
  deleteAiKey,
} from "./api";
import VisualQueryBuilder from "./visual-query-builder";
import QueryHistoryPanel from "./query-history-panel";
import { addQuery } from "./query-history";
import { vscode } from "./theme";
import { writeClipboardText } from "./clipboard";
import { exportAsCsv, exportAsJson, exportAsExcel } from "./export-result";
import ImportModal from "./import-modal";
import ExplainPlanViewer from "./explain-plan-viewer";
import { useDialog } from "./dialog-context";

interface QueryInterfaceProps {
  /** 当前活跃的连接 ID，用于执行查询 */
  activeConnectionId?: Accessor<string | null>;
  /** 外部触发的查询（如侧边栏点击表），处理后应清空 */
  externalQuery?: Accessor<{ connectionId: string; sql: string } | null>;
  onExternalQueryHandled?: () => void;
  /** 当前是否为活跃 Tab（多 Tab 时仅保存活跃 Tab 的修改） */
  isActiveTab?: Accessor<boolean>;
}

// 待执行的 UPDATE 语句
interface PendingUpdate {
  sql: string;
  rowIndex: number;
  colIndex: number;
  oldValue: any;  // 原始值，用于还原
}

// 待执行的 DELETE 语句
interface PendingDelete {
  sql: string;
  rowIndex: number;
}

// 待执行的 INSERT（行索引，保存时根据当前行值生成 SQL）
interface PendingInsert {
  rowIndex: number;
}

interface AiEditResult {
  sql: string;
  elapsedMs?: number;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  schemaInjected?: string[];
}

function cellValueToJsonbInitial(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export default function QueryInterface(props: QueryInterfaceProps = {}) {
  const AI_MODEL_PREF_KEY = "dbplayer.ai.model";
  const { openJsonbEditor } = useDialog();
  const [sql, setSql] = createSignal(`select a.id ,a.name, b.id,b.name from student a left join student b on a.id = b.id `);
  const [result, setResult] = createStore<any[][]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [columns, setColumns] = createSignal<ColumnEditableInfo[]>([]);
  const [pendingUpdates, setPendingUpdates] = createSignal<PendingUpdate[]>([]);
  const [pendingDeletes, setPendingDeletes] = createSignal<PendingDelete[]>([]);
  const [pendingInserts, setPendingInserts] = createSignal<PendingInsert[]>([]);
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
  const [showQueryBuilder, setShowQueryBuilder] = createSignal(false);  // 是否显示 Visual Query Builder
  const [showHistoryPanel, setShowHistoryPanel] = createSignal(false);  // 是否显示查询历史
  const [showExportMenu, setShowExportMenu] = createSignal(false);  // 导出下拉
  const [showImportModal, setShowImportModal] = createSignal(false);  // 导入弹窗
  const [explainPlan, setExplainPlan] = createSignal<Array<{ Plan: any; "Planning Time"?: number; "Execution Time"?: number }> | null>(null);
  const [explainLoading, setExplainLoading] = createSignal(false);
  /** 与后端路由一致：决定 chat/completions vs Anthropic messages */
  const [aiApiMode, setAiApiMode] = createSignal<"openai-compatible" | "anthropic">("openai-compatible");
  const [aiBaseUrl, setAiBaseUrl] = createSignal("https://dashscope.aliyuncs.com/compatible-mode/v1");
  const [aiModel, setAiModel] = createSignal("qwen-plus");
  const [aiKeyRef, setAiKeyRef] = createSignal("default");
  const [aiTemperature, setAiTemperature] = createSignal("0.2");
  const [aiTopP, setAiTopP] = createSignal("1");
  const [aiStream, setAiStream] = createSignal(true);
  const [aiMaxTokens, setAiMaxTokens] = createSignal("700");
  const [showAiAdvanced, setShowAiAdvanced] = createSignal(false);
  const [aiApiKey, setAiApiKey] = createSignal("");
  const [aiHasStoredKey, setAiHasStoredKey] = createSignal(false);
  const [aiLoading, setAiLoading] = createSignal(false);
  const [showAiDialog, setShowAiDialog] = createSignal(false);
  /** 与 Monaco 内 AI 编辑栏同步：用户要求（实时输入 + 默认「补全」） */
  const [aiEditInstruction, setAiEditInstruction] = createSignal("补全");
  const isVscodeWebview = typeof window !== "undefined" && typeof (window as any).acquireVsCodeApi === "function";

  let sqlEditorFormatApi: { format: () => void; insertQueryHistoryAtEnd: (sql: string) => void } | null = null;

  // 单元格选区：Set<"row,col">，支持非连续多选（Ctrl+点击添加）
  const [selection, setSelection] = createSignal<Set<string> | null>(null);
  const cellKey = (r: number, c: number) => `${r},${c}`;
  const [selectionAnchor, setSelectionAnchor] = createSignal<{ row: number; col: number } | null>(null);  // 框选起点（拖拽用）
  const [selectionOrigin, setSelectionOrigin] = createSignal<{ row: number; col: number } | null>(null);  // Shift+点击 扩展选区的起点
  const [tableContextMenu, setTableContextMenu] = createSignal<{
    x: number;
    y: number;
    contextCell?: { rowIndex: number; colIndex: number };  // 右键所在的单元格，空白区域为 undefined
  } | null>(null);

  // 选区内的所有行索引（去重，升序）
  const selectedRows = createMemo(() => {
    const sel = selection();
    if (!sel || sel.size === 0) return [];
    const rows = new Set<number>();
    for (const k of sel) {
      rows.add(Number(k.split(",")[0]));
    }
    return Array.from(rows).sort((a, b) => a - b);
  });
  // 选区中最后一行（用于在下方插入）
  const lastSelectedRow = () => {
    const rows = selectedRows();
    return rows.length > 0 ? rows[rows.length - 1] : -1;
  };
  // 判断单元格是否在选区内
  const isCellSelected = (rowIndex: number, colIndex: number) => {
    const sel = selection();
    if (!sel) return false;
    return sel.has(cellKey(rowIndex, colIndex));
  };

  const ROW_HEIGHT = 40;  // 虚拟滚动行高

  // 虚拟滚动相关状态
  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(600);
  const OVERSCAN = 10; // 预渲染行数

  const visible = createMemo(() => {
    const rowCount = result.length;
    const start = Math.floor(scrollTop() / ROW_HEIGHT);
    const end = Math.ceil((scrollTop() + containerHeight()) / ROW_HEIGHT);
    let s = Math.max(0, start - OVERSCAN);
    let e = Math.min(rowCount, end + OVERSCAN);
    // 上次结果很长且滚到底部后，若新结果很短，会出现 s >= e（或 s >= rowCount），indices 为空；滚轮会改 scrollTop 才「恢复」
    if (rowCount > 0 && s >= rowCount) {
      s = 0;
      e = Math.min(rowCount, Math.ceil(containerHeight() / ROW_HEIGHT) + OVERSCAN);
    } else if (e <= s && rowCount > 0) {
      s = 0;
      e = Math.min(rowCount, Math.ceil(containerHeight() / ROW_HEIGHT) + OVERSCAN);
    }
    const count = Math.max(0, e - s);
    return {
      start: s,
      end: e,
      indices: Array.from({ length: count }, (_, i) => s + i)
    };
  });

  const totalHeight = () => result.length * ROW_HEIGHT;
  const offsetY = () => visible().start * ROW_HEIGHT;

  const [tableContainerRef, setTableContainerRef] = createSignal<HTMLDivElement | null>(null);

  // 响应外部查询请求（如侧边栏点击表）
  createEffect(() => {
    const ext = props.externalQuery?.();
    if (ext) {
      handleQueryRequest(ext.connectionId, ext.sql);
      props.onExternalQueryHandled?.();
    }
  });

  onMount(() => {
    const onResize = () => {
      const el = tableContainerRef();
      if (el) setContainerHeight(Math.max(el.clientHeight, 200));
    };
    window.addEventListener("resize", onResize);
    onCleanup(() => {
      window.removeEventListener("resize", onResize);
    });
    getAiConfig()
      .then((cfg) => {
        setAiApiMode(cfg.apiMode);
        setAiBaseUrl(cfg.baseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1");
        setAiModel(cfg.model);
        setAiKeyRef(cfg.keyRef || "default");
        setAiTemperature(String(cfg.temperature ?? 0.2));
        setAiTopP(String(cfg.topP ?? 1));
        setAiStream(cfg.stream !== false);
        setAiMaxTokens(String(cfg.maxTokens ?? 700));
        setAiHasStoredKey(!!cfg.hasKey);
      })
      .catch(() => {});
    try {
      const savedModel = localStorage.getItem(AI_MODEL_PREF_KEY);
      if (savedModel?.trim()) setAiModel(savedModel.trim());
    } catch {
      // ignore localStorage errors in restricted environments
    }
  });

  // 将表格选区转为制表符分隔的文本（便于粘贴到 Excel）
  function getSelectionAsTabSeparated(): string | null {
    const sel = selection();
    if (!sel || sel.size === 0) return null;
    let minR = Infinity, minC = Infinity, maxR = -1, maxC = -1;
    for (const k of sel) {
      const [r, c] = k.split(",").map(Number);
      minR = Math.min(minR, r); minC = Math.min(minC, c);
      maxR = Math.max(maxR, r); maxC = Math.max(maxC, c);
    }
    const rows: string[] = [];
    for (let r = minR; r <= maxR; r++) {
      const cells: string[] = [];
      for (let c = minC; c <= maxC; c++) {
        const val = sel.has(cellKey(r, c)) ? (result[r]?.[c] ?? null) : null;
        const dataTypeOid = columns()[c]?.dataTypeOid;
        const s = val !== null ? formatCellDisplay(val, dataTypeOid).replace(/\t/g, " ").replace(/\n/g, " ") : "";
        cells.push(s);
      }
      rows.push(cells.join("\t"));
    }
    return rows.join("\n");
  }

  // 复制：仅当焦点在结果表格内且有选区时拦截
  const getTableCopyText = (): string | null => {
    if (document.activeElement?.closest("[data-sql-editor]")) return null;
    if (!tableContainerRef()?.contains(document.activeElement)) return null;
    return getSelectionAsTabSeparated();
  };

  /** JSONB 编辑器 Portal 在 body 上，须在捕获阶段排除，否则会拦截 Ctrl+C / Ctrl+S（先于模态内 input 处理） */
  function eventTargetInJsonbEditorModal(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) return false;
    const el = target instanceof Element ? target : target.parentElement;
    return el?.closest("[data-jsonb-editor-root]") != null;
  }

  const handleCopy = (e: ClipboardEvent) => {
    if (eventTargetInJsonbEditorModal(e.target) || eventTargetInJsonbEditorModal(document.activeElement)) return;
    const text = getTableCopyText();
    if (!text) return;
    e.preventDefault();
    e.clipboardData?.setData("text/plain", text);
  };

  const handleCopyKeyDown = (e: KeyboardEvent) => {
    if (!((e.ctrlKey || e.metaKey) && e.key === "c")) return;
    if (eventTargetInJsonbEditorModal(e.target) || eventTargetInJsonbEditorModal(document.activeElement)) return;
    const text = getTableCopyText();
    if (!text) return;
    e.preventDefault();
    e.stopPropagation();
    writeClipboardText(text);
  };

  // Ctrl+S 保存结果：按上下文保存，不要求焦点；仅排除 SQL 编辑器（避免与 Monaco 冲突），多 Tab 时只保存当前 Tab
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!((e.ctrlKey || e.metaKey) && e.key === "s")) return;
    if (eventTargetInJsonbEditorModal(e.target) || eventTargetInJsonbEditorModal(document.activeElement)) return;
    if (props.isActiveTab && !props.isActiveTab()) return;
    if (document.activeElement?.closest("[data-sql-editor]")) return;
    e.preventDefault();
    saveAllChanges();
  };
  createEffect(() => {
    document.addEventListener("copy", handleCopy, true);
    document.addEventListener("keydown", handleCopyKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("copy", handleCopy, true);
      document.removeEventListener("keydown", handleCopyKeyDown, true);
    });
  });
  createEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown, true));
  });

  // 单元格 mousedown：处理普通点击、Shift+点击、Ctrl+点击（Excel 逻辑）
  function handleCellMouseDown(rowIndex: number, colIndex: number, e: MouseEvent) {
    if (e.button !== 0) return;
    const r = rowIndex;
    const c = colIndex;

    if (e.shiftKey) {
      // Shift+点击：从 selectionOrigin 扩展到当前单元格，将矩形范围内的单元格加入选区
      const origin = selectionOrigin();
      const anchor = origin ?? { row: r, col: c };
      const r0 = Math.min(anchor.row, r), r1 = Math.max(anchor.row, r);
      const c0 = Math.min(anchor.col, c), c1 = Math.max(anchor.col, c);
      setSelection(prev => {
        const next = new Set(prev || []);
        for (let ri = r0; ri <= r1; ri++)
          for (let ci = c0; ci <= c1; ci++)
            next.add(cellKey(ri, ci));
        return next;
      });
      if (!origin) setSelectionOrigin(anchor);
      return; // 不启动框选拖拽
    }

    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd+点击：将当前单元格添加到选区（不替换已有选区）
      const key = cellKey(r, c);
      setSelection(prev => {
        const next = new Set(prev || []);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next.size > 0 ? next : null;
      });
      setSelectionOrigin({ row: r, col: c });
      return; // 不启动框选拖拽
    }

    // 普通点击：选中该单元格，启动框选拖拽
    setSelectionOrigin({ row: r, col: c });
    setSelectionAnchor({ row: r, col: c });
    setSelection(new Set([cellKey(r, c)]));
  }

  // 框选逻辑：mousedown 设锚点，mousemove 扩展选区，mouseup 清除锚点
  const [tbodyRef, setTbodyRef] = createSignal<HTMLTableSectionElement | null>(null);
  createEffect(() => {
    const tbody = tbodyRef();
    if (!tbody) return;
    const onMouseMove = (e: MouseEvent) => {
      const anchor = selectionAnchor();
      if (!anchor) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || !tbody.contains(el)) return;
      const td = el.closest("td[data-rowindex][data-colindex]");
      if (!td) return;
      const row = parseInt((td as HTMLElement).dataset.rowindex ?? "-1", 10);
      const col = parseInt((td as HTMLElement).dataset.colindex ?? "-1", 10);
      if (row < 0 || col < 0) return;
      const r0 = Math.min(anchor.row, row), r1 = Math.max(anchor.row, row);
      const c0 = Math.min(anchor.col, col), c1 = Math.max(anchor.col, col);
      const next = new Set<string>();
      for (let ri = r0; ri <= r1; ri++)
        for (let ci = c0; ci <= c1; ci++)
          next.add(cellKey(ri, ci));
      setSelection(next);
    };
    const onMouseUp = () => setSelectionAnchor(null);
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    onCleanup(() => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    });
  });

  // 消息推送订阅（通过 Transport 抽象，Web 下为 EventSource）
  createEffect(() => {
    const cid = props.activeConnectionId?.();
    if (!cid) {
      setSseConnected(false);
      return;
    }
    setSseConnected(true);
    const unsubscribe = subscribeEvents(cid, (message) => {
      setNotices(prev => [...prev.slice(-49), message]);
    });
    return () => {
      unsubscribe();
      setSseConnected(false);
    };
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

  async function runUserQuery(overrideSql?: string) {
    const cid = props.activeConnectionId?.();
    if (!cid) return;
    const sqlToRun = overrideSql ?? sql();
    if (!sqlToRun.trim()) return;
    const statements = getStatementsFromText(sqlToRun);
    setLoading(true);
    setError(null);
    resetTableScrollForNewQuery();
    setResult([]);  // 清空 store
    setPendingUpdates([]);  // 清空待执行的更新
    setPendingDeletes([]);  // 清空待执行的删除
    setPendingInserts([]);  // 清空待执行的插入
    setQueryDuration(null);  // 清空上次查询耗时
    setHasMore(false);
    setModifiedCells([]);
    const startTime = performance.now();  // 记录开始时间
    try {
      const data = await queryStream(cid, statements, 100);

      if (data.error) {
        throw new Error(data.error);
      }

      // 设置列信息；列数不变时保留已有列宽，避免 Set null/保存后突变
      const newCols = data.columns || [];
      setColumns(newCols);
      const cur = columnWidths;
      if (cur.length === newCols.length) {
        setColumnWidths(cur.map((w, i) => w || 120));
      } else {
        setColumnWidths(newCols.map(() => 120));
      }

      // 设置行数据
      const rows = data.rows || [];
      setResult(rows);

      // 初始化修改状态矩阵
      const colCount = (data.columns || []).length;
      setModifiedCells(rows.map(() => Array(colCount).fill(false)));

      // 记录是否还有更多数据
      setHasMore(data.hasMore || false);

      setQueryDuration(performance.now() - startTime);
      addQuery(sqlToRun, cid).catch((e) => console.warn("查询历史保存失败:", e));
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
    const cid = props.activeConnectionId?.();
    if (!cid) return;

    setLoadingMore(true);
    try {
      const data = await queryStreamMore(cid, 100);

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

  /** 新一次完整结果集查询时重置滚动，避免虚拟窗口仍落在上一次大结果集的 scrollTop 上 */
  function resetTableScrollForNewQuery() {
    setScrollTop(0);
    const el = tableContainerRef();
    if (el) el.scrollTop = 0;
  }

  // 执行 EXPLAIN ANALYZE（可选传入 sql，否则用编辑器内第一个语句）
  async function runExplain(overrideSql?: string) {
    const cid = props.activeConnectionId?.();
    if (!cid) return;
    const sqlToRun = (overrideSql ?? sql()).trim();
    if (!sqlToRun) return;
    const statements = getStatementsFromText(sqlToRun);
    const firstStmt = statements[0];
    if (!firstStmt) return;
    setExplainLoading(true);
    setExplainPlan(null);
    try {
      const res = await explainQuery(cid, firstStmt);
      if (res.error) throw new Error(res.error);
      const raw = res.plan;
      const plan = Array.isArray(raw) ? raw : (raw && typeof raw === "object" && "Plan" in raw ? [raw] : []);
      setExplainPlan(plan);
    } catch (e: any) {
      setError(e.message || "EXPLAIN 失败");
    } finally {
      setExplainLoading(false);
    }
  }

  // 取消正在执行的查询
  async function doCancelQuery() {
    const cid = props.activeConnectionId?.();
    if (!cid) return;
    try {
      const { success, message, error: err } = await cancelQuery(cid);
      if (success) {
        console.log("查询取消:", message);
      } else {
        console.warn("取消失败:", err || message);
      }
    } catch (e: any) {
      console.error("取消请求失败:", e.message);
    }
  }

  async function saveAiSettings() {
    const normalizeBaseUrl = (raw: string): string => {
      const trimmed = raw.trim();
      if (!trimmed) throw new Error("Base URL 不能为空");
      const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      let parsed: URL;
      try {
        parsed = new URL(withProtocol);
      } catch {
        throw new Error("Base URL 格式无效，请输入完整域名或 URL");
      }
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error("Base URL 仅支持 http/https");
      }
      return parsed.toString().replace(/\/+$/, "");
    };

    try {
      const keyRef = aiKeyRef().trim() || "default";
      const normalizedBaseUrl = normalizeBaseUrl(aiBaseUrl());
      setAiBaseUrl(normalizedBaseUrl);
      const presetForModel =
        aiApiMode() === "anthropic"
          ? "anthropic"
          : normalizedBaseUrl.toLowerCase().includes("dashscope") || normalizedBaseUrl.includes("compatible-mode")
            ? "aliyun"
            : "openai";
      const payload = {
        apiMode: aiApiMode(),
        baseUrl: normalizedBaseUrl,
        model:
          aiModel().trim() ||
          (presetForModel === "openai"
            ? "gpt-4o-mini"
            : presetForModel === "anthropic"
              ? "claude-3-5-sonnet-latest"
              : "qwen-plus"),
        keyRef,
        temperature: Number(aiTemperature()),
        topP: Number(aiTopP()),
        stream: aiStream(),
        maxTokens: Number(aiMaxTokens()),
      };
      if (isVscodeWebview && aiApiKey().trim()) {
        await setAiKeyViaVscode(keyRef, aiApiKey().trim());
        await setAiConfig(payload);
      } else {
        await setAiConfig({ ...payload, apiKey: aiApiKey().trim() || undefined });
      }
      await testAiConnection({
        keyRef,
        apiMode: payload.apiMode,
        baseUrl: payload.baseUrl,
        model: payload.model,
        temperature: payload.temperature,
        topP: payload.topP,
        stream: payload.stream,
        maxTokens: payload.maxTokens,
      });
      setAiApiKey("");
      try {
        localStorage.setItem(AI_MODEL_PREF_KEY, payload.model);
      } catch {
        // ignore localStorage errors in restricted environments
      }
      setNotices((prev) => [...prev.slice(-49), { type: "INFO", message: "AI 配置已更新并校验通过", timestamp: Date.now() }]);
      setAiHasStoredKey(true);
    } catch (e: any) {
      setError(e?.message || "AI 配置保存失败");
      setNotices((prev) => [...prev.slice(-49), { type: "ERROR", message: e?.message || "AI 配置保存失败", timestamp: Date.now() }]);
    }
  }

  async function clearStoredAiKey() {
    const keyRef = aiKeyRef().trim() || "default";
    try {
      if (isVscodeWebview) {
        await deleteAiKeyViaVscode(keyRef);
      } else {
        await deleteAiKey({ keyRef });
      }
      setAiApiKey("");
      setAiHasStoredKey(false);
      setNotices((prev) => [...prev.slice(-49), { type: "INFO", message: "已清除保存的 AI Key", timestamp: Date.now() }]);
    } catch (e: any) {
      setError(e?.message || "清除 AI Key 失败");
      setNotices((prev) => [...prev.slice(-49), { type: "ERROR", message: e?.message || "清除 AI Key 失败", timestamp: Date.now() }]);
    }
  }

  function applyAiPreset(preset: "openai" | "anthropic" | "aliyun") {
    if (preset === "openai") {
      setAiApiMode("openai-compatible");
      setAiBaseUrl("https://api.openai.com/v1");
      if (!aiModel().trim()) setAiModel("gpt-4o-mini");
      return;
    }
    if (preset === "anthropic") {
      setAiApiMode("anthropic");
      setAiBaseUrl("https://api.anthropic.com/v1");
      if (!aiModel().trim()) setAiModel("claude-3-5-sonnet-latest");
      return;
    }
    setAiApiMode("openai-compatible");
    setAiBaseUrl("https://dashscope.aliyuncs.com/compatible-mode/v1");
    if (!aiModel().trim()) setAiModel("qwen-plus");
  }

  async function handleAiEdit(sourceSql: string, instruction: string): Promise<AiEditResult | string> {
    const cid = props.activeConnectionId?.();
    if (!cid || !sourceSql.trim()) return "";
    setError(null);
    try {
      const res = await aiSqlEdit({
        connectionId: cid,
        sql: sourceSql,
        instructions: instruction?.trim() || "补全",
        keyRef: aiKeyRef().trim() || "default",
      });
      return {
        sql: res.sql || "",
        elapsedMs: res.elapsedMs,
        usage: res.usage,
        schemaInjected: res.schemaInjected,
      };
    } catch (e: any) {
      setError(e.message || "AI 编辑失败");
      return "";
    }
  }

  async function handleAiCopyPrompt(sourceSql?: string, instructions?: string): Promise<void> {
    const cid = props.activeConnectionId?.();
    const sqlSource = sourceSql ?? sql();
    const userReq = instructions?.trim() || aiEditInstruction().trim() || "补全";
    if (!cid || !sqlSource.trim()) return;
    try {
      const res = await aiBuildPrompt({
        connectionId: cid,
        sql: sqlSource,
        instructions: userReq,
      });
      await writeClipboardText(res.prompt);
      const schemaText = Array.isArray(res.schemaInjected) && res.schemaInjected.length
        ? `，注入 schema: ${res.schemaInjected.slice(0, 5).join(", ")}${res.schemaInjected.length > 5 ? "..." : ""}`
        : "";
      setNotices((prev) => [...prev.slice(-49), { type: "INFO", message: `已复制 AI Prompt${schemaText}`, timestamp: Date.now() }]);
    } catch (e: any) {
      setError(e?.message || "复制 AI Prompt 失败");
      setNotices((prev) => [...prev.slice(-49), { type: "ERROR", message: e?.message || "复制 AI Prompt 失败", timestamp: Date.now() }]);
    }
  }

  async function handleAiCopyDiffPrompt(sourceSql?: string): Promise<void> {
    const cid = props.activeConnectionId?.();
    const sqlSource = sourceSql ?? sql();
    if (!cid || !sqlSource.trim()) return;
    try {
      const res = await aiBuildDiffPrompt({
        connectionId: cid,
        sql: sqlSource,
      });
      await writeClipboardText(res.prompt);
      const schemaText = Array.isArray(res.schemaInjected) && res.schemaInjected.length
        ? `，注入 schema: ${res.schemaInjected.slice(0, 5).join(", ")}${res.schemaInjected.length > 5 ? "..." : ""}`
        : "";
      setNotices((prev) => [...prev.slice(-49), { type: "INFO", message: `已复制 Diff Prompt${schemaText}`, timestamp: Date.now() }]);
    } catch (e: any) {
      setError(e?.message || "复制 Diff Prompt 失败");
      setNotices((prev) => [...prev.slice(-49), { type: "ERROR", message: e?.message || "复制 Diff Prompt 失败", timestamp: Date.now() }]);
    }
  }

  // 获取用于 WHERE 子句的行状态（用 pendingUpdates 的 oldValue 覆盖，以得到修改前的值）
  function getRowForWhere(rowIndex: number): any[] {
    const row = [...(result[rowIndex] || [])];
    for (const u of pendingUpdates()) {
      if (u.rowIndex === rowIndex) row[u.colIndex] = u.oldValue;
    }
    return row;
  }

  // 生成 WHERE 条件片段：NULL 须用 IS NULL，不能用 = NULL
  function formatWhereCondition(colName: string, value: unknown, dataTypeOid?: number): string {
    if (value === null || value === undefined) return `${colName} IS NULL`;
    return `${colName} = ${formatSqlValueShared(value, dataTypeOid)}`;
  }

  // 生成 UPDATE SQL（使用共享的 formatSqlValue 以兼容 timestamp 精度等）
  function generateUpdateSql(rowIndex: number, colIndex: number, newValue: string | null): string {
    const colInfo = columns()[colIndex];
    const row = getRowForWhere(rowIndex);

    const whereConditions = colInfo.uniqueKeyColumns!.map((keyColName, i) => {
      const keyColIndex = colInfo.uniqueKeyFieldIndices![i];
      const keyValue = row[keyColIndex];
      const keyOid = columns()[keyColIndex]?.dataTypeOid;
      return formatWhereCondition(keyColName, keyValue, keyOid);
    });

    return `UPDATE ${colInfo.tableName} SET ${colInfo.columnName} = ${formatSqlValueShared(newValue, colInfo.dataTypeOid)} WHERE ${whereConditions.join(" AND ")}`;
  }

  // 生成 DELETE SQL（使用第一个有 uniqueKeyColumns 的列）
  function generateDeleteSql(rowIndex: number): string | null {
    const cols = columns();
    const colInfo = cols.find(c => c.uniqueKeyColumns?.length && c.tableName);
    if (!colInfo?.uniqueKeyColumns || !colInfo.uniqueKeyFieldIndices) return null;
    const row = getRowForWhere(rowIndex);
    const whereConditions = colInfo.uniqueKeyColumns.map((keyColName, i) => {
      const keyColIndex = colInfo.uniqueKeyFieldIndices![i];
      const keyValue = row[keyColIndex];
      const keyOid = cols[keyColIndex]?.dataTypeOid;
      return formatWhereCondition(keyColName, keyValue, keyOid);
    });
    return `DELETE FROM ${colInfo.tableName} WHERE ${whereConditions.join(" AND ")}`;
  }

  // 处理删除单行（加入待执行列表）
  function handleDeleteRow(rowIndex: number) {
    const sql = generateDeleteSql(rowIndex);
    if (!sql) return;
    setPendingDeletes(prev => [...prev, { sql, rowIndex }]);
    const updates = pendingUpdates();
    for (let i = updates.length - 1; i >= 0; i--) {
      if (updates[i].rowIndex === rowIndex) removePendingUpdate(i);
    }
  }

  // 删除选区内的所有行（排除已待删除的）
  function handleDeleteSelectedRows() {
    const rows = selectedRows();
    const alreadyPending = new Set(pendingDeletes().map(d => d.rowIndex));
    for (const rowIndex of rows) {
      if (alreadyPending.has(rowIndex)) continue;
      handleDeleteRow(rowIndex);
    }
    setTableContextMenu(null);
  }

  // 在选区最后一行下方插入（无选区则在末尾插入）
  function handleInsertRowBelowSelection() {
    const belowRow = lastSelectedRow();
    handleAddRow(belowRow);
    setTableContextMenu(null);
  }

  // 移除一条待执行的删除
  function removePendingDelete(index: number) {
    setPendingDeletes(prev => prev.filter((_, i) => i !== index));
  }

  const canDeleteRow = () => columns().some(c => c.uniqueKeyColumns?.length && c.tableName);

  // 生成 INSERT SQL（使用第一个有 tableName 的表的可插入列）
  function generateInsertSql(rowIndex: number): string | null {
    const row = result[rowIndex];
    const cols = columns();
    const firstTable = cols.find(c => c.tableName && c.columnName)?.tableName;
    if (!firstTable) return null;
    const tableCols = cols
      .map((c, i) => ({ ...c, colIndex: i }))
      .filter(c => c.tableName === firstTable && c.columnName);
    if (tableCols.length === 0) return null;
    const colNames = tableCols.map(c => c.columnName!);
    const values = tableCols.map(c => formatSqlValueShared(row[c.colIndex], c.dataTypeOid));
    return `INSERT INTO ${firstTable} (${colNames.join(", ")}) VALUES (${values.join(", ")})`;
  }

  const canAddRow = () => columns().some(c => c.tableName && c.columnName);

  // 处理添加行，在 belowRowIndex 下方插入（空表时 belowRowIndex=-1，插入到索引 0）
  function handleAddRow(belowRowIndex: number) {
    const cols = columns();
    if (cols.length === 0) return;
    const insertAt = Math.max(0, belowRowIndex + 1);
    const newRow = cols.map(() => null);
    const newModifiedRow = cols.map(() => false);
    // 使用不可变更新，兼容空表（produce 对空数组可能有兼容问题）
    setResult(prev => [...prev.slice(0, insertAt), newRow, ...prev.slice(insertAt)]);
    setModifiedCells(prev => [...prev.slice(0, insertAt), newModifiedRow, ...prev.slice(insertAt)]);
    // 更新后续行的索引
    setPendingInserts(prev => prev.map(p => p.rowIndex >= insertAt ? { rowIndex: p.rowIndex + 1 } : p).concat([{ rowIndex: insertAt }]));
    setPendingDeletes(prev => prev.map(d => ({ ...d, rowIndex: d.rowIndex >= insertAt ? d.rowIndex + 1 : d.rowIndex })));
    setPendingUpdates(prev => prev.map(u => ({ ...u, rowIndex: u.rowIndex >= insertAt ? u.rowIndex + 1 : u.rowIndex })));
  }

  // 移除一条待执行的添加
  function removePendingInsert(index: number) {
    const ins = pendingInserts()[index];
    if (!ins) return;
    setResult(produce(prev => { prev.splice(ins.rowIndex, 1); }));
    setModifiedCells(produce(prev => { prev.splice(ins.rowIndex, 1); }));
    setPendingInserts(prev =>
      prev.filter((_, i) => i !== index).map(p =>
        p.rowIndex > ins.rowIndex ? { rowIndex: p.rowIndex - 1 } : p
      )
    );
  }

  // 表格右键菜单：点击外部关闭
  let tableContextMenuRef: HTMLDivElement | null = null;
  createEffect(() => {
    if (!tableContextMenu()) return;
    const h = (e: MouseEvent) => {
      if (tableContextMenuRef?.contains(e.target as Node)) return;
      setTableContextMenu(null);
    };
    document.addEventListener("click", h, true);
    document.addEventListener("contextmenu", h, true);
    onCleanup(() => {
      document.removeEventListener("click", h, true);
      document.removeEventListener("contextmenu", h, true);
    });
  });

  // 导出下拉：点击外部关闭
  let exportMenuRef: HTMLDivElement | null = null;
  createEffect(() => {
    if (!showExportMenu()) return;
    const h = (e: MouseEvent) => {
      if (exportMenuRef?.contains(e.target as Node)) return;
      setShowExportMenu(false);
    };
    document.addEventListener("click", h, true);
    onCleanup(() => document.removeEventListener("click", h, true));
  });

  // 处理单元格保存（newValue 为 null 表示设为 SQL NULL）
  function handleCellSave(rowIndex: number, colIndex: number, newValue: string | null) {
    const currentValue = result[rowIndex][colIndex];

    if (newValue === null && (currentValue === null || currentValue === undefined)) return;
    if (newValue !== null && formatCellToEditable(currentValue) === newValue) return;

    // 待插入行：只更新本地数据，不生成 UPDATE
    if (pendingInserts().some(p => p.rowIndex === rowIndex)) {
      setResult(rowIndex, colIndex, newValue);
      setModifiedCells(rowIndex, colIndex, true);
      return;
    }

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

  // 执行所有待保存的 UPDATE、DELETE、INSERT（使用 adminClient）
  async function saveAllChanges() {
    if (pendingUpdates().length === 0 && pendingDeletes().length === 0 && pendingInserts().length === 0) return;
    const cid = props.activeConnectionId?.();
    if (!cid) return;

    setSaving(true);
    setError(null);

    try {
      for (const update of pendingUpdates()) {
        const res = await saveChanges(cid, update.sql);
        if (!res.success && res.error) {
          throw new Error(res.error || `执行失败: ${update.sql}`);
        }
      }
      for (const update of pendingUpdates()) {
        setModifiedCells(update.rowIndex, update.colIndex, false);
      }
      setPendingUpdates([]);

      // 按行索引倒序执行 DELETE，避免删除后索引变化
      const sortedDeletes = [...pendingDeletes()].sort((a, b) => b.rowIndex - a.rowIndex);
      for (const del of sortedDeletes) {
        const res = await saveChanges(cid, del.sql);
        if (!res.success && res.error) {
          throw new Error(res.error || `执行失败: ${del.sql}`);
        }
      }
      setResult(produce(prev => {
        for (const del of sortedDeletes) prev.splice(del.rowIndex, 1);
      }));
      setModifiedCells(produce(prev => {
        for (const del of sortedDeletes) prev.splice(del.rowIndex, 1);
      }));
      setPendingDeletes([]);

      // 执行 INSERT（按行索引正序，避免影响后续索引）
      for (const ins of pendingInserts()) {
        const sql = generateInsertSql(ins.rowIndex);
        if (!sql) continue;
        const res = await saveChanges(cid, sql);
        if (!res.success && res.error) {
          throw new Error(res.error || `执行失败: ${sql}`);
        }
      }
      for (const ins of pendingInserts()) {
        for (let c = 0; c < columns().length; c++) {
          setModifiedCells(ins.rowIndex, c, false);
        }
      }
      setPendingInserts([]);
    } catch (e: any) {
      setError(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function renderResult() {
    if (loading()) {
      return (<div style={{ padding: "16px", "text-align": "center", color: vscode.foregroundDim }}>
        查询中...
      </div>);
    }
    if (error()) {
      return (<div style={{ color: vscode.error, padding: "16px" }}>
        {error()}
      </div>);
    }
    return (
      <div style={{ display: "flex", "flex-direction": "column", height: "100%" }}>
        <div style={{
          "margin-bottom": "12px",
          color: vscode.foregroundDim,
          "font-size": "13px",
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          "flex-shrink": "0"
        }}>
          <span>
            查询结果：{hasMore() ? "已加载" : "共"} {result.length} 行，{columns().length} 列
            <Show when={hasMore()}>
              <span style={{ "margin-left": "8px", color: vscode.accent }}>
                (滚动加载更多)
              </span>
            </Show>
            <Show when={loadingMore()}>
              <span style={{ "margin-left": "8px", color: vscode.warning }}>
                加载中...
              </span>
            </Show>
            <Show when={queryDuration() !== null}>
              <span style={{ "margin-left": "12px", color: vscode.success }}>
                耗时 {formatDuration(queryDuration()!)}
              </span>
            </Show>
          </span>
          <div style={{ display: "flex", "align-items": "center", gap: "12px" }}>
            <Show when={result.length > 0}>
              <div ref={(el) => (exportMenuRef = el)} style={{ position: "relative" }}>
                <button
                  onClick={() => setShowExportMenu(!showExportMenu())}
                  style={{
                    padding: "6px 16px",
                    "font-size": "14px",
                    "background-color": vscode.buttonSecondary,
                    color: "#fff",
                    border: "none",
                    "border-radius": "4px",
                    cursor: "pointer"
                  }}
                >
                  导出 ▼
                </button>
                <Show when={showExportMenu()}>
                  <div
                    role="menu"
                    style={{
                      position: "absolute",
                      top: "100%",
                      right: 0,
                      "margin-top": "4px",
                      "z-index": 100,
                      background: vscode.sidebarBg,
                      border: `1px solid ${vscode.border}`,
                      "border-radius": "4px",
                      "box-shadow": "0 2px 8px rgba(0,0,0,0.15)",
                      "min-width": "140px",
                      padding: "4px 0"
                    }}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { exportAsCsv(columns(), result, "query-result.csv"); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", padding: "8px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "13px", color: vscode.foreground }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      导出 CSV
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { exportAsJson(columns(), result, "query-result.json"); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", padding: "8px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "13px", color: vscode.foreground }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      导出 JSON
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { exportAsExcel(columns(), result, "query-result.xlsx"); setShowExportMenu(false); }}
                      style={{ display: "block", width: "100%", padding: "8px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "13px", color: vscode.foreground }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    >
                      导出 Excel
                    </button>
                  </div>
                </Show>
              </div>
            </Show>
            <span style={{ color: (pendingUpdates().length > 0 || pendingDeletes().length > 0 || pendingInserts().length > 0) ? vscode.warning : vscode.foregroundDim }}>
              {pendingUpdates().length + pendingDeletes().length + pendingInserts().length} 个待保存的修改
            </span>
            <button
              onClick={() => setShowPendingSql(!showPendingSql())}
              style={{
                padding: "6px 16px",
                "font-size": "14px",
                "background-color": vscode.buttonSecondary,
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
              disabled={saving() || (pendingUpdates().length === 0 && pendingDeletes().length === 0 && pendingInserts().length === 0)}
              style={{
                padding: "6px 16px",
                "font-size": "14px",
                "background-color": (pendingUpdates().length > 0 || pendingDeletes().length > 0 || pendingInserts().length > 0) ? vscode.buttonBg : vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "4px",
                cursor: (saving() || (pendingUpdates().length === 0 && pendingDeletes().length === 0 && pendingInserts().length === 0)) ? "not-allowed" : "pointer"
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
            "background-color": "rgba(220, 220, 170, 0.15)",
            border: `1px solid ${vscode.warning}`,
            "flex-shrink": "0"
          }}>
            <div style={{ "font-weight": "bold", "margin-bottom": "8px", color: vscode.warning }}>
              待执行的 SQL:
            </div>
            <Show when={pendingUpdates().length === 0 && pendingDeletes().length === 0 && pendingInserts().length === 0}>
              <div style={{ color: vscode.foregroundDim, "font-size": "13px" }}>暂无修改</div>
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
                    "background-color": vscode.inputBg,
                    border: `1px solid ${vscode.border}`
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
                        "background-color": vscode.error,
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
            <Show when={pendingDeletes().length > 0}>
              <div style={{ "font-weight": "bold", "margin": "12px 0 8px", color: vscode.error }}>
                待执行的 DELETE:
              </div>
              <div style={{
                "max-height": "200px",
                "overflow-y": "auto",
                display: "flex",
                "flex-direction": "column",
                gap: "6px"
              }}>
                <For each={pendingDeletes()}>
                  {(del, index) => (
                    <div style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      padding: "6px 8px",
                      "background-color": vscode.inputBg,
                      border: `1px solid ${vscode.border}`
                    }}>
                      <span style={{
                        flex: "1",
                        "font-family": "monospace",
                        "font-size": "13px",
                        "word-break": "break-all"
                      }}>
                        {index() + 1}. {del.sql};
                      </span>
                      <button
                        onClick={() => removePendingDelete(index())}
                        style={{
                          padding: "2px 8px",
                          "font-size": "12px",
                          "background-color": vscode.error,
                          color: "#fff",
                          border: "none",
                          "border-radius": "4px",
                          cursor: "pointer",
                          "flex-shrink": "0"
                        }}
                        title="取消此删除"
                      >
                        删除
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </Show>
            <Show when={pendingInserts().length > 0}>
              <div style={{ "font-weight": "bold", "margin": "12px 0 8px", color: vscode.success }}>
                待执行的 INSERT:
              </div>
              <div style={{
                "max-height": "200px",
                "overflow-y": "auto",
                display: "flex",
                "flex-direction": "column",
                gap: "6px"
              }}>
                <For each={pendingInserts()}>
                  {(ins, index) => {
                    const sql = () => generateInsertSql(ins.rowIndex);
                    return (
                    <div style={{
                      display: "flex",
                      "align-items": "center",
                      gap: "8px",
                      padding: "6px 8px",
                      "background-color": vscode.inputBg,
                      border: `1px solid ${vscode.border}`
                    }}>
                      <span style={{
                        flex: "1",
                        "font-family": "monospace",
                        "font-size": "13px",
                        "word-break": "break-all"
                      }}>
                        {index() + 1}. {sql() ?? "..."};
                      </span>
                      <button
                        onClick={() => removePendingInsert(index())}
                        style={{
                          padding: "2px 8px",
                          "font-size": "12px",
                          "background-color": vscode.error,
                          color: "#fff",
                          border: "none",
                          "border-radius": "4px",
                          cursor: "pointer",
                          "flex-shrink": "0"
                        }}
                        title="取消此插入"
                      >
                        删除
                      </button>
                    </div>
                  ); }}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        {/* 虚拟滚动表格容器：tabIndex 使单击单元格后能获得焦点，webview 中 Ctrl+C 才能正确识别为表格复制 */}
        <div
          ref={(el) => setTableContainerRef(el)}
          id="table-container"
          tabIndex={0}
          onScroll={handleScroll}
          onContextMenu={(e) => {
            if ((e.target as Element).closest("td")) return;
            e.preventDefault();
            setTableContextMenu({ x: e.clientX, y: e.clientY });
          }}
          style={{
            flex: 1,
            overflow: "auto",
            position: "relative",
            border: `1px solid ${vscode.border}`,
            "background-color": vscode.editorBg,
            outline: "none"
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
            }}
          >
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
              <thead style={{ position: "sticky", top: 0, "z-index": 20, "background-color": vscode.tabBarBg }}>
                <tr>
                  <For each={columns()}>
                    {(col, colIndex) => (
                      <th
                        scope="col"
                        style={{
                          padding: "8px 12px",
                          "text-align": "center",
                          "font-weight": "600",
                          border: `1px solid ${vscode.border}`,
                          color: vscode.foreground,
                          position: "relative",
                          "user-select": "none",
                          "min-height": `${ROW_HEIGHT}px`,
                          "box-sizing": "border-box"
                        }}
                      >
                        <div style={{ display: "flex", "flex-direction": "column", "align-items": "center", gap: "2px" }}>
                          <span>{col.name}</span>
                          {(getDataTypeName(col.dataTypeOid) || col.nullable !== undefined) && (
                            <span style={{ "font-size": "11px", color: vscode.foregroundDim, "font-weight": "400" }}>
                              {[
                                getDataTypeName(col.dataTypeOid),
                                col.nullable === true ? "nullable" : col.nullable === false ? "NOT NULL" : undefined
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          )}
                        </div>
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
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.accent)}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                        />
                      </th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody
                ref={setTbodyRef}
                style={{
                  "user-select": "none",
                  // 防止框选时同时选中文本；复制由自定义 handler 处理
                  // 使用占位行来实现虚拟滚动，这样可以保持完美的表格布局
                }}
              >
                {/* 顶部占位行 */}
                <tr style={{ height: `${offsetY()}px` }}>
                  <td
                    colSpan={Math.max(1, columns().length)}
                    style={{ padding: 0, border: "none" }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTableContextMenu({ x: e.clientX, y: e.clientY });
                    }}
                  />
                </tr>

                <For each={visible().indices}>
                  {(rowIndex) => {
                    const pendingDel = () => pendingDeletes().some(d => d.rowIndex === rowIndex);
                    const pendingIns = () => pendingInserts().some(p => p.rowIndex === rowIndex);
                    return (
                    <tr style={{
                      height: `${ROW_HEIGHT}px`,
                      "box-sizing": "border-box",
                      "border-left": pendingDel() ? `3px solid ${vscode.error}` : pendingIns() ? `3px solid ${vscode.success}` : undefined
                    }}>
                      <For each={columns()}>
                        {(colInfo, colIndex) => {
                          const c = colIndex();
                          return (
                            <EditableCell
                              value={() => result[rowIndex][c]}
                              rowIndex={rowIndex}
                              colIndex={c}
                              dataTypeOid={colInfo.dataTypeOid}
                              isEditable={colInfo.isEditable || (pendingInserts().some(p => p.rowIndex === rowIndex) && !!colInfo.tableName && !!colInfo.columnName)}
                              isModified={modifiedCells[rowIndex]?.[c] ?? false}
                              isPendingDelete={pendingDel()}
                              isPendingInsert={pendingIns()}
                              isSelected={isCellSelected(rowIndex, c)}
                              neighborSelected={{
                                left: c > 0 && isCellSelected(rowIndex, c - 1),
                                right: c < columns().length - 1 && isCellSelected(rowIndex, c + 1),
                                top: rowIndex > 0 && isCellSelected(rowIndex - 1, c),
                                bottom: rowIndex < result.length - 1 && isCellSelected(rowIndex + 1, c)
                              }}
                              onMouseDown={(e) => handleCellMouseDown(rowIndex, c, e)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                const key = cellKey(rowIndex, c);
                                if (!selection()?.has(key)) {
                                  setSelection(new Set([key]));
                                  setSelectionOrigin({ row: rowIndex, col: c });
                                }
                                setTableContextMenu({ x: e.clientX, y: e.clientY, contextCell: { rowIndex, colIndex: c } });
                              }}
                              align={getAlignmentFromDataType(colInfo.dataTypeOid)}
                              onSave={(newValue) => handleCellSave(rowIndex, c, newValue)}
                            />
                          );
                        }}
                      </For>
                    </tr>
                  ); }}
                </For>

                {/* 底部占位行（结果为空时保持最小高度以便右键添加行） */}
                <tr style={{
                  height: result.length === 0
                    ? `${Math.max(100, containerHeight() - ROW_HEIGHT)}px`
                    : `${Math.max(0, totalHeight() - offsetY() - (visible().indices.length * ROW_HEIGHT))}px`
                }}>
                  <td
                    colSpan={Math.max(1, columns().length)}
                    style={{ padding: 0, border: "none" }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setTableContextMenu({ x: e.clientX, y: e.clientY });
                    }}
                  />
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
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.success)}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            />

            {/* 统一表格右键菜单 */}
            <Show when={tableContextMenu()}>
              {(menu) => {
                const ctx = () => menu().contextCell;
                const rowIndex = () => ctx()?.rowIndex ?? -1;
                const colIndex = () => ctx()?.colIndex ?? -1;
                const hasContextCell = () => ctx() != null;
                const colInfo = () => columns()[colIndex()];
                const isCellModified = () => modifiedCells[rowIndex()]?.[colIndex()] ?? false;
                const isRowPendingDelete = () => pendingDeletes().some(d => d.rowIndex === rowIndex());
                const isRowPendingInsert = () => pendingInserts().some(p => p.rowIndex === rowIndex());
                const isCellEditable = () => colInfo() && (colInfo()!.isEditable || (isRowPendingInsert() && !!colInfo()!.tableName && !!colInfo()!.columnName));
                const isJsonOrJsonbColumn = () => {
                  const oid = colInfo()?.dataTypeOid;
                  return oid === PG_OID.json || oid === PG_OID.jsonb;
                };
                return (
                  <div
                    ref={(el) => (tableContextMenuRef = el)}
                    role="menu"
                    style={{
                      position: "fixed",
                      left: `${menu().x}px`,
                      top: `${menu().y}px`,
                      "z-index": 10000,
                      background: vscode.sidebarBg,
                      border: `1px solid ${vscode.border}`,
                      color: vscode.foreground,
                      "border-radius": "4px",
                      "box-shadow": "0 2px 8px rgba(0,0,0,0.15)",
                      "min-width": "120px",
                      padding: "4px 0",
                    }}
                  >
                    <Show when={hasContextCell() && (() => { const s = selection(); const keys = (s && s.size > 0) ? [...s] : [cellKey(rowIndex(), colIndex())]; return keys.some(k => { const [r, c] = k.split(",").map(Number); return modifiedCells[r]?.[c]; }); })()}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          const sel = selection();
                          const cellsToUndo = (sel && sel.size > 0) ? [...sel] : [cellKey(rowIndex(), colIndex())];
                          const indicesToRemove: number[] = [];
                          for (const k of cellsToUndo) {
                            const [r, c] = k.split(",").map(Number);
                            if (!(modifiedCells[r]?.[c])) continue;
                            if (pendingInserts().some(p => p.rowIndex === r)) {
                              setResult(r, c, null);
                              setModifiedCells(r, c, false);
                            } else {
                              const idx = pendingUpdates().findIndex(u => u.rowIndex === r && u.colIndex === c);
                              if (idx >= 0) indicesToRemove.push(idx);
                            }
                          }
                          for (const i of [...new Set(indicesToRemove)].sort((a, b) => b - a)) removePendingUpdate(i);
                          setTableContextMenu(null);
                        }}
                        style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "inherit", color: vscode.foreground, "font-weight": "500" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        撤销修改
                      </button>
                    </Show>
                    <Show when={hasContextCell() && isJsonOrJsonbColumn()}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          const ri = rowIndex();
                          const ci = colIndex();
                          const col = columns()[ci];
                          const raw = result[ri][ci];
                          const editable =
                            col &&
                            (col.isEditable ||
                              (pendingInserts().some((p) => p.rowIndex === ri) && !!col.tableName && !!col.columnName));
                          openJsonbEditor({
                            initialValue: cellValueToJsonbInitial(raw),
                            isReadOnly: !editable,
                            onSave: (v) => handleCellSave(ri, ci, v),
                          });
                          setTableContextMenu(null);
                        }}
                        style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "inherit", color: vscode.foreground, "font-weight": "500" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        打开 JSON/JSONB 编辑器
                      </button>
                    </Show>
                    <Show when={hasContextCell() && isCellEditable()}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          const sel = selection();
                          const cols = columns();
                          if (sel && sel.size > 0) {
                            for (const k of sel) {
                              const [r, c] = k.split(",").map(Number);
                              const col = cols[c];
                              const editable = col && (col.isEditable || (pendingInserts().some(p => p.rowIndex === r) && col.tableName && col.columnName));
                              if (editable) handleCellSave(r, c, null);
                            }
                          } else {
                            handleCellSave(rowIndex(), colIndex(), null);
                          }
                          setTableContextMenu(null);
                        }}
                        style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "inherit", color: vscode.foreground, "font-weight": "500" }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        Set null
                      </button>
                    </Show>
                    <Show when={hasContextCell() && isRowPendingDelete()}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          const sel = selectedRows();
                          const rowsToUndo = sel.length > 0 ? sel : [rowIndex()];
                          const indices = pendingDeletes()
                            .map((d, i) => (rowsToUndo.includes(d.rowIndex) ? i : -1))
                            .filter(i => i >= 0);
                          for (const i of [...new Set(indices)].sort((a, b) => b - a)) {
                            removePendingDelete(i);
                          }
                          setTableContextMenu(null);
                        }}
                        style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "inherit", color: vscode.success }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        撤销删除
                      </button>
                    </Show>
                    <Show when={hasContextCell() && isRowPendingInsert()}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          const idx = pendingInserts().findIndex(p => p.rowIndex === rowIndex());
                          if (idx >= 0) removePendingInsert(idx);
                          setTableContextMenu(null);
                        }}
                        style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "inherit", color: vscode.success }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        撤销添加
                      </button>
                    </Show>
                    <Show when={canAddRow()}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => { e.stopPropagation(); handleInsertRowBelowSelection(); }}
                        style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "inherit", color: vscode.success }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        插入行
                      </button>
                    </Show>
                    <Show when={selectedRows().length > 0 && canDeleteRow()}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => { e.stopPropagation(); handleDeleteSelectedRows(); }}
                        style={{ display: "block", width: "100%", padding: "6px 12px", border: "none", background: "none", "text-align": "left", cursor: "pointer", "font-size": "inherit", color: vscode.error }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        删除行
                      </button>
                    </Show>
                  </div>
                );
              }}
            </Show>
          </div>
        </div>
      </div>
    );
  }

  // 处理从 Sidebar 发来的查询请求（使用只读 API，不阻塞用户操作）
  async function handleQueryRequest(connectionId: string, querySql: string) {
    setSql(querySql);
    setLoading(true);
    setError(null);
    resetTableScrollForNewQuery();
    setResult([]);
    setPendingUpdates([]);
    setPendingDeletes([]);
    setPendingInserts([]);
    setQueryDuration(null);
    setHasMore(false);
    setModifiedCells([]);
    
    const startTime = performance.now();
    try {
      const data = await queryReadonly(connectionId, querySql, 1000);
      if (data.error) {
        throw new Error(data.error);
      }

      const newCols = data.columns || [];
      setColumns(newCols);
      const cur = columnWidths;
      if (cur.length === newCols.length) {
        setColumnWidths(cur.map((w, i) => w || 120));
      } else {
        setColumnWidths(newCols.map(() => 120));
      }

      const rows = data.rows || [];
      setResult(rows);
      
      const colCount = (data.columns || []).length;
      setModifiedCells(rows.map(() => Array(colCount).fill(false)));
      setHasMore(data.hasMore || false);
      setQueryDuration(performance.now() - startTime);
      addQuery(querySql, connectionId).catch((e) => console.warn("查询历史保存失败:", e));
    } catch (e: any) {
      setError(e.message || "请求失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        display: "flex",
        "flex-direction": "column",
        "background-color": vscode.editorBg,
      }}
    >
        {/* CloudBeaver 风格：SQL 与结果上下可调整 */}
        <Resizable
          orientation="vertical"
          initialSizes={[0.35, 0.65]}
          style={{
            display: "flex",
            "flex-direction": "column",
            height: "100%",
            overflow: "hidden",
          }}
        >
          {/* SQL 脚本面板 */}
          <Resizable.Panel
            minSize={0.15}
            collapsible
            collapsedSize={0.05}
            style={{
              overflow: "hidden",
              display: "flex",
              "flex-direction": "column",
              "background-color": vscode.sidebarBg,
              "border-bottom": `1px solid ${vscode.border}`,
            }}
          >
            <div style={{
              "flex-shrink": 0,
              padding: "8px 12px",
              display: "flex",
              gap: "8px",
              "align-items": "center",
              "background-color": vscode.sidebarBg,
              "border-bottom": `1px solid ${vscode.border}`,
            }}>
            <button
              onClick={() => runUserQuery()}
              disabled={loading() || sql().trim().length === 0}
              style={{
                padding: "10px 24px",
                "font-size": "14px",
                "font-weight": "500",
                "background-color": loading() ? vscode.buttonSecondary : vscode.buttonBg,
                color: "#fff",
                border: "none",
                "border-radius": "6px",
                cursor: loading() ? "not-allowed" : "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
                transition: "background-color 0.2s ease"
              }}
            >
              <span>▶</span> 执行
            </button>
            <button
              onClick={() => runExplain()}
              disabled={loading() || explainLoading() || sql().trim().length === 0}
              title="解释分析（EXPLAIN ANALYZE）"
              style={{
                padding: "10px 20px",
                "font-size": "14px",
                "font-weight": "500",
                "background-color": loading() || explainLoading() ? vscode.buttonSecondary : vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "6px",
                cursor: loading() || explainLoading() ? "not-allowed" : "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              <span>📊</span> {explainLoading() ? "分析中..." : "解释分析"}
            </button>
            <Show when={loading()}>
              <button
                onClick={doCancelQuery}
                style={{
                  padding: "10px 24px",
                  "font-size": "14px",
                  "font-weight": "500",
                  "background-color": vscode.error,
                  color: "#fff",
                  border: "none",
                  "border-radius": "6px",
                  cursor: "pointer",
                  display: "flex",
                  "align-items": "center",
                  gap: "6px"
                }}
              >
                <span>⏹</span> 中断
              </button>
            </Show>
            <button
              onClick={() => sqlEditorFormatApi?.format()}
              title="格式化 SQL（Shift+Alt+F）"
              style={{
                padding: "10px 24px",
                "font-size": "14px",
                "font-weight": "500",
                "background-color": vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "6px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              <span>◇</span> 格式化
            </button>
            <button
              onClick={() => setShowQueryBuilder(!showQueryBuilder())}
              style={{
                padding: "10px 24px",
                "font-size": "14px",
                "font-weight": "500",
                "background-color": showQueryBuilder() ? vscode.accent : vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "6px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
                transition: "background-color 0.2s ease"
              }}
            >
              <span>🔧</span> {showQueryBuilder() ? "关闭构建器" : "可视化构建"}
            </button>
            <button
              onClick={() => setShowHistoryPanel(!showHistoryPanel())}
              style={{
                padding: "10px 24px",
                "font-size": "14px",
                "font-weight": "500",
                "background-color": showHistoryPanel() ? vscode.accent : vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "6px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
                transition: "background-color 0.2s ease"
              }}
            >
              <span>📜</span> {showHistoryPanel() ? "关闭历史" : "查询历史"}
            </button>
            <button
              onClick={() => setShowImportModal(true)}
              style={{
                padding: "10px 24px",
                "font-size": "14px",
                "font-weight": "500",
                "background-color": vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "6px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              <span>📥</span> 导入
            </button>
            <button
              onClick={() => setShowAiDialog(true)}
              style={{
                padding: "10px 24px",
                "font-size": "14px",
                "font-weight": "500",
                "background-color": vscode.buttonSecondary,
                color: "#fff",
                border: "none",
                "border-radius": "6px",
                cursor: "pointer",
                display: "flex",
                "align-items": "center",
                gap: "6px",
              }}
            >
              <span>🤖</span> AI 助手
            </button>
            <span style={{ 
              "margin-left": "auto", 
              color: vscode.foregroundDim, 
              "font-size": "12px",
              "font-family": "'JetBrains Mono', monospace" 
            }}>
              Ctrl+Enter 执行
            </span>
            </div>
            <div style={{
              flex: 1,
              "min-height": "80px",
              overflow: "hidden",
              display: "flex",
              gap: "8px",
            }}>
              <div
                style={{
                  flex: 1,
                  "min-width": 0,
                  overflow: "hidden",
                  display: "flex",
                  "flex-direction": "column",
                  "min-height": 0,
                }}
              >
                <div style={{ flex: 1, "min-height": 0, overflow: "hidden" }}>
                  <SqlEditor
                    value={sql()}
                    onChange={setSql}
                    onRun={runUserQuery}
                    onExplain={runExplain}
                    onFormat={(s) => formatSql(s)}
                    onAiEdit={(blockSql, instruction) => {
                      return handleAiEdit(blockSql, instruction);
                    }}
                    onAiCopyPrompt={(blockSql, instruction) => {
                      void handleAiCopyPrompt(blockSql, instruction);
                    }}
                    onAiCopyDiffPrompt={(blockSql) => {
                      void handleAiCopyDiffPrompt(blockSql);
                    }}
                    onAiEditInstructionChange={setAiEditInstruction}
                    onAiEditPhaseChange={(phase) => setAiLoading(phase === "loading")}
                    onEditorReady={(api) => {
                      sqlEditorFormatApi = api;
                    }}
                    style={{ height: "100%" }}
                  />
                </div>
              </div>
              <Show when={showHistoryPanel()}>
                <div style={{ width: "300px", "flex-shrink": 0, overflow: "hidden" }}>
                  <QueryHistoryPanel
                    onSelect={(s) => setSql(s)}
                    onInsertAtEnd={(s) => {
                      const api = sqlEditorFormatApi;
                      if (api) api.insertQueryHistoryAtEnd(s);
                      else setSql((prev) => (prev || "").trimEnd() + "\n\n" + s);
                    }}
                    onExecuteOnly={(s) => runUserQuery(s)}
                    onSelectAndRun={(s) => {
                      setSql(s);
                      runUserQuery();
                    }}
                    onClose={() => setShowHistoryPanel(false)}
                  />
                </div>
              </Show>
            </div>
          </Resizable.Panel>
          <Resizable.Handle
            aria-label="调整 SQL 与结果区域"
            style={{
              height: "5px",
              "flex-shrink": 0,
              "background-color": "transparent",
            }}
          />
          {/* 结果面板：仅活跃 Tab 加 data-result-panel，用于 Ctrl+S 范围判定 */}
          <Resizable.Panel
            minSize={0.2}
            style={{
              overflow: "hidden",
              display: "flex",
              "flex-direction": "column",
              "background-color": vscode.editorBg,
              padding: "16px",
              "box-sizing": "border-box",
            }}
          >
            <div
              style={{
                flex: 1,
                display: "flex",
                "flex-direction": "column",
                "min-height": 0,
                overflow: "hidden",
              }}
            >
              <div style={{
                flex: 1,
                "min-height": 0,
                "background-color": vscode.sidebarBg,
                padding: "16px",
                overflow: "hidden",
                display: "flex",
                "flex-direction": "column",
                border: `1px solid ${vscode.border}`,
              }}>
                {renderResult()}
              </div>

              {/* 数据库通知消息 - 底部可折叠 */}
              <div style={{
              "margin-top": "12px",
              "background-color": vscode.sidebarBg,
              padding: "10px",
              "flex-shrink": "0",
              border: `1px solid ${vscode.border}`,
            }}>
              <div style={{
                display: "flex",
                "justify-content": "space-between",
                "align-items": "center",
                cursor: "pointer",
                "user-select": "none"
              }} onClick={() => setMessagesCollapsed(!messagesCollapsed())}>
                <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                  <span style={{
                    color: vscode.foregroundDim,
                    "font-size": "11px",
                    transition: "transform 0.2s",
                    transform: messagesCollapsed() ? "rotate(-90deg)" : "rotate(0deg)"
                  }}>▼</span>
                  <span style={{ color: vscode.foregroundDim, "font-size": "12px", "font-weight": "600" }}>
                    数据库消息
                  </span>
                  <span style={{
                    width: "6px",
                    height: "6px",
                    "border-radius": "50%",
                    "background-color": sseConnected() ? vscode.success : vscode.error
                  }} title={sseConnected() ? "SSE 已连接" : "SSE 未连接"} />
                  <Show when={notices().length > 0}>
                    <span style={{
                      color: vscode.foregroundDim,
                      "font-size": "11px",
                      "background-color": vscode.inputBg,
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
                    "font-size": "11px",
                    "background-color": vscode.buttonSecondary,
                    color: vscode.foreground,
                    border: "none",
                    "border-radius": "4px",
                    cursor: "pointer"
                  }}
                >
                  清除
                </button>
              </div>

              <Show when={!messagesCollapsed()}>
                <div style={{
                  "margin-top": "8px",
                  "max-height": "120px",
                  "overflow-y": "auto"
                }}>
                  <Show when={notices().length === 0}>
                    <div style={{ color: vscode.foregroundDim, "font-size": "12px" }}>暂无消息</div>
                  </Show>
                  <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
                    <For each={notices()}>
                      {(notice) => {
                        const typeColors: Record<SSEMessage['type'], { bg: string; label: string; text: string }> = {
                          ERROR: { bg: '#4c1d1d', label: '#fca5a5', text: '#fecaca' },
                          WARNING: { bg: '#422006', label: '#fbbf24', text: '#fde68a' },
                          NOTICE: { bg: '#1e3a5f', label: '#60a5fa', text: '#93c5fd' },
                          INFO: { bg: '#334155', label: '#94a3b8', text: '#cbd5e1' },
                          QUERY: { bg: '#1e3a3a', label: '#2dd4bf', text: '#99f6e4' },
                          NOTIFICATION: { bg: '#3b1d4a', label: '#c084fc', text: '#d8b4fe' },
                        };
                        const colors = typeColors[notice.type] || typeColors.INFO;
                        return (
                          <div style={{
                            "font-family": "monospace",
                            "font-size": "12px",
                            "padding": "4px 8px",
                            "background-color": colors.bg,
                            "border-radius": "4px",
                          }}>
                            <span style={{ color: vscode.foregroundDim, "flex-shrink": "0" }}>
                              {new Date(notice.timestamp).toLocaleTimeString()}
                            </span>
                            <span style={{ color: colors.label, "font-weight": "500" }}>[{notice.type}]</span>
                            <span style={{ color: colors.text }}>{notice.message}</span>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
            </div>
          </Resizable.Panel>
        </Resizable>

        {/* Visual Query Builder 弹窗 */}
        <Show when={showQueryBuilder()}>
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            "background-color": "rgba(0, 0, 0, 0.5)",
            "z-index": 100,
            display: "flex",
            "justify-content": "center",
            "align-items": "center",
            padding: "20px",
          }}>
            <div style={{
              width: "100%",
              height: "100%",
              "max-width": "1600px",
              "max-height": "900px",
              "border-radius": "12px",
              overflow: "hidden",
              "box-shadow": "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
            }}>
              <VisualQueryBuilder 
                connectionId={props.activeConnectionId?.() ?? null}
                initialSql={sql().trim() || undefined}
                onExecuteQuery={(generatedSql) => {
                  setSql(generatedSql);
                  setShowQueryBuilder(false);
                  runUserQuery();
                }}
                onClose={() => setShowQueryBuilder(false)}
              />
            </div>
          </div>
        </Show>

        {/* 解释分析弹窗 */}
        <Show when={explainPlan()}>
          <div
            style={{
              position: "fixed",
              inset: 0,
              "background-color": "rgba(0,0,0,0.6)",
              "z-index": 150,
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              padding: "24px",
            }}
            onClick={(e) => e.target === e.currentTarget && setExplainPlan(null)}
          >
            <div
              style={{
                width: "90%",
                "max-width": "900px",
                height: "80%",
                "max-height": "600px",
                "background-color": vscode.editorBg,
                border: `1px solid ${vscode.border}`,
                "border-radius": "8px",
                "box-shadow": "0 16px 48px rgba(0,0,0,0.4)",
                overflow: "hidden",
                display: "flex",
                "flex-direction": "column",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <ExplainPlanViewer plan={explainPlan()!} onClose={() => setExplainPlan(null)} />
            </div>
          </div>
        </Show>
        {/* 导入弹窗 */}
        <Show when={showImportModal()}>
          <ImportModal
            connectionId={props.activeConnectionId?.() ?? null}
            onClose={() => setShowImportModal(false)}
            onSuccess={(msg) => {
              setNotices((prev) => [...prev.slice(-49), { type: "INFO", message: msg, timestamp: Date.now() }]);
            }}
          />
        </Show>
        <Show when={showAiDialog()}>
          <div
            style={{
              position: "fixed",
              inset: 0,
              "background-color": "rgba(0,0,0,0.6)",
              "z-index": 180,
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              padding: "24px",
            }}
            onClick={(e) => e.target === e.currentTarget && setShowAiDialog(false)}
          >
            <div
              style={{
                width: "92%",
                "max-width": "900px",
                "background-color": vscode.editorBg,
                border: `1px solid ${vscode.border}`,
                "border-radius": "10px",
                "box-shadow": "0 16px 48px rgba(0,0,0,0.4)",
                padding: "16px",
                display: "flex",
                "flex-direction": "column",
                gap: "12px",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                <div style={{ "font-size": "16px", "font-weight": "600", color: vscode.foreground }}>AI 助手</div>
                <button
                  onClick={() => setShowAiDialog(false)}
                  style={{ border: "none", background: "none", color: vscode.foregroundDim, cursor: "pointer", "font-size": "20px", "line-height": 1 }}
                >
                  ×
                </button>
              </div>

              <div style={{ "font-size": "12px", color: vscode.foregroundDim }}>
                此处仅用于配置 AI。实际使用请在 SQL 编辑器每个语句块的 View Zone 中点击 <strong>AI Edit</strong>，
                结果会自动插入到该块下方的 AI 注释下面。
              </div>
              <div
                style={{
                  "font-size": "12px",
                  color: vscode.foregroundDim,
                  padding: "10px",
                  border: `1px solid ${vscode.border}`,
                  "border-radius": "6px",
                  "line-height": 1.6,
                  "background-color": vscode.inputBg,
                }}
              >
                <div><strong>配置说明</strong></div>
                <div>Base URL：服务地址（示例：OpenAI `https://api.openai.com/v1`，Aliyun `https://dashscope.aliyuncs.com/compatible-mode/v1`）。</div>
                <div>Model：模型名（示例：`gpt-4o-mini`、`qwen-plus`）。</div>
                <div>API Key：你的服务密钥；在 VSCode 插件中会存入 SecretStorage。</div>
                <div>高级设置：`temperature` 越低越稳定；`top_p` 默认 1 即可；`max_tokens` 控制回复长度；`stream` 决定是否流式返回。</div>
                <div>推荐：SQL 场景可用 `temperature=0.2`、`top_p=1`、`max_tokens=700`。</div>
              </div>

              <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
                <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                  <div style={{ width: "120px", "font-size": "12px", color: vscode.foregroundDim }}>接口格式</div>
                  <select
                    value={aiApiMode()}
                    onChange={(e) => {
                      const mode = e.currentTarget.value as "anthropic" | "openai-compatible";
                      setAiApiMode(mode);
                    }}
                    style={{ padding: "8px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "6px", width: "100%" }}
                  >
                    <option value="openai-compatible">OpenAI Compatible</option>
                    <option value="anthropic">Anthropic</option>
                  </select>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "8px", "margin-left": "130px", "flex-wrap": "wrap" }}>
                  <span style={{ "font-size": "12px", color: vscode.foregroundDim }}>快捷填充:</span>
                  <button
                    onClick={() => applyAiPreset("openai")}
                    style={{ padding: "6px 10px", border: `1px solid ${vscode.border}`, "border-radius": "999px", background: "transparent", color: vscode.foreground, cursor: "pointer", "font-size": "12px", "white-space": "nowrap" }}
                  >
                    OpenAI
                  </button>
                  <button
                    onClick={() => applyAiPreset("anthropic")}
                    style={{ padding: "6px 10px", border: `1px solid ${vscode.border}`, "border-radius": "999px", background: "transparent", color: vscode.foreground, cursor: "pointer", "font-size": "12px", "white-space": "nowrap" }}
                  >
                    Anthropic
                  </button>
                  <button
                    onClick={() => applyAiPreset("aliyun")}
                    style={{ padding: "6px 10px", border: `1px solid ${vscode.border}`, "border-radius": "999px", background: "transparent", color: vscode.foreground, cursor: "pointer", "font-size": "12px", "white-space": "nowrap" }}
                  >
                    Aliyun
                  </button>
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                  <div style={{ width: "120px", "font-size": "12px", color: vscode.foregroundDim }}>url</div>
                  <input
                    value={aiBaseUrl()}
                    onInput={(e) => setAiBaseUrl(e.currentTarget.value)}
                    placeholder="Base URL (e.g. https://api.openai.com/v1)"
                    style={{ padding: "8px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "6px", width: "100%" }}
                  />
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                  <div style={{ width: "120px", "font-size": "12px", color: vscode.foregroundDim }}>model</div>
                  <input value={aiModel()} onInput={(e) => setAiModel(e.currentTarget.value)} placeholder="model" style={{ padding: "8px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "6px", width: "100%" }} />
                </div>
                <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                  <div style={{ width: "120px", "font-size": "12px", color: vscode.foregroundDim }}>api key</div>
                  <input value={aiApiKey()} onInput={(e) => setAiApiKey(e.currentTarget.value)} placeholder={aiHasStoredKey() ? "已保存（留空表示不修改）" : "AI API Key (可留空)"} type="password" style={{ padding: "8px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "6px", width: "100%" }} />
                </div>
                <div style={{ "margin-left": "130px", display: "flex", "justify-content": "flex-end" }}>
                  <button
                    onClick={clearStoredAiKey}
                    disabled={!aiHasStoredKey()}
                    style={{ padding: "6px 10px", border: `1px solid ${vscode.border}`, "border-radius": "6px", background: "transparent", color: aiHasStoredKey() ? vscode.foreground : vscode.foregroundDim, cursor: aiHasStoredKey() ? "pointer" : "not-allowed", "font-size": "12px", "white-space": "nowrap" }}
                  >
                    清除已保存 key
                  </button>
                </div>
                <div style={{ "margin-left": "130px", "font-size": "12px", color: aiHasStoredKey() ? "#2ea043" : vscode.foregroundDim }}>
                  {aiHasStoredKey() ? "状态：已保存本地密钥（不回显明文）" : "状态：未保存密钥"}
                </div>
                <button
                  onClick={() => setShowAiAdvanced((v) => !v)}
                  style={{
                    border: `1px solid ${vscode.border}`,
                    "border-radius": "6px",
                    background: "transparent",
                    color: vscode.foreground,
                    cursor: "pointer",
                    padding: "8px 10px",
                    "text-align": "left",
                  }}
                >
                  {showAiAdvanced() ? "收起高级设置 ▲" : "展开高级设置 ▼"}
                </button>
                <Show when={showAiAdvanced()}>
                  <div style={{ display: "flex", "flex-direction": "column", gap: "10px", padding: "10px", border: `1px dashed ${vscode.border}`, "border-radius": "6px" }}>
                    <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                      <div style={{ width: "120px", "font-size": "12px", color: vscode.foregroundDim }}>temperature</div>
                      <input value={aiTemperature()} onInput={(e) => setAiTemperature(e.currentTarget.value)} placeholder="temperature (0~1)" style={{ padding: "8px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "6px", width: "100%" }} />
                    </div>
                    <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                      <div style={{ width: "120px", "font-size": "12px", color: vscode.foregroundDim }}>top_p</div>
                      <input value={aiTopP()} onInput={(e) => setAiTopP(e.currentTarget.value)} placeholder="top_p (0~1)" style={{ padding: "8px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "6px", width: "100%" }} />
                    </div>
                    <div style={{ display: "flex", "align-items": "center", gap: "10px" }}>
                      <div style={{ width: "120px", "font-size": "12px", color: vscode.foregroundDim }}>max_tokens</div>
                      <input value={aiMaxTokens()} onInput={(e) => setAiMaxTokens(e.currentTarget.value)} placeholder="max_tokens (64~8192)" style={{ padding: "8px", "background-color": vscode.inputBg, color: vscode.foreground, border: `1px solid ${vscode.border}`, "border-radius": "6px", width: "100%" }} />
                    </div>
                    <label style={{ display: "flex", "align-items": "center", gap: "8px", color: vscode.foreground, "font-size": "13px" }}>
                      <input
                        type="checkbox"
                        checked={aiStream()}
                        onChange={(e) => setAiStream(e.currentTarget.checked)}
                      />
                      stream
                    </label>
                  </div>
                </Show>
                <div style={{ display: "flex", "justify-content": "flex-end", gap: "8px" }}>
                  <button onClick={saveAiSettings} disabled={aiLoading()} style={{ border: "none", "border-radius": "6px", cursor: aiLoading() ? "not-allowed" : "pointer", "background-color": vscode.buttonSecondary, color: "#fff", padding: "8px 14px" }}>保存设置</button>
                </div>
              </div>

            </div>
          </div>
        </Show>
    </div>
  );
}
