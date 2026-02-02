import { createSignal, For, Show, onMount, onCleanup, createEffect, createMemo } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { getSessionId } from "./session";

// ================== 类型定义 ==================

interface TableColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey?: boolean;
}


type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL' | 'CROSS';

interface CanvasTable {
  id: string;
  schema: string;
  name: string;
  alias: string;
  columns: TableColumn[];
  position: { x: number; y: number };
  selectedColumns: Set<string>;
  joinType?: JoinType;  // 这个表是如何被 JOIN 进来的（主表没有）
}

interface SelectedColumn {
  id: string;
  tableId: string;
  columnName: string;
  alias: string;
  expression?: string;  // 自定义表达式
  aggregation?: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN' | '';
  isGroupBy: boolean;
}

interface WhereCondition {
  id: string;
  leftOperand: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL' | 'BETWEEN';
  rightOperand: string;
  logicalOperator: 'AND' | 'OR';
}

// JoinCondition 现在是独立的条件，JOIN type 存储在目标表上
interface JoinCondition {
  id: string;
  leftTableId: string;
  leftColumn: string;  // 格式: alias.column_name
  rightTableId: string;
  rightColumn: string;  // 格式: alias.column_name
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=';
}

interface SortColumn {
  id: string;
  column: string;
  direction: 'ASC' | 'DESC';
}

interface QueryState {
  tables: CanvasTable[];
  selectedColumns: SelectedColumn[];
  whereConditions: WhereCondition[];
  joinConditions: JoinCondition[];  // 独立的 ON 条件
  sortColumns: SortColumn[];
  distinct: boolean;
  limit?: number;
  primaryTableId?: string;  // 主表 ID，FROM 子句的起始表
}

interface VisualQueryBuilderProps {
  onExecuteQuery?: (sql: string) => void;
  onClose?: () => void;
}

// ================== 工具函数 ==================

function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

// ================== 主组件 ==================

export default function VisualQueryBuilder(props: VisualQueryBuilderProps) {
  // 可用的表列表
  const [availableTables, setAvailableTables] = createStore<{ schema: string; tables: string[] }[]>([]);
  const [loadingTables, setLoadingTables] = createSignal(false);
  const [expandedSchemas, setExpandedSchemas] = createSignal<Set<string>>(new Set());
  const [tableColumns, setTableColumns] = createStore<Record<string, TableColumn[]>>({});

  // 外键信息缓存
  interface ForeignKeyInfo {
    constraint_name: string;
    source_schema: string;
    source_table: string;
    source_column: string;
    target_schema: string;
    target_table: string;
    target_column: string;
  }
  const [tableForeignKeys, setTableForeignKeys] = createStore<Record<string, { outgoing: ForeignKeyInfo[]; incoming: ForeignKeyInfo[] }>>({});

  // 查询状态
  const [queryState, setQueryState] = createStore<QueryState>({
    tables: [],
    selectedColumns: [],
    whereConditions: [],
    joinConditions: [],
    sortColumns: [],
    distinct: false,
  });

  // UI 状态
  const [activeTab, setActiveTab] = createSignal<'columns' | 'where' | 'joins' | 'sorting' | 'misc'>('columns');
  const [draggedTable, setDraggedTable] = createSignal<{ schema: string; name: string } | null>(null);
  const [canvasRef, setCanvasRef] = createSignal<HTMLDivElement | null>(null);
  const [draggingTableId, setDraggingTableId] = createSignal<string | null>(null);
  const [dragOffset, setDragOffset] = createSignal({ x: 0, y: 0 });
  const [selectedTableId, setSelectedTableId] = createSignal<string | null>(null);
  const [joinLineStart, setJoinLineStart] = createSignal<{ tableId: string; column: string } | null>(null);

  // 表右键菜单状态
  const [tableContextMenu, setTableContextMenu] = createSignal<{ x: number; y: number; tableId: string } | null>(null);

  // JOIN 连线右键菜单状态
  const [joinContextMenu, setJoinContextMenu] = createSignal<{ x: number; y: number; joinId: string } | null>(null);

  // 无限画布状态
  const [scale, setScale] = createSignal(1);  // 缩放比例
  const [panOffset, setPanOffset] = createSignal({ x: 0, y: 0 });  // 平移偏移
  const [isPanning, setIsPanning] = createSignal(false);  // 是否正在平移画布
  const [panStart, setPanStart] = createSignal({ x: 0, y: 0 });  // 平移起始点

  // 右侧面板拖拽排序状态
  const [dragSortItem, setDragSortItem] = createSignal<{ type: 'column' | 'where' | 'sort' | 'table'; id: string } | null>(null);
  const [dragOverItem, setDragOverItem] = createSignal<string | null>(null);

  // 加载可用的表
  async function loadAvailableTables() {
    setLoadingTables(true);
    try {
      const sessionId = getSessionId();
      const schemasRes = await fetch("/api/postgres/schemas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const schemasData = await schemasRes.json();

      if (schemasData.schemas) {
        const schemaList: { schema: string; tables: string[] }[] = [];
        for (const schema of schemasData.schemas) {
          const tablesRes = await fetch("/api/postgres/tables", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId, schema }),
          });
          const tablesData = await tablesRes.json();
          schemaList.push({
            schema,
            tables: [...(tablesData.tables || []), ...(tablesData.views || [])],
          });
        }
        setAvailableTables(schemaList);
      }
    } catch (e) {
      console.error("加载表列表失败:", e);
    } finally {
      setLoadingTables(false);
    }
  }

  // 加载表的列信息
  async function loadTableColumns(schema: string, table: string): Promise<TableColumn[]> {
    const key = `${schema}.${table}`;
    if (tableColumns[key]) {
      return tableColumns[key];
    }

    try {
      const sessionId = getSessionId();
      const res = await fetch("/api/postgres/columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, schema, table }),
      });
      const data = await res.json();

      const columns: TableColumn[] = (data.columns || []).map((col: any) => ({
        name: col.column_name,
        dataType: col.data_type,
        isNullable: col.is_nullable === 'YES',
        isPrimaryKey: false, // TODO: 从约束信息获取
      }));

      setTableColumns(key, columns);
      return columns;
    } catch (e) {
      console.error("加载列信息失败:", e);
      return [];
    }
  }

  // 加载表的外键信息
  async function loadTableForeignKeys(schema: string, table: string): Promise<{ outgoing: ForeignKeyInfo[]; incoming: ForeignKeyInfo[] }> {
    const key = `${schema}.${table}`;
    if (tableForeignKeys[key]) {
      return tableForeignKeys[key];
    }

    try {
      const sessionId = getSessionId();
      const res = await fetch("/api/postgres/foreign-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, schema, table }),
      });
      const data = await res.json();

      const fkInfo = {
        outgoing: data.outgoing || [],
        incoming: data.incoming || [],
      };

      setTableForeignKeys(key, fkInfo);
      return fkInfo;
    } catch (e) {
      console.error("加载外键信息失败:", e);
      return { outgoing: [], incoming: [] };
    }
  }

  onMount(() => {
    loadAvailableTables();
  });

  // 切换 schema 展开状态
  function toggleSchema(schema: string) {
    setExpandedSchemas(prev => {
      const next = new Set(prev);
      if (next.has(schema)) {
        next.delete(schema);
      } else {
        next.add(schema);
      }
      return next;
    });
  }

  // 处理拖拽开始
  function handleTableDragStart(e: DragEvent, schema: string, table: string) {
    setDraggedTable({ schema, name: table });
    e.dataTransfer?.setData('text/plain', JSON.stringify({ schema, table }));
  }

  // 处理拖拽到画布
  function handleCanvasDrop(e: DragEvent) {
    e.preventDefault();
    const draggedData = draggedTable();
    if (!draggedData) return;

    // 转换为画布坐标（考虑缩放和平移）
    const canvasPos = screenToCanvas(e.clientX, e.clientY);

    addTableToCanvas(draggedData.schema, draggedData.name, canvasPos.x, canvasPos.y);
    setDraggedTable(null);
  }

  // 添加表到画布（允许同一个表添加多次，支持 self-join）
  async function addTableToCanvas(schema: string, name: string, x: number, y: number) {
    const columns = await loadTableColumns(schema, name);
    const foreignKeys = await loadTableForeignKeys(schema, name);
    const tableId = generateId();

    // 生成别名（计算同名表的数量）
    const existingCount = queryState.tables.filter(t => t.name === name).length;
    const alias = existingCount > 0 ? `${name.charAt(0)}${existingCount + 1}` : name.charAt(0);

    // 获取现有表的副本（在添加新表之前）
    const existingTables = [...queryState.tables];
    const isFirstTable = existingTables.length === 0;

    const newTable: CanvasTable = {
      id: tableId,
      schema,
      name,
      alias: alias.toLowerCase(),
      columns,
      position: { x, y },
      selectedColumns: new Set(),
      joinType: isFirstTable ? undefined : 'INNER',  // 非主表默认 INNER JOIN
    };

    setQueryState('tables', prev => [...prev, newTable]);

    // 如果是第一个表，设为主表
    if (isFirstTable) {
      setQueryState('primaryTableId', tableId);
    }

    // 自动根据外键创建 JOIN 条件
    if (existingTables.length > 0) {
      const autoConditions: JoinCondition[] = [];

      // 检查新表的外键（outgoing: 新表引用其他表）
      for (const fk of foreignKeys.outgoing) {
        // 找到被引用的表（在现有表中）
        const targetTable = existingTables.find(t =>
          t.schema === fk.target_schema && t.name === fk.target_table
        );

        if (targetTable) {
          // 检查是否已有相同的条件
          const existingCondition = queryState.joinConditions.find(c =>
            (c.leftTableId === tableId && c.rightTableId === targetTable.id &&
              c.leftColumn.endsWith(`.${fk.source_column}`) && c.rightColumn.endsWith(`.${fk.target_column}`)) ||
            (c.leftTableId === targetTable.id && c.rightTableId === tableId &&
              c.leftColumn.endsWith(`.${fk.target_column}`) && c.rightColumn.endsWith(`.${fk.source_column}`))
          );

          if (!existingCondition) {
            autoConditions.push({
              id: generateId(),
              leftTableId: tableId,
              leftColumn: `${newTable.alias}.${fk.source_column}`,
              rightTableId: targetTable.id,
              rightColumn: `${targetTable.alias}.${fk.target_column}`,
              operator: '=',
            });
          }
        }
      }

      // 检查新表被引用的外键（incoming: 其他表引用新表）
      for (const fk of foreignKeys.incoming) {
        // 找到引用新表的表（在现有表中）
        const sourceTable = existingTables.find(t =>
          t.schema === fk.source_schema && t.name === fk.source_table
        );

        if (sourceTable) {
          // 检查是否已有相同的条件（包括刚才创建的）
          const existingCondition = queryState.joinConditions.find(c =>
            (c.leftTableId === tableId && c.rightTableId === sourceTable.id) ||
            (c.leftTableId === sourceTable.id && c.rightTableId === tableId)
          ) || autoConditions.find(c =>
            (c.leftTableId === tableId && c.rightTableId === sourceTable.id) ||
            (c.leftTableId === sourceTable.id && c.rightTableId === tableId)
          );

          if (!existingCondition) {
            autoConditions.push({
              id: generateId(),
              leftTableId: sourceTable.id,
              leftColumn: `${sourceTable.alias}.${fk.source_column}`,
              rightTableId: tableId,
              rightColumn: `${newTable.alias}.${fk.target_column}`,
              operator: '=',
            });
          }
        }
      }

      // 添加所有自动创建的条件
      if (autoConditions.length > 0) {
        setQueryState('joinConditions', prev => [...prev, ...autoConditions]);
        console.log(`自动创建了 ${autoConditions.length} 个基于外键的 JOIN 条件`);
      }
    }
  }

  // 移除画布上的表
  function removeTableFromCanvas(tableId: string) {
    setQueryState(produce(state => {
      // 移除表
      state.tables = state.tables.filter(t => t.id !== tableId);
      // 移除相关的选中列
      state.selectedColumns = state.selectedColumns.filter(c => c.tableId !== tableId);
      // 移除相关的 JOIN 条件
      state.joinConditions = state.joinConditions.filter(c => c.leftTableId !== tableId && c.rightTableId !== tableId);
      // 如果移除的是主表，重置主表为第一个表
      if (state.primaryTableId === tableId) {
        state.primaryTableId = state.tables.length > 0 ? state.tables[0].id : undefined;
      }
    }));
  }

  // 设置主表
  function setPrimaryTable(tableId: string) {
    setQueryState('primaryTableId', tableId);
    setTableContextMenu(null);
  }

  // 关闭表右键菜单
  function closeTableContextMenu() {
    setTableContextMenu(null);
  }

  // 切换列选择
  function toggleColumnSelection(tableId: string, columnName: string) {
    const table = queryState.tables.find(t => t.id === tableId);
    if (!table) return;

    const existingColumn = queryState.selectedColumns.find(
      c => c.tableId === tableId && c.columnName === columnName
    );

    if (existingColumn) {
      // 移除列
      setQueryState('selectedColumns', prev => prev.filter(c => c.id !== existingColumn.id));
    } else {
      // 添加列
      const newColumn: SelectedColumn = {
        id: generateId(),
        tableId,
        columnName,
        alias: '',
        aggregation: '',
        isGroupBy: false,
      };
      setQueryState('selectedColumns', prev => [...prev, newColumn]);
    }
  }

  // 更新选中列的属性
  function updateSelectedColumn(columnId: string, updates: Partial<SelectedColumn>) {
    setQueryState('selectedColumns', col => col.id === columnId, updates);
  }

  // 添加 WHERE 条件
  function addWhereCondition() {
    const newCondition: WhereCondition = {
      id: generateId(),
      leftOperand: '',
      operator: '=',
      rightOperand: '',
      logicalOperator: 'AND',
    };
    setQueryState('whereConditions', prev => [...prev, newCondition]);
  }

  // 更新 WHERE 条件
  function updateWhereCondition(conditionId: string, updates: Partial<WhereCondition>) {
    setQueryState('whereConditions', cond => cond.id === conditionId, updates);
  }

  // 移除 WHERE 条件
  function removeWhereCondition(conditionId: string) {
    setQueryState('whereConditions', prev => prev.filter(c => c.id !== conditionId));
  }

  // 更新表的 JOIN 类型
  function updateTableJoinType(tableId: string, joinType: JoinType) {
    setQueryState('tables', t => t.id === tableId, 'joinType', joinType);
  }

  // 更新 JOIN 条件
  function updateJoinCondition(conditionId: string, updates: Partial<JoinCondition>) {
    setQueryState('joinConditions', c => c.id === conditionId, updates);
  }

  // 添加排序列
  function addSortColumn() {
    const newSort: SortColumn = {
      id: generateId(),
      column: '',
      direction: 'ASC',
    };
    setQueryState('sortColumns', prev => [...prev, newSort]);
  }

  // 更新排序列
  function updateSortColumn(sortId: string, updates: Partial<SortColumn>) {
    setQueryState('sortColumns', sort => sort.id === sortId, updates);
  }

  // 移除排序列
  function removeSortColumn(sortId: string) {
    setQueryState('sortColumns', prev => prev.filter(s => s.id !== sortId));
  }

  // 删除 JOIN 条件
  function removeJoinCondition(conditionId: string) {
    setQueryState('joinConditions', prev => prev.filter(c => c.id !== conditionId));
  }

  // ================== 拖拽排序功能 ==================

  // 通用的数组重排序函数
  function reorderArray<T extends { id: string }>(items: T[], fromId: string, toId: string): T[] {
    const fromIndex = items.findIndex(item => item.id === fromId);
    const toIndex = items.findIndex(item => item.id === toId);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return items;

    const newItems = [...items];
    const [removed] = newItems.splice(fromIndex, 1);
    newItems.splice(toIndex, 0, removed);
    return newItems;
  }

  // 重排序选中列
  function reorderSelectedColumns(fromId: string, toId: string) {
    setQueryState('selectedColumns', prev => reorderArray(prev, fromId, toId));
  }

  // 重排序 WHERE 条件
  function reorderWhereConditions(fromId: string, toId: string) {
    setQueryState('whereConditions', prev => reorderArray(prev, fromId, toId));
  }

  // 重排序排序列
  function reorderSortColumns(fromId: string, toId: string) {
    setQueryState('sortColumns', prev => reorderArray(prev, fromId, toId));
  }

  // 重排序表（影响 JOIN 顺序）
  function reorderTables(fromId: string, toId: string) {
    setQueryState('tables', prev => reorderArray(prev, fromId, toId));
  }

  // 拖拽排序处理函数
  function handleSortDragStart(type: 'column' | 'where' | 'sort' | 'table', id: string, e: DragEvent) {
    setDragSortItem({ type, id });
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }

  function handleSortDragOver(id: string, e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
    setDragOverItem(id);
  }

  function handleSortDragLeave() {
    setDragOverItem(null);
  }

  function handleSortDrop(toId: string, e: DragEvent) {
    e.preventDefault();
    const dragItem = dragSortItem();
    if (!dragItem) return;

    const fromId = dragItem.id;

    switch (dragItem.type) {
      case 'column':
        reorderSelectedColumns(fromId, toId);
        break;
      case 'where':
        reorderWhereConditions(fromId, toId);
        break;
      case 'sort':
        reorderSortColumns(fromId, toId);
        break;
      case 'table':
        reorderTables(fromId, toId);
        break;
    }

    setDragSortItem(null);
    setDragOverItem(null);
  }

  function handleSortDragEnd() {
    setDragSortItem(null);
    setDragOverItem(null);
  }

  // 通过拖拽列创建 JOIN
  function handleColumnDragStart(tableId: string, columnName: string) {
    const table = queryState.tables.find(t => t.id === tableId);
    if (table) {
      setJoinLineStart({ tableId, column: `${table.alias}.${columnName}` });
    }
  }

  function handleColumnDragEnd(targetTableId: string, targetColumnName: string) {
    const start = joinLineStart();
    if (!start || start.tableId === targetTableId) {
      setJoinLineStart(null);
      return;
    }

    const sourceTable = queryState.tables.find(t => t.id === start.tableId);
    const targetTable = queryState.tables.find(t => t.id === targetTableId);

    if (!sourceTable || !targetTable) {
      setJoinLineStart(null);
      return;
    }

    // 创建新的 JOIN 条件
    const newCondition: JoinCondition = {
      id: generateId(),
      leftTableId: start.tableId,
      leftColumn: start.column,
      rightTableId: targetTableId,
      rightColumn: `${targetTable.alias}.${targetColumnName}`,
      operator: '=',
    };

    setQueryState('joinConditions', prev => [...prev, newCondition]);

    // 如果目标表还没有 joinType，设置默认值
    if (!targetTable.joinType) {
      updateTableJoinType(targetTableId, 'INNER');
    }

    setJoinLineStart(null);
  }

  function cancelJoinDrag() {
    setJoinLineStart(null);
  }

  // 屏幕坐标转画布坐标
  function screenToCanvas(screenX: number, screenY: number): { x: number; y: number } {
    const canvas = canvasRef();
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (screenX - rect.left - panOffset().x) / scale(),
      y: (screenY - rect.top - panOffset().y) / scale(),
    };
  }

  // 处理画布表拖动
  function handleTableMouseDown(e: MouseEvent, tableId: string) {
    if ((e.target as HTMLElement).closest('.column-item')) return;

    e.preventDefault();
    e.stopPropagation();
    setDraggingTableId(tableId);
    setSelectedTableId(tableId);

    const table = queryState.tables.find(t => t.id === tableId);
    if (table) {
      const canvasPos = screenToCanvas(e.clientX, e.clientY);
      setDragOffset({
        x: canvasPos.x - table.position.x,
        y: canvasPos.y - table.position.y,
      });
    }
  }

  // 处理画布平移开始（中键或空白区域左键）
  function handleCanvasMouseDown(e: MouseEvent) {
    // 关闭所有右键菜单
    setTableContextMenu(null);
    setJoinContextMenu(null);

    // 中键拖拽平移
    if (e.button === 1) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset().x, y: e.clientY - panOffset().y });
      return;
    }
    // 左键点击空白区域也可以平移
    // 检查是否点击在画布背景上（排除表卡片和连接线）
    const target = e.target as HTMLElement;
    const isCanvas = target === canvasRef();
    const isTransformLayer = target.parentElement === canvasRef();
    const isClickOnTable = target.closest('.canvas-table');

    if (e.button === 0 && (isCanvas || isTransformLayer) && !isClickOnTable) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffset().x, y: e.clientY - panOffset().y });
    }
  }

  function handleCanvasMouseMove(e: MouseEvent) {
    // 处理画布平移
    if (isPanning()) {
      setPanOffset({
        x: e.clientX - panStart().x,
        y: e.clientY - panStart().y,
      });
      return;
    }

    // 处理表拖动
    const tableId = draggingTableId();
    if (!tableId) return;

    const canvasPos = screenToCanvas(e.clientX, e.clientY);
    setQueryState('tables', t => t.id === tableId, 'position', {
      x: canvasPos.x - dragOffset().x,
      y: canvasPos.y - dragOffset().y
    });
  }

  function handleCanvasMouseUp() {
    setDraggingTableId(null);
    setIsPanning(false);
  }

  // 处理滚轮缩放
  function handleCanvasWheel(e: WheelEvent) {
    e.preventDefault();

    const canvas = canvasRef();
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 计算缩放
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(Math.max(scale() * delta, 0.1), 3);  // 限制缩放范围 0.1x - 3x

    // 以鼠标位置为中心缩放
    const scaleRatio = newScale / scale();
    const newPanX = mouseX - (mouseX - panOffset().x) * scaleRatio;
    const newPanY = mouseY - (mouseY - panOffset().y) * scaleRatio;

    setScale(newScale);
    setPanOffset({ x: newPanX, y: newPanY });
  }

  // 重置视图
  function resetView() {
    setScale(1);
    setPanOffset({ x: 0, y: 0 });
  }

  // 适应所有内容
  function fitToContent() {
    if (queryState.tables.length === 0) {
      resetView();
      return;
    }

    const canvas = canvasRef();
    if (!canvas) return;

    // 计算所有表的边界
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const table of queryState.tables) {
      minX = Math.min(minX, table.position.x);
      minY = Math.min(minY, table.position.y);
      maxX = Math.max(maxX, table.position.x + 200);  // 表宽度
      maxY = Math.max(maxY, table.position.y + 250);  // 表估计高度
    }

    const contentWidth = maxX - minX + 100;  // 加点边距
    const contentHeight = maxY - minY + 100;
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;

    const newScale = Math.min(canvasWidth / contentWidth, canvasHeight / contentHeight, 1);
    const newPanX = (canvasWidth - contentWidth * newScale) / 2 - minX * newScale + 50;
    const newPanY = (canvasHeight - contentHeight * newScale) / 2 - minY * newScale + 50;

    setScale(newScale);
    setPanOffset({ x: newPanX, y: newPanY });
  }

  // 生成 SQL
  const generatedSql = createMemo(() => {
    const { tables, selectedColumns, whereConditions, joinConditions, sortColumns, distinct, limit } = queryState;

    if (tables.length === 0) return '';

    // 确定主表（优先使用设置的主表，否则用第一个表）
    const primaryTableIdToUse = queryState.primaryTableId || tables[0]?.id;
    const primaryTable = tables.find(t => t.id === primaryTableIdToUse) || tables[0];

    if (!primaryTable) return '';

    // 使用 BFS 遍历从主表出发可达的所有表
    // 构建邻接表（双向图）- 基于 joinConditions
    const adjacency = new Map<string, Set<string>>();
    for (const t of tables) {
      adjacency.set(t.id, new Set());
    }
    for (const cond of joinConditions) {
      adjacency.get(cond.leftTableId)?.add(cond.rightTableId);
      adjacency.get(cond.rightTableId)?.add(cond.leftTableId);
    }

    // BFS 遍历，获取与主表连接的所有表（按添加顺序）
    const visited = new Set<string>();
    const connectedTables: CanvasTable[] = [];
    const queue: string[] = [primaryTable.id];
    visited.add(primaryTable.id);

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const neighbors = adjacency.get(currentId) || new Set();

      for (const neighborId of neighbors) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          const table = tables.find(t => t.id === neighborId);
          if (table) {
            connectedTables.push(table);
            queue.push(neighborId);
          }
        }
      }
    }

    // SELECT 子句（只包含主表及其连接的表的列）
    let selectClause = 'SELECT';
    if (distinct) selectClause += ' DISTINCT';

    // 过滤出属于有效表的列
    const validSelectedColumns = selectedColumns.filter(col => visited.has(col.tableId));

    if (validSelectedColumns.length === 0) {
      selectClause += ' *';
    } else {
      const columnExpressions = validSelectedColumns.map(col => {
        const table = tables.find(t => t.id === col.tableId);
        if (!table) return '';

        let expr = col.expression || `${table.alias}.${col.columnName}`;

        if (col.aggregation) {
          expr = `${col.aggregation}(${expr})`;
        }

        if (col.alias) {
          expr += ` AS ${col.alias}`;
        }

        return expr;
      }).filter(Boolean);

      selectClause += '\n  ' + columnExpressions.join(',\n  ');
    }

    // FROM 子句
    let fromClause = `FROM ${primaryTable.schema}.${primaryTable.name} ${primaryTable.alias}`;

    // JOIN 子句（按 tables 数组顺序生成，跳过主表、未连接的表和没有 ON 条件的表）
    // 记录已经出现过的表（包括主表）
    const appearedTables = new Set<string>([primaryTable.id]);

    for (const table of tables) {
      // 跳过主表
      if (table.id === primaryTable.id) continue;

      // 跳过未连接的表
      if (!visited.has(table.id)) continue;

      // 先检查这个表是否有有效的 ON 条件（在添加到 appearedTables 之前检查）
      // 临时添加当前表来检查条件
      const tempAppearedTables = new Set(appearedTables);
      tempAppearedTables.add(table.id);
      
      const tableConditions = joinConditions.filter(c => {
        // 条件必须涉及当前表
        const involvesCurrentTable = c.leftTableId === table.id || c.rightTableId === table.id;
        if (!involvesCurrentTable) return false;

        // 条件涉及的两个表都必须在已出现的表集合中（包括当前表）
        return tempAppearedTables.has(c.leftTableId) && tempAppearedTables.has(c.rightTableId);
      });

      // 如果没有 ON 条件，跳过这个表
      if (tableConditions.length === 0) continue;

      // 有条件的表才生成 JOIN
      const joinType = table.joinType || 'INNER';
      const joinKeyword = joinType === 'INNER' ? 'JOIN' : `${joinType} JOIN`;
      fromClause += `\n${joinKeyword} ${table.schema}.${table.name} ${table.alias}`;

      // 添加到已出现的表集合
      appearedTables.add(table.id);

      // 生成 ON 子句
      const conditionStrs = tableConditions.map(c => `${c.leftColumn} ${c.operator} ${c.rightColumn}`);
      fromClause += ` ON ${conditionStrs.join(' AND ')}`;
    }

    // WHERE 子句
    let whereClause = '';
    if (whereConditions.length > 0) {
      const conditions = whereConditions.map((cond, index) => {
        let expr = '';
        if (index > 0) {
          expr = `${cond.logicalOperator} `;
        }

        if (cond.operator === 'IS NULL' || cond.operator === 'IS NOT NULL') {
          expr += `${cond.leftOperand} ${cond.operator}`;
        } else {
          expr += `${cond.leftOperand} ${cond.operator} ${cond.rightOperand}`;
        }
        return expr;
      });
      whereClause = `WHERE ${conditions.join('\n  ')}`;
    }

    // GROUP BY 子句（只包含有效表的列）
    let groupByClause = '';
    const groupByColumns = validSelectedColumns.filter(c => c.isGroupBy);
    if (groupByColumns.length > 0) {
      const groupExprs = groupByColumns.map(col => {
        const table = tables.find(t => t.id === col.tableId);
        return table ? `${table.alias}.${col.columnName}` : '';
      }).filter(Boolean);
      groupByClause = `GROUP BY ${groupExprs.join(', ')}`;
    }

    // ORDER BY 子句
    let orderByClause = '';
    if (sortColumns.length > 0) {
      const sortExprs = sortColumns
        .filter(s => s.column)
        .map(s => `${s.column} ${s.direction}`);
      if (sortExprs.length > 0) {
        orderByClause = `ORDER BY ${sortExprs.join(', ')}`;
      }
    }

    // LIMIT 子句
    let limitClause = '';
    if (limit && limit > 0) {
      limitClause = `LIMIT ${limit}`;
    }

    // 组装完整 SQL
    const parts = [selectClause, fromClause, whereClause, groupByClause, orderByClause, limitClause]
      .filter(Boolean);

    return parts.join('\n');
  });

  // 获取所有可用的列（用于下拉选择）
  const allAvailableColumns = createMemo(() => {
    const columns: { label: string; value: string }[] = [];
    for (const table of queryState.tables) {
      for (const col of table.columns) {
        columns.push({
          label: `${table.alias}.${col.name}`,
          value: `${table.alias}.${col.name}`,
        });
      }
    }
    return columns;
  });

  // 执行查询
  function executeQuery() {
    const sql = generatedSql();
    if (sql && props.onExecuteQuery) {
      props.onExecuteQuery(sql);
    }
  }

  // 计算 JOIN 连接线（每个 ON 条件都画一条线）
  // 连线方向：从顺序靠前的表指向顺序靠后的表
  const joinLines = createMemo(() => {
    const lines: {
      x1: number; y1: number;
      x2: number; y2: number;
      condition: JoinCondition;
      sourceTable: CanvasTable;  // 顺序靠前的表
      targetTable: CanvasTable;  // 顺序靠后的表（被 JOIN 进来的）
      sourceColumnName: string;
      targetColumnName: string;
    }[] = [];

    const TABLE_WIDTH = 200;
    const HEADER_HEIGHT = 40;  // 表头高度
    const COLUMN_HEIGHT = 28;  // 每列高度

    // 获取表的顺序索引（用于比较）
    const getTableOrderIndex = (tableId: string): number => {
      const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
      if (tableId === primaryId) return -1;  // 主表排最前
      return queryState.tables.findIndex(t => t.id === tableId);
    };

    for (const cond of queryState.joinConditions) {
      const table1 = queryState.tables.find(t => t.id === cond.leftTableId);
      const table2 = queryState.tables.find(t => t.id === cond.rightTableId);

      if (table1 && table2) {
        // 根据表的顺序确定 source（靠前）和 target（靠后）
        const order1 = getTableOrderIndex(table1.id);
        const order2 = getTableOrderIndex(table2.id);

        const sourceTable = order1 < order2 ? table1 : table2;
        const targetTable = order1 < order2 ? table2 : table1;
        const sourceColumn = order1 < order2 ? cond.leftColumn : cond.rightColumn;
        const targetColumn = order1 < order2 ? cond.rightColumn : cond.leftColumn;

        // 解析列名（格式: alias.column_name）
        const sourceColParts = sourceColumn.split('.');
        const targetColParts = targetColumn.split('.');
        const sourceColName = sourceColParts[sourceColParts.length - 1];
        const targetColName = targetColParts[targetColParts.length - 1];

        // 找到列在表中的索引
        const sourceColIndex = sourceTable.columns.findIndex(c => c.name === sourceColName);
        const targetColIndex = targetTable.columns.findIndex(c => c.name === targetColName);

        // 计算列的 Y 位置（表头 + 列索引 * 列高度 + 列高度的一半）
        const sourceY = sourceTable.position.y + HEADER_HEIGHT +
          (sourceColIndex >= 0 ? sourceColIndex : 0) * COLUMN_HEIGHT + COLUMN_HEIGHT / 2;
        const targetY = targetTable.position.y + HEADER_HEIGHT +
          (targetColIndex >= 0 ? targetColIndex : 0) * COLUMN_HEIGHT + COLUMN_HEIGHT / 2;

        // 计算 X 位置（根据表的相对位置决定从哪边连接）
        const sourceCenterX = sourceTable.position.x + TABLE_WIDTH / 2;
        const targetCenterX = targetTable.position.x + TABLE_WIDTH / 2;

        let sourceX: number, targetX: number;
        if (sourceCenterX < targetCenterX) {
          // source 表在左边，从 source 右边连到 target 左边
          sourceX = sourceTable.position.x + TABLE_WIDTH;
          targetX = targetTable.position.x;
        } else {
          // source 表在右边，从 source 左边连到 target 右边
          sourceX = sourceTable.position.x;
          targetX = targetTable.position.x + TABLE_WIDTH;
        }

        lines.push({
          x1: sourceX, y1: sourceY,
          x2: targetX, y2: targetY,
          condition: cond,
          sourceTable,
          targetTable,
          sourceColumnName: sourceColName,
          targetColumnName: targetColName,
        });
      }
    }

    return lines;
  });

  // 关闭 JOIN 右键菜单
  function closeJoinContextMenu() {
    setJoinContextMenu(null);
  }

  // 获取表的 JOIN 顺序（主表为 0，其他表按 tables 数组顺序，跳过主表）
  function getTableJoinOrder(tableId: string): number {
    const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
    if (tableId === primaryId) return 0;

    let order = 0;
    for (const t of queryState.tables) {
      if (t.id === primaryId) continue;  // 跳过主表
      order++;
      if (t.id === tableId) return order;
    }
    return -1;
  }

  // 获取在指定表之前的所有表的 ID 集合（包括主表和该表之前的表）
  function getTablesBefore(tableId: string): Set<string> {
    const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
    const beforeTables = new Set<string>();

    beforeTables.add(primaryId);  // 主表总是在最前面

    for (const t of queryState.tables) {
      if (t.id === primaryId) continue;  // 跳过主表（已添加）
      if (t.id === tableId) {
        beforeTables.add(t.id);  // 包括自己
        break;
      }
      beforeTables.add(t.id);
    }

    return beforeTables;
  }

  // 渲染表在画布上
  function renderCanvasTable(table: CanvasTable) {
    const isSelected = () => selectedTableId() === table.id;
    const isPrimaryTable = () => {
      const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
      return table.id === primaryId;
    };
    const joinOrder = () => getTableJoinOrder(table.id);

    return (
      <div
        class="canvas-table"
        style={{
          position: 'absolute',
          left: `${table.position.x}px`,
          top: `${table.position.y}px`,
          width: '200px',
          "background-color": '#1e293b',
          border: isPrimaryTable()
            ? '2px solid #f59e0b'
            : isSelected()
              ? '2px solid #3b82f6'
              : '1px solid #475569',
          "border-radius": '8px',
          "box-shadow": isPrimaryTable()
            ? '0 4px 12px rgba(245,158,11,0.3)'
            : '0 4px 12px rgba(0,0,0,0.3)',
          cursor: 'move',
          "user-select": 'none',
          "z-index": isSelected() ? 10 : 1,
          "pointer-events": 'auto',  // 确保在 transform 层中可交互
        }}
        onMouseDown={(e) => handleTableMouseDown(e, table.id)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setJoinContextMenu(null);  // 关闭 JOIN 菜单
          setTableContextMenu({ x: e.clientX, y: e.clientY, tableId: table.id });
        }}
      >
        {/* 表头 */}
        <div style={{
          padding: '8px 10px',
          "background-color": isPrimaryTable() ? '#78350f' : '#334155',
          "border-radius": '7px 7px 0 0',
          display: 'flex',
          "justify-content": 'space-between',
          "align-items": 'center',
          "flex-wrap": 'wrap',
          gap: '4px',
          "font-weight": '600',
          "font-size": '12px',
          color: '#e2e8f0',
        }}>
          <div style={{ display: 'flex', "align-items": 'center', "flex-wrap": 'wrap', gap: '4px', "min-width": 0, flex: 1 }}>
            {/* JOIN 顺序标签 */}
            <span style={{
              "background-color": isPrimaryTable() ? '#f59e0b' : '#3b82f6',
              color: '#0f172a',
              padding: '2px 5px',
              "border-radius": '3px',
              "font-size": '9px',
              "font-weight": '700',
              "flex-shrink": 0,
            }}>
              {isPrimaryTable() ? 'FROM' : `#${joinOrder()}`}
            </span>
            {/* 非主表显示 JOIN 类型 */}
            <Show when={!isPrimaryTable()}>
              {(() => {
                const joinColors: Record<string, string> = {
                  'INNER': '#3b82f6',
                  'LEFT': '#22c55e',
                  'RIGHT': '#f59e0b',
                  'FULL': '#a855f7',
                  'CROSS': '#ef4444',
                };
                const currentJoinType = () => table.joinType || 'INNER';
                return (
                  <span style={{
                    "background-color": joinColors[currentJoinType()],
                    color: '#0f172a',
                    padding: '2px 5px',
                    "border-radius": '3px',
                    "font-size": '9px',
                    "font-weight": '600',
                    "flex-shrink": 0,
                  }}>
                    {currentJoinType()} JOIN
                  </span>
                );
              })()}
            </Show>
            <span
              title={`${table.schema}.${table.name}`}
            >
              {table.name}
              <span style={{ color: '#94a3b8', "margin-left": '3px', "font-weight": 'normal', "font-size": '11px' }}>
                ({table.alias})
              </span>
            </span>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); removeTableFromCanvas(table.id); }}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: '2px 4px',
              "border-radius": '4px',
              "flex-shrink": 0,
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = '#ef4444'}
            onMouseLeave={(e) => e.currentTarget.style.color = '#94a3b8'}
          >
            ✕
          </button>
        </div>

        {/* 列列表 */}
        <div style={{
          "max-height": '200px',
          "overflow-y": 'auto',
          padding: '4px 0',
        }}>
          <For each={table.columns}>
            {(col) => {
              // 使用函数形式以确保响应式更新
              const isColumnSelected = () => queryState.selectedColumns.some(
                c => c.tableId === table.id && c.columnName === col.name
              );

              // 是否是 JOIN 拖拽的起点
              const isJoinSource = () => {
                const start = joinLineStart();
                return start && start.tableId === table.id && start.column === `${table.alias}.${col.name}`;
              };

              // 是否可以作为 JOIN 的目标（不同表）
              const isJoinTarget = () => {
                const start = joinLineStart();
                return start && start.tableId !== table.id;
              };

              return (
                <div
                  class="column-item"
                  draggable={true}
                  onDragStart={(e) => {
                    e.stopPropagation();
                    handleColumnDragStart(table.id, col.name);
                    // 设置拖拽效果
                    e.dataTransfer?.setData('text/plain', `${table.alias}.${col.name}`);
                  }}
                  onDragEnd={() => cancelJoinDrag()}
                  onDragOver={(e) => {
                    if (isJoinTarget()) {
                      e.preventDefault();
                      e.currentTarget.style.backgroundColor = 'rgba(34, 197, 94, 0.3)';
                    }
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isColumnSelected() ? 'rgba(59, 130, 246, 0.1)' : 'transparent';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isJoinTarget()) {
                      handleColumnDragEnd(table.id, col.name);
                    }
                    e.currentTarget.style.backgroundColor = isColumnSelected() ? 'rgba(59, 130, 246, 0.1)' : 'transparent';
                  }}
                  onClick={(e) => { e.stopPropagation(); toggleColumnSelection(table.id, col.name); }}
                  style={{
                    padding: '6px 12px',
                    "font-size": '12px',
                    color: isJoinSource() ? '#22c55e' : (isColumnSelected() ? '#3b82f6' : '#cbd5e1'),
                    "background-color": isJoinSource() ? 'rgba(34, 197, 94, 0.2)' : (isColumnSelected() ? 'rgba(59, 130, 246, 0.1)' : 'transparent'),
                    cursor: 'grab',
                    display: 'flex',
                    "align-items": 'center',
                    gap: '6px',
                    transition: 'background-color 0.15s',
                    border: isJoinTarget() ? '1px dashed #22c55e' : '1px solid transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isColumnSelected() && !isJoinSource()) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.05)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isColumnSelected() && !isJoinSource()) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <span style={{
                    width: '16px',
                    height: '16px',
                    display: 'flex',
                    "align-items": 'center',
                    "justify-content": 'center',
                    "border-radius": '3px',
                    border: '1px solid #475569',
                    "font-size": '10px',
                    "background-color": isColumnSelected() ? '#3b82f6' : 'transparent',
                    color: isColumnSelected() ? '#fff' : 'transparent',
                  }}>
                    ✓
                  </span>
                  <span style={{ flex: 1 }}>{col.name}</span>
                  <span style={{ color: '#64748b', "font-size": '10px' }}>{col.dataType}</span>
                  {/* JOIN 拖拽提示图标 */}
                  <span style={{
                    color: '#64748b',
                    "font-size": '10px',
                    opacity: 0.5,
                  }} title="拖拽到其他表的列创建 JOIN">
                    🔗
                  </span>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      "flex-direction": 'column',
      height: '100%',
      "background-color": '#0f172a',
      color: '#e2e8f0',
      "font-family": "'JetBrains Mono', 'Fira Code', monospace",
    }}>
      {/* 顶部工具栏 */}
      <div style={{
        padding: '12px 16px',
        "border-bottom": '1px solid #334155',
        display: 'flex',
        "align-items": 'center',
        gap: '12px',
        "background-color": '#1e293b',
      }}>
        <span style={{ "font-size": '16px', "font-weight": '600' }}>🔧 Visual Query Builder</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={executeQuery}
          disabled={queryState.tables.length === 0}
          style={{
            padding: '8px 20px',
            "background-color": queryState.tables.length > 0 ? '#10b981' : '#475569',
            color: '#fff',
            border: 'none',
            "border-radius": '6px',
            cursor: queryState.tables.length > 0 ? 'pointer' : 'not-allowed',
            "font-weight": '500',
            display: 'flex',
            "align-items": 'center',
            gap: '6px',
          }}
        >
          <span>▶</span> 执行查询
        </button>
        <Show when={props.onClose}>
          <button
            onClick={props.onClose}
            style={{
              padding: '8px 16px',
              "background-color": '#475569',
              color: '#fff',
              border: 'none',
              "border-radius": '6px',
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        </Show>
      </div>

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：可用表列表 */}
        <div style={{
          width: '220px',
          "border-right": '1px solid #334155',
          display: 'flex',
          "flex-direction": 'column',
          "background-color": '#0f172a',
        }}>
          <div style={{
            padding: '12px',
            "border-bottom": '1px solid #334155',
            "font-size": '13px',
            "font-weight": '600',
            color: '#94a3b8',
          }}>
            📋 可用表 {loadingTables() && '(加载中...)'}
          </div>
          <div style={{ flex: 1, "overflow-y": 'auto', padding: '8px' }}>
            <For each={availableTables}>
              {(schemaItem) => (
                <div style={{ "margin-bottom": '4px' }}>
                  <div
                    onClick={() => toggleSchema(schemaItem.schema)}
                    style={{
                      padding: '6px 8px',
                      cursor: 'pointer',
                      display: 'flex',
                      "align-items": 'center',
                      gap: '6px',
                      "border-radius": '4px',
                      "font-size": '12px',
                      color: '#94a3b8',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1e293b'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <span style={{
                      transition: 'transform 0.2s',
                      transform: expandedSchemas().has(schemaItem.schema) ? 'rotate(90deg)' : 'rotate(0deg)',
                    }}>▶</span>
                    📁 {schemaItem.schema}
                    <span style={{ color: '#64748b', "font-size": '10px' }}>({schemaItem.tables.length})</span>
                  </div>
                  <Show when={expandedSchemas().has(schemaItem.schema)}>
                    <div style={{ "padding-left": '20px' }}>
                      <For each={schemaItem.tables}>
                        {(tableName) => (
                          <div
                            draggable={true}
                            onDragStart={(e) => handleTableDragStart(e, schemaItem.schema, tableName)}
                            style={{
                              padding: '5px 8px',
                              cursor: 'grab',
                              "font-size": '12px',
                              color: '#cbd5e1',
                              "border-radius": '4px',
                              display: 'flex',
                              "align-items": 'center',
                              gap: '6px',
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#1e293b'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            📊 {tableName}
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>

        {/* 中间：画布 */}
        <div style={{
          flex: 1,
          display: 'flex',
          "flex-direction": 'column',
          overflow: 'hidden',
        }}>
          {/* 缩放控制栏 */}
          <div style={{
            padding: '6px 12px',
            "background-color": '#1e293b',
            "border-bottom": '1px solid #334155',
            display: 'flex',
            "align-items": 'center',
            gap: '8px',
            "font-size": '12px',
          }}>
            <span style={{ color: '#64748b' }}>缩放:</span>
            <button
              onClick={() => setScale(s => Math.max(0.1, s - 0.1))}
              style={{
                padding: '4px 10px',
                "background-color": '#334155',
                color: '#e2e8f0',
                border: 'none',
                "border-radius": '4px',
                cursor: 'pointer',
              }}
            >
              −
            </button>
            <span style={{ color: '#94a3b8', "min-width": '50px', "text-align": 'center' }}>
              {Math.round(scale() * 100)}%
            </span>
            <button
              onClick={() => setScale(s => Math.min(3, s + 0.1))}
              style={{
                padding: '4px 10px',
                "background-color": '#334155',
                color: '#e2e8f0',
                border: 'none',
                "border-radius": '4px',
                cursor: 'pointer',
              }}
            >
              +
            </button>
            <button
              onClick={resetView}
              style={{
                padding: '4px 10px',
                "background-color": '#334155',
                color: '#e2e8f0',
                border: 'none',
                "border-radius": '4px',
                cursor: 'pointer',
              }}
            >
              重置
            </button>
            <button
              onClick={fitToContent}
              style={{
                padding: '4px 10px',
                "background-color": '#334155',
                color: '#e2e8f0',
                border: 'none',
                "border-radius": '4px',
                cursor: 'pointer',
              }}
            >
              适应内容
            </button>
            <span style={{ color: '#64748b', "margin-left": 'auto', "font-size": '11px' }}>
              💡 滚轮缩放 | 拖拽空白区域平移
            </span>
          </div>

          <div
            ref={setCanvasRef}
            onDrop={handleCanvasDrop}
            onDragOver={(e) => e.preventDefault()}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onMouseLeave={handleCanvasMouseUp}
            onWheel={handleCanvasWheel}
            style={{
              flex: 1,
              position: 'relative',
              overflow: 'hidden',
              "background-color": '#0f172a',
              "background-image": `radial-gradient(circle, #334155 ${1 * scale()}px, transparent ${1 * scale()}px)`,
              "background-size": `${20 * scale()}px ${20 * scale()}px`,
              "background-position": `${panOffset().x}px ${panOffset().y}px`,
              "min-height": '300px',
              cursor: isPanning() ? 'grabbing' : (draggingTableId() ? 'move' : 'default'),
              "user-select": 'none',  // 禁止文字选择，防止干扰拖拽
            }}
          >
            {/* 可变换的内容层 */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `translate(${panOffset().x}px, ${panOffset().y}px) scale(${scale()})`,
              "transform-origin": '0 0',
              "pointer-events": 'none',
            }}>
              {/* JOIN 连接线 */}
              <svg style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '10000px',
                height: '10000px',
                "pointer-events": 'none',  // SVG 背景不捕获事件
                "z-index": 0,
                overflow: 'visible',
              }}>
                {/* 箭头标记定义 */}
                <defs>
                  <marker id="arrow-inner" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
                  </marker>
                  <marker id="arrow-left" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="#22c55e" />
                  </marker>
                  <marker id="arrow-right" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="#f59e0b" />
                  </marker>
                  <marker id="arrow-full" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="#a855f7" />
                  </marker>
                  <marker id="arrow-cross" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                    <path d="M0,0 L0,6 L9,3 z" fill="#ef4444" />
                  </marker>
                </defs>

                <For each={joinLines()}>
                  {(line) => {
                    // 根据目标表的 JOIN 类型选择颜色（响应式获取）
                    const joinColors: Record<string, string> = {
                      'INNER': '#3b82f6',
                      'LEFT': '#22c55e',
                      'RIGHT': '#f59e0b',
                      'FULL': '#a855f7',
                      'CROSS': '#ef4444',
                    };
                    // 响应式获取目标表（顺序靠后的表）的 joinType
                    const getTargetTableJoinType = () => {
                      const targetTable = queryState.tables.find(t => t.id === line.targetTable.id);
                      return targetTable?.joinType || 'INNER';
                    };
                    const lineColor = () => joinColors[getTargetTableJoinType()] || '#3b82f6';
                    const arrowId = () => `arrow-${getTargetTableJoinType().toLowerCase()}`;

                    // 计算连线中点位置（用于显示 JOIN 类型标签）
                    const midX = () => (line.x1 + line.x2) / 2;
                    const midY = () => (line.y1 + line.y2) / 2;

                    return (
                      <g style={{ cursor: 'pointer', "pointer-events": 'auto' }}>
                        {/* 透明的粗线用于更容易点击 */}
                        <line
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          stroke="transparent"
                          stroke-width="12"
                          style={{ "pointer-events": 'stroke' }}
                          onContextMenu={(e: MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setTableContextMenu(null);  // 关闭表菜单
                            setJoinContextMenu({ x: e.clientX, y: e.clientY, joinId: line.condition.id });
                          }}
                        />
                        {/* 可见的连接线（带箭头） */}
                        <line
                          x1={line.x1}
                          y1={line.y1}
                          x2={line.x2}
                          y2={line.y2}
                          stroke={lineColor()}
                          stroke-width="2"
                          marker-end={`url(#${arrowId()})`}
                          style={{ "pointer-events": 'none' }}
                        />
                        {/* 起点圆圈 */}
                        <circle
                          cx={line.x1}
                          cy={line.y1}
                          r="4"
                          fill={lineColor()}
                          style={{ "pointer-events": 'none' }}
                        />
                        {/* JOIN 类型标签（可右键点击） */}
                        <g
                          style={{ cursor: 'pointer', "pointer-events": 'auto' }}
                          onContextMenu={(e: MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setTableContextMenu(null);
                            setJoinContextMenu({ x: e.clientX, y: e.clientY, joinId: line.condition.id });
                          }}
                        >
                          <rect
                            x={midX() - 25}
                            y={midY() - 9}
                            width="50"
                            height="18"
                            rx="4"
                            fill="#0f172a"
                            stroke={lineColor()}
                            stroke-width="1"
                          />
                          <text
                            x={midX()}
                            y={midY() + 4}
                            fill={lineColor()}
                            font-size="10"
                            font-weight="600"
                            text-anchor="middle"
                          >
                            {getTargetTableJoinType()}
                          </text>
                        </g>
                      </g>
                    );
                  }}
                </For>
              </svg>

              {/* 画布上的表 */}
              <For each={queryState.tables}>
                {(table) => renderCanvasTable(table)}
              </For>
            </div>

            {/* 空状态提示（不受缩放影响） */}
            <Show when={queryState.tables.length === 0}>
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                "text-align": 'center',
                color: '#64748b',
                "z-index": 5,
              }}>
                <div style={{ "font-size": '48px', "margin-bottom": '16px' }}>📥</div>
                <div style={{ "font-size": '14px' }}>从左侧拖拽表到这里开始构建查询</div>
              </div>
            </Show>
          </div>

          {/* SQL 预览区域 */}
          <div style={{
            height: '150px',
            "border-top": '1px solid #334155',
            "background-color": '#1e293b',
            display: 'flex',
            "flex-direction": 'column',
          }}>
            <div style={{
              padding: '8px 12px',
              "border-bottom": '1px solid #334155',
              "font-size": '12px',
              "font-weight": '600',
              color: '#94a3b8',
              display: 'flex',
              "align-items": 'center',
              gap: '8px',
            }}>
              📝 生成的 SQL
              <button
                onClick={() => navigator.clipboard.writeText(generatedSql())}
                disabled={!generatedSql()}
                style={{
                  "margin-left": 'auto',
                  padding: '4px 12px',
                  "background-color": '#334155',
                  color: '#94a3b8',
                  border: 'none',
                  "border-radius": '4px',
                  cursor: generatedSql() ? 'pointer' : 'not-allowed',
                  "font-size": '11px',
                }}
              >
                📋 复制
              </button>
            </div>
            <pre style={{
              flex: 1,
              margin: 0,
              padding: '12px',
              "overflow-y": 'auto',
              "font-size": '12px',
              color: '#10b981',
              "white-space": 'pre-wrap',
              "word-break": 'break-all',
            }}>
              {generatedSql() || '-- 暂无 SQL，请添加表并选择列'}
            </pre>
          </div>
        </div>

        {/* 右侧：查询配置面板 */}
        <div style={{
          width: '320px',
          "border-left": '1px solid #334155',
          display: 'flex',
          "flex-direction": 'column',
          "background-color": '#0f172a',
        }}>
          {/* 选项卡 */}
          <div style={{
            display: 'flex',
            "border-bottom": '1px solid #334155',
          }}>
            <For each={[
              { key: 'columns' as const, label: '列', icon: '📎' },
              { key: 'where' as const, label: 'WHERE', icon: '🔍' },
              { key: 'joins' as const, label: 'JOIN', icon: '🔗' },
              { key: 'sorting' as const, label: '排序', icon: '↕️' },
              { key: 'misc' as const, label: '其他', icon: '⚙️' },
            ]}>
              {(tab) => (
                <button
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    flex: 1,
                    padding: '10px 8px',
                    border: 'none',
                    background: activeTab() === tab.key ? '#1e293b' : 'transparent',
                    color: activeTab() === tab.key ? '#3b82f6' : '#94a3b8',
                    cursor: 'pointer',
                    "font-size": '11px',
                    "font-weight": '500',
                    "border-bottom": activeTab() === tab.key ? '2px solid #3b82f6' : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.icon} {tab.label}
                </button>
              )}
            </For>
          </div>

          {/* 选项卡内容 */}
          <div style={{ flex: 1, "overflow-y": 'auto', padding: '12px' }}>
            {/* Columns 选项卡 */}
            <Show when={activeTab() === 'columns'}>
              <div style={{ "font-size": '12px' }}>
                <div style={{
                  display: 'flex',
                  "justify-content": 'space-between',
                  "align-items": 'center',
                  "margin-bottom": '12px',
                }}>
                  <span style={{ color: '#94a3b8', "font-weight": '600' }}>选中的列</span>
                  <span style={{ color: '#64748b' }}>{queryState.selectedColumns.length} 列</span>
                </div>

                <Show when={queryState.selectedColumns.length === 0}>
                  <div style={{
                    padding: '20px',
                    "text-align": 'center',
                    color: '#64748b',
                    "background-color": '#1e293b',
                    "border-radius": '6px',
                  }}>
                    点击表中的列来选择
                  </div>
                </Show>

                <For each={queryState.selectedColumns}>
                  {(col) => {
                    const table = queryState.tables.find(t => t.id === col.tableId);
                    const isDragOver = () => dragOverItem() === col.id && dragSortItem()?.type === 'column';
                    return (
                      <div
                        draggable={true}
                        onDragStart={(e) => handleSortDragStart('column', col.id, e)}
                        onDragOver={(e) => handleSortDragOver(col.id, e)}
                        onDragLeave={handleSortDragLeave}
                        onDrop={(e) => handleSortDrop(col.id, e)}
                        onDragEnd={handleSortDragEnd}
                        style={{
                          padding: '10px',
                          "background-color": isDragOver() ? '#334155' : '#1e293b',
                          "border-radius": '6px',
                          "margin-bottom": '8px',
                          cursor: 'grab',
                          border: isDragOver() ? '2px dashed #3b82f6' : '2px solid transparent',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{
                          display: 'flex',
                          "justify-content": 'space-between',
                          "align-items": 'center',
                          "margin-bottom": '8px',
                        }}>
                          <span style={{ color: '#64748b', cursor: 'grab', "margin-right": '8px' }}>⋮⋮</span>
                          <span style={{ color: '#cbd5e1', flex: 1 }}>
                            {table?.alias}.{col.columnName}
                          </span>
                          <button
                            onClick={() => setQueryState('selectedColumns', prev => prev.filter(c => c.id !== col.id))}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: '2px 6px',
                            }}
                          >
                            ✕
                          </button>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', "flex-wrap": 'wrap' }}>
                          <input
                            type="text"
                            placeholder="别名"
                            value={col.alias}
                            onInput={(e) => updateSelectedColumn(col.id, { alias: e.currentTarget.value })}
                            style={{
                              flex: 1,
                              "min-width": '80px',
                              padding: '4px 8px',
                              "background-color": '#0f172a',
                              border: '1px solid #334155',
                              "border-radius": '4px',
                              color: '#e2e8f0',
                              "font-size": '11px',
                            }}
                          />
                          <select
                            value={col.aggregation || ''}
                            onChange={(e) => updateSelectedColumn(col.id, {
                              aggregation: e.currentTarget.value as SelectedColumn['aggregation']
                            })}
                            style={{
                              padding: '4px 8px',
                              "background-color": '#0f172a',
                              border: '1px solid #334155',
                              "border-radius": '4px',
                              color: '#e2e8f0',
                              "font-size": '11px',
                            }}
                          >
                            <option value="">无聚合</option>
                            <option value="COUNT">COUNT</option>
                            <option value="SUM">SUM</option>
                            <option value="AVG">AVG</option>
                            <option value="MAX">MAX</option>
                            <option value="MIN">MIN</option>
                          </select>
                        </div>

                        <label style={{
                          display: 'flex',
                          "align-items": 'center',
                          gap: '6px',
                          "margin-top": '8px',
                          color: '#94a3b8',
                          "font-size": '11px',
                          cursor: 'pointer',
                        }}>
                          <input
                            type="checkbox"
                            checked={col.isGroupBy}
                            onChange={(e) => updateSelectedColumn(col.id, { isGroupBy: e.currentTarget.checked })}
                            style={{ "accent-color": '#3b82f6' }}
                          />
                          GROUP BY 此列
                        </label>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* WHERE 选项卡 */}
            <Show when={activeTab() === 'where'}>
              <div style={{ "font-size": '12px' }}>
                <button
                  onClick={addWhereCondition}
                  style={{
                    width: '100%',
                    padding: '8px',
                    "background-color": '#334155',
                    color: '#e2e8f0',
                    border: 'none',
                    "border-radius": '6px',
                    cursor: 'pointer',
                    "margin-bottom": '12px',
                    display: 'flex',
                    "align-items": 'center',
                    "justify-content": 'center',
                    gap: '6px',
                  }}
                >
                  <span>+</span> 添加条件
                </button>

                <For each={queryState.whereConditions}>
                  {(cond, index) => {
                    const isDragOver = () => dragOverItem() === cond.id && dragSortItem()?.type === 'where';
                    return (
                      <div
                        draggable={true}
                        onDragStart={(e) => handleSortDragStart('where', cond.id, e)}
                        onDragOver={(e) => handleSortDragOver(cond.id, e)}
                        onDragLeave={handleSortDragLeave}
                        onDrop={(e) => handleSortDrop(cond.id, e)}
                        onDragEnd={handleSortDragEnd}
                        style={{
                          padding: '10px',
                          "background-color": isDragOver() ? '#334155' : '#1e293b',
                          "border-radius": '6px',
                          "margin-bottom": '8px',
                          cursor: 'grab',
                          border: isDragOver() ? '2px dashed #3b82f6' : '2px solid transparent',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', "align-items": 'center', gap: '8px', "margin-bottom": index() > 0 ? '8px' : '0' }}>
                          <span style={{ color: '#64748b', cursor: 'grab' }}>⋮⋮</span>
                          <Show when={index() > 0}>
                            <select
                              value={cond.logicalOperator}
                              onChange={(e) => updateWhereCondition(cond.id, {
                                logicalOperator: e.currentTarget.value as 'AND' | 'OR'
                              })}
                              style={{
                                padding: '4px 8px',
                                "background-color": '#0f172a',
                                border: '1px solid #334155',
                                "border-radius": '4px',
                                color: '#e2e8f0',
                                "font-size": '11px',
                              }}
                            >
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          </Show>
                        </div>

                        <div style={{ display: 'flex', gap: '6px', "align-items": 'center', "flex-wrap": 'wrap' }}>
                          <select
                            value={cond.leftOperand}
                            onChange={(e) => updateWhereCondition(cond.id, { leftOperand: e.currentTarget.value })}
                            style={{
                              flex: 1,
                              "min-width": '100px',
                              padding: '4px 8px',
                              "background-color": '#0f172a',
                              border: '1px solid #334155',
                              "border-radius": '4px',
                              color: '#e2e8f0',
                              "font-size": '11px',
                            }}
                          >
                            <option value="">选择列</option>
                            <For each={allAvailableColumns()}>
                              {(col) => <option value={col.value}>{col.label}</option>}
                            </For>
                          </select>

                          <select
                            value={cond.operator}
                            onChange={(e) => updateWhereCondition(cond.id, {
                              operator: e.currentTarget.value as WhereCondition['operator']
                            })}
                            style={{
                              padding: '4px 8px',
                              "background-color": '#0f172a',
                              border: '1px solid #334155',
                              "border-radius": '4px',
                              color: '#e2e8f0',
                              "font-size": '11px',
                            }}
                          >
                            <option value="=">=</option>
                            <option value="!=">!=</option>
                            <option value=">">&gt;</option>
                            <option value="<">&lt;</option>
                            <option value=">=">&gt;=</option>
                            <option value="<=">&lt;=</option>
                            <option value="LIKE">LIKE</option>
                            <option value="IN">IN</option>
                            <option value="IS NULL">IS NULL</option>
                            <option value="IS NOT NULL">IS NOT NULL</option>
                          </select>

                          <Show when={cond.operator !== 'IS NULL' && cond.operator !== 'IS NOT NULL'}>
                            <input
                              type="text"
                              placeholder="值"
                              value={cond.rightOperand}
                              onInput={(e) => updateWhereCondition(cond.id, { rightOperand: e.currentTarget.value })}
                              style={{
                                flex: 1,
                                "min-width": '80px',
                                padding: '4px 8px',
                                "background-color": '#0f172a',
                                border: '1px solid #334155',
                                "border-radius": '4px',
                                color: '#e2e8f0',
                                "font-size": '11px',
                              }}
                            />
                          </Show>

                          <button
                            onClick={() => removeWhereCondition(cond.id)}
                            style={{
                              padding: '4px 8px',
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* JOIN 选项卡 */}
            <Show when={activeTab() === 'joins'}>
              <div style={{ "font-size": '12px' }}>
                {/* 非主表列表（每个表有自己的 JOIN 类型） */}
                <Show when={queryState.tables.length <= 1}>
                  <div style={{
                    padding: '20px',
                    "text-align": 'center',
                    color: '#64748b',
                    "background-color": '#1e293b',
                    "border-radius": '6px',
                  }}>
                    <div style={{ "margin-bottom": '8px' }}>添加更多表来配置 JOIN</div>
                    <div style={{ "font-size": '11px' }}>💡 拖拽列到另一个表的列来创建 ON 条件</div>
                  </div>
                </Show>

                <For each={queryState.tables.filter(t => {
                  const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
                  return t.id !== primaryId;
                })}>
                  {(table) => {
                    const joinColors: Record<string, string> = {
                      'INNER': '#3b82f6',
                      'LEFT': '#22c55e',
                      'RIGHT': '#f59e0b',
                      'FULL': '#a855f7',
                      'CROSS': '#ef4444',
                    };
                    const currentJoinType = table.joinType || 'INNER';
                    const tableOrder = getTableJoinOrder(table.id);

                    // 获取当前表及之前的所有表 ID
                    const tablesBeforeOrCurrent = () => getTablesBefore(table.id);

                    // 过滤条件：涉及当前表，且条件的两个表都在"之前"的表集合中
                    const tableConditions = () => queryState.joinConditions.filter(c => {
                      // 条件必须涉及当前表
                      const involvesCurrentTable = c.leftTableId === table.id || c.rightTableId === table.id;
                      if (!involvesCurrentTable) return false;

                      // 条件涉及的两个表都必须在当前表之前（包括当前表）
                      const beforeSet = tablesBeforeOrCurrent();
                      return beforeSet.has(c.leftTableId) && beforeSet.has(c.rightTableId);
                    });

                    const isDragOver = () => dragOverItem() === table.id && dragSortItem()?.type === 'table';

                    return (
                      <div
                        draggable={true}
                        onDragStart={(e) => handleSortDragStart('table', table.id, e)}
                        onDragOver={(e) => handleSortDragOver(table.id, e)}
                        onDragLeave={handleSortDragLeave}
                        onDrop={(e) => handleSortDrop(table.id, e)}
                        onDragEnd={handleSortDragEnd}
                        style={{
                          padding: '10px',
                          "background-color": isDragOver() ? '#334155' : '#1e293b',
                          "border-radius": '6px',
                          "margin-bottom": '8px',
                          "border-left": `3px solid ${joinColors[currentJoinType]}`,
                          cursor: 'grab',
                          border: isDragOver() ? '2px dashed #3b82f6' : '2px solid transparent',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {/* 表名和 JOIN 类型 */}
                        <div style={{
                          display: 'flex',
                          "align-items": 'center',
                          gap: '8px',
                          "margin-bottom": '8px',
                        }}>
                          <span style={{ color: '#64748b', cursor: 'grab' }}>⋮⋮</span>
                          <span style={{
                            "background-color": '#3b82f6',
                            color: '#0f172a',
                            padding: '2px 6px',
                            "border-radius": '4px',
                            "font-size": '10px',
                            "font-weight": '700',
                          }}>
                            #{tableOrder}
                          </span>
                          <span style={{ color: '#cbd5e1', "font-weight": '600' }}>
                            {table.name} ({table.alias})
                          </span>
                          <select
                            value={currentJoinType}
                            onChange={(e) => updateTableJoinType(table.id, e.currentTarget.value as JoinType)}
                            style={{
                              "margin-left": 'auto',
                              padding: '4px 8px',
                              "background-color": '#0f172a',
                              border: '1px solid #334155',
                              "border-radius": '4px',
                              color: joinColors[currentJoinType],
                              "font-size": '11px',
                              "font-weight": '600',
                            }}
                          >
                            <option value="INNER">INNER JOIN</option>
                            <option value="LEFT">LEFT JOIN</option>
                            <option value="RIGHT">RIGHT JOIN</option>
                            <option value="FULL">FULL JOIN</option>
                            <option value="CROSS">CROSS JOIN</option>
                          </select>
                        </div>

                        {/* ON 条件列表 */}
                        <Show when={tableConditions().length > 0}>
                          <div style={{ color: '#94a3b8', "font-size": '11px', "margin-bottom": '6px' }}>ON 条件:</div>
                          <For each={tableConditions()}>
                            {(cond) => {
                              const leftTable = queryState.tables.find(t => t.id === cond.leftTableId);
                              const rightTable = queryState.tables.find(t => t.id === cond.rightTableId);

                              return (
                                <div style={{
                                  display: 'flex',
                                  gap: '6px',
                                  "margin-bottom": '6px',
                                  "align-items": 'center',
                                  padding: '6px 8px',
                                  "background-color": '#0f172a',
                                  "border-radius": '4px',
                                }}>
                                  <span style={{ color: '#94a3b8', "font-size": '11px', flex: 1 }}>
                                    {cond.leftColumn} {cond.operator} {cond.rightColumn}
                                  </span>
                                  <button
                                    onClick={() => removeJoinCondition(cond.id)}
                                    style={{
                                      padding: '2px 6px',
                                      background: 'none',
                                      border: 'none',
                                      color: '#ef4444',
                                      cursor: 'pointer',
                                      "font-size": '12px',
                                    }}
                                    title="删除此条件"
                                  >
                                    ✕
                                  </button>
                                </div>
                              );
                            }}
                          </For>
                        </Show>

                        <Show when={tableConditions().length === 0}>
                          <div style={{
                            color: '#64748b',
                            "font-size": '11px',
                            padding: '8px',
                            "background-color": '#0f172a',
                            "border-radius": '4px',
                            "text-align": 'center',
                          }}>
                            无 ON 条件（CROSS JOIN）
                          </div>
                        </Show>
                      </div>
                    );
                  }}
                </For>

                {/* 所有 JOIN 条件列表 */}
                <Show when={queryState.joinConditions.length > 0}>
                  <div style={{
                    "margin-top": '16px',
                    padding: '10px',
                    "background-color": '#0f172a',
                    "border-radius": '6px',
                  }}>
                    <div style={{ color: '#64748b', "font-size": '11px', "margin-bottom": '8px' }}>
                      所有 ON 条件 ({queryState.joinConditions.length})
                    </div>
                    <For each={queryState.joinConditions}>
                      {(cond) => (
                        <div style={{
                          display: 'flex',
                          "align-items": 'center',
                          gap: '6px',
                          "margin-bottom": '4px',
                          "font-size": '11px',
                          color: '#94a3b8',
                        }}>
                          <span style={{ flex: 1 }}>
                            {cond.leftColumn} {cond.operator} {cond.rightColumn}
                          </span>
                          <button
                            onClick={() => removeJoinCondition(cond.id)}
                            style={{
                              padding: '2px 6px',
                              background: 'none',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Sorting 选项卡 */}
            <Show when={activeTab() === 'sorting'}>
              <div style={{ "font-size": '12px' }}>
                <button
                  onClick={addSortColumn}
                  style={{
                    width: '100%',
                    padding: '8px',
                    "background-color": '#334155',
                    color: '#e2e8f0',
                    border: 'none',
                    "border-radius": '6px',
                    cursor: 'pointer',
                    "margin-bottom": '12px',
                    display: 'flex',
                    "align-items": 'center',
                    "justify-content": 'center',
                    gap: '6px',
                  }}
                >
                  <span>+</span> 添加排序
                </button>

                <For each={queryState.sortColumns}>
                  {(sort) => {
                    const isDragOver = () => dragOverItem() === sort.id && dragSortItem()?.type === 'sort';
                    return (
                      <div
                        draggable={true}
                        onDragStart={(e) => handleSortDragStart('sort', sort.id, e)}
                        onDragOver={(e) => handleSortDragOver(sort.id, e)}
                        onDragLeave={handleSortDragLeave}
                        onDrop={(e) => handleSortDrop(sort.id, e)}
                        onDragEnd={handleSortDragEnd}
                        style={{
                          padding: '10px',
                          "background-color": isDragOver() ? '#334155' : '#1e293b',
                          "border-radius": '6px',
                          "margin-bottom": '8px',
                          display: 'flex',
                          gap: '8px',
                          "align-items": 'center',
                          cursor: 'grab',
                          border: isDragOver() ? '2px dashed #3b82f6' : '2px solid transparent',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <span style={{ color: '#64748b', cursor: 'grab' }}>⋮⋮</span>
                        <select
                          value={sort.column}
                          onChange={(e) => updateSortColumn(sort.id, { column: e.currentTarget.value })}
                          style={{
                            flex: 1,
                            padding: '6px 8px',
                            "background-color": '#0f172a',
                            border: '1px solid #334155',
                            "border-radius": '4px',
                            color: '#e2e8f0',
                            "font-size": '11px',
                          }}
                        >
                          <option value="">选择列</option>
                          <For each={allAvailableColumns()}>
                            {(col) => <option value={col.value}>{col.label}</option>}
                          </For>
                        </select>

                        <select
                          value={sort.direction}
                          onChange={(e) => updateSortColumn(sort.id, { direction: e.currentTarget.value as 'ASC' | 'DESC' })}
                          style={{
                            padding: '6px 8px',
                            "background-color": '#0f172a',
                            border: '1px solid #334155',
                            "border-radius": '4px',
                            color: '#e2e8f0',
                            "font-size": '11px',
                          }}
                        >
                          <option value="ASC">升序 ↑</option>
                          <option value="DESC">降序 ↓</option>
                        </select>

                        <button
                          onClick={() => removeSortColumn(sort.id)}
                          style={{
                            padding: '4px 8px',
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            cursor: 'pointer',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    );
                  }}
                </For>
              </div>
            </Show>

            {/* Misc 选项卡 */}
            <Show when={activeTab() === 'misc'}>
              <div style={{ "font-size": '12px' }}>
                <div style={{
                  padding: '12px',
                  "background-color": '#1e293b',
                  "border-radius": '6px',
                  "margin-bottom": '12px',
                }}>
                  <label style={{
                    display: 'flex',
                    "align-items": 'center',
                    gap: '8px',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={queryState.distinct}
                      onChange={(e) => setQueryState('distinct', e.currentTarget.checked)}
                      style={{ "accent-color": '#3b82f6' }}
                    />
                    SELECT DISTINCT
                  </label>
                </div>

                <div style={{
                  padding: '12px',
                  "background-color": '#1e293b',
                  "border-radius": '6px',
                }}>
                  <div style={{ color: '#94a3b8', "margin-bottom": '8px' }}>LIMIT</div>
                  <input
                    type="number"
                    placeholder="无限制"
                    value={queryState.limit || ''}
                    onInput={(e) => {
                      const value = parseInt(e.currentTarget.value);
                      setQueryState('limit', isNaN(value) ? undefined : value);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px',
                      "background-color": '#0f172a',
                      border: '1px solid #334155',
                      "border-radius": '4px',
                      color: '#e2e8f0',
                      "font-size": '12px',
                      "box-sizing": 'border-box',
                    }}
                  />
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>

      {/* 表右键菜单 */}
      <Show when={tableContextMenu()}>
        {(menu) => {
          const table = queryState.tables.find(t => t.id === menu().tableId);
          if (!table) return null;

          const isPrimary = queryState.primaryTableId === table.id ||
            (!queryState.primaryTableId && queryState.tables[0]?.id === table.id);
          const currentJoinType = table.joinType || 'INNER';

          const joinTypes: Array<{ type: JoinType; label: string; color: string }> = [
            { type: 'INNER', label: 'INNER JOIN', color: '#3b82f6' },
            { type: 'LEFT', label: 'LEFT JOIN', color: '#22c55e' },
            { type: 'RIGHT', label: 'RIGHT JOIN', color: '#f59e0b' },
            { type: 'FULL', label: 'FULL JOIN', color: '#a855f7' },
            { type: 'CROSS', label: 'CROSS JOIN', color: '#ef4444' },
          ];

          return (
            <>
              {/* 点击外部关闭菜单 */}
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  "z-index": 999,
                }}
                onClick={closeTableContextMenu}
                onContextMenu={(e) => { e.preventDefault(); closeTableContextMenu(); }}
              />
              {/* 菜单内容 */}
              <div
                style={{
                  position: 'fixed',
                  left: `${menu().x}px`,
                  top: `${menu().y}px`,
                  "background-color": '#1e293b',
                  border: '1px solid #475569',
                  "border-radius": '6px',
                  "box-shadow": '0 8px 24px rgba(0,0,0,0.4)',
                  "z-index": 1000,
                  "min-width": '160px',
                  overflow: 'hidden',
                }}
              >
                <div
                  onClick={() => setPrimaryTable(menu().tableId)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    "align-items": 'center',
                    gap: '8px',
                    color: isPrimary ? '#f59e0b' : '#e2e8f0',
                    "font-size": '13px',
                    "background-color": 'transparent',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span>👑</span>
                  <span>{isPrimary ? '已是主表' : '设为主表'}</span>
                </div>

                {/* 非主表才显示 JOIN 类型选项 */}
                <Show when={!isPrimary}>
                  <div style={{ height: '1px', "background-color": '#475569' }} />
                  <div style={{
                    padding: '8px 14px',
                    color: '#64748b',
                    "font-size": '11px',
                  }}>
                    JOIN 类型
                  </div>
                  <For each={joinTypes}>
                    {(jt) => (
                      <div
                        onClick={() => {
                          updateTableJoinType(menu().tableId, jt.type);
                          closeTableContextMenu();
                        }}
                        style={{
                          padding: '8px 14px',
                          cursor: 'pointer',
                          display: 'flex',
                          "align-items": 'center',
                          gap: '8px',
                          color: currentJoinType === jt.type ? jt.color : '#e2e8f0',
                          "font-size": '12px',
                          "background-color": currentJoinType === jt.type ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                          "font-weight": currentJoinType === jt.type ? '600' : 'normal',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = currentJoinType === jt.type ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}
                      >
                        <span style={{
                          width: '8px',
                          height: '8px',
                          "border-radius": '50%',
                          "background-color": jt.color,
                        }} />
                        <span>{jt.label}</span>
                        <Show when={currentJoinType === jt.type}>
                          <span style={{ "margin-left": 'auto' }}>✓</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>

                <div style={{ height: '1px', "background-color": '#475569' }} />
                <div
                  onClick={() => {
                    removeTableFromCanvas(menu().tableId);
                    closeTableContextMenu();
                  }}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    "align-items": 'center',
                    gap: '8px',
                    color: '#ef4444',
                    "font-size": '13px',
                    "background-color": 'transparent',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span>🗑️</span>
                  <span>移除表</span>
                </div>
              </div>
            </>
          );
        }}
      </Show>

      {/* JOIN 连线右键菜单 */}
      <Show when={joinContextMenu()}>
        {(menu) => {
          const condition = queryState.joinConditions.find(c => c.id === menu().joinId);
          if (!condition) return null;

          // 根据表的顺序确定目标表（顺序靠后的表）
          const table1 = queryState.tables.find(t => t.id === condition.leftTableId);
          const table2 = queryState.tables.find(t => t.id === condition.rightTableId);
          if (!table1 || !table2) return null;

          // 获取表的顺序索引
          const getTableOrderIndex = (tableId: string): number => {
            const primaryId = queryState.primaryTableId || queryState.tables[0]?.id;
            if (tableId === primaryId) return -1;
            return queryState.tables.findIndex(t => t.id === tableId);
          };

          const order1 = getTableOrderIndex(table1.id);
          const order2 = getTableOrderIndex(table2.id);

          // 顺序靠后的表是目标表（被 JOIN 进来的）
          const targetTable = order1 < order2 ? table2 : table1;
          const sourceTable = order1 < order2 ? table1 : table2;

          const currentJoinType = targetTable.joinType || 'INNER';

          const joinTypes: Array<{ type: JoinType; label: string; color: string }> = [
            { type: 'INNER', label: 'INNER JOIN', color: '#3b82f6' },
            { type: 'LEFT', label: 'LEFT JOIN', color: '#22c55e' },
            { type: 'RIGHT', label: 'RIGHT JOIN', color: '#f59e0b' },
            { type: 'FULL', label: 'FULL JOIN', color: '#a855f7' },
            { type: 'CROSS', label: 'CROSS JOIN', color: '#ef4444' },
          ];

          return (
            <>
              {/* 点击外部关闭菜单 */}
              <div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  "z-index": 999,
                }}
                onClick={closeJoinContextMenu}
                onContextMenu={(e) => { e.preventDefault(); closeJoinContextMenu(); }}
              />
              {/* 菜单内容 */}
              <div
                style={{
                  position: 'fixed',
                  left: `${menu().x}px`,
                  top: `${menu().y}px`,
                  "background-color": '#1e293b',
                  border: '1px solid #475569',
                  "border-radius": '6px',
                  "box-shadow": '0 8px 24px rgba(0,0,0,0.4)',
                  "z-index": 1000,
                  "min-width": '180px',
                  overflow: 'hidden',
                }}
              >
                {/* 条件信息 */}
                <div style={{
                  padding: '8px 14px',
                  color: '#94a3b8',
                  "font-size": '11px',
                  "border-bottom": '1px solid #334155',
                  "background-color": '#0f172a',
                }}>
                  {condition.leftColumn} = {condition.rightColumn}
                </div>
                {/* JOIN 类型选择（修改目标表的 joinType） */}
                <div style={{
                  padding: '8px 14px',
                  color: '#64748b',
                  "font-size": '11px',
                  "border-bottom": '1px solid #334155',
                }}>
                  {targetTable.name} 的 JOIN 类型
                </div>
                <For each={joinTypes}>
                  {(jt) => (
                    <div
                      onClick={() => {
                        updateTableJoinType(targetTable.id, jt.type);
                        closeJoinContextMenu();
                      }}
                      style={{
                        padding: '8px 14px',
                        cursor: 'pointer',
                        display: 'flex',
                        "align-items": 'center',
                        gap: '8px',
                        color: currentJoinType === jt.type ? jt.color : '#e2e8f0',
                        "font-size": '13px',
                        "background-color": currentJoinType === jt.type ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                        "font-weight": currentJoinType === jt.type ? '600' : 'normal',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = currentJoinType === jt.type ? 'rgba(59, 130, 246, 0.1)' : 'transparent'}
                    >
                      <span style={{
                        width: '8px',
                        height: '8px',
                        "border-radius": '50%',
                        "background-color": jt.color,
                      }} />
                      <span>{jt.label}</span>
                      <Show when={currentJoinType === jt.type}>
                        <span style={{ "margin-left": 'auto' }}>✓</span>
                      </Show>
                    </div>
                  )}
                </For>
                <div style={{ height: '1px', "background-color": '#475569' }} />
                {/* 删除条件 */}
                <div
                  onClick={() => {
                    removeJoinCondition(menu().joinId);
                    closeJoinContextMenu();
                  }}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    "align-items": 'center',
                    gap: '8px',
                    color: '#ef4444',
                    "font-size": '13px',
                    "background-color": 'transparent',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#334155'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <span>🗑️</span>
                  <span>删除连接</span>
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </div>
  );
}