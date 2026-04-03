import type { Accessor } from "solid-js";
import { createSignal, For, Show, createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import Resizable from "@corvu/resizable";
import { getSchemas, getTables, getColumns, getIndexes, getTableDdl, getFunctionDdl } from "./api";
import CopyTableModal from "./copy-table-modal";
import DeleteTableModal from "./delete-table-modal";
import TruncateTableModal from "./truncate-table-modal";
import FakeDataModal from "./fake-data-modal";
import BackupModal from "./backup-modal";
import ErDiagramModal from "./er-diagram-modal";
import ErDiagramPickerModal from "./er-diagram-picker-modal";
import PartitionTableModal from "./partition-table-modal";
import CreateSchemaModal from "./create-schema-modal";
import DeleteSchemaModal, { isSystemSchema } from "./delete-schema-modal";
import PgStatModal from "./pg-stat-modal";
import ExtensionsModal from "./extensions-modal";
import type { ErDiagramSelection } from "./er-diagram-modal";
import type { ConnectionInfo } from "./app";
import { findStoredConnection, hasStoredConnection, updateStoredConnectionMeta, reorderConnectionList, type ConnectionList, type StoredConnection } from "./connection-storage";
import { useDialog } from "./dialog-context";
import { vscode } from "./theme";
import { getEffectiveDbCapabilities } from "./db-capabilities-cache";
import { getRegisteredDbType } from "./db-session-meta";
import { isMysqlFamily } from "../shared/src";

// 数据库对象类型
type NodeType = "savedConnection" | "connection" | "schema" | "tables" | "views" | "functions" | "table" | "view" | "function" | "column" | "indexes" | "index";

interface TreeNode {
  id: string;
  name: string;
  type: NodeType;
  schema?: string;
  table?: string;
  connectionId?: string;
  /** savedConnection 时存储 StoredConnection 的 id */
  storedId?: string;
  children: TreeNode[];
  meta?: Record<string, any>;
}

interface TreeState {
  nodes: TreeNode[];
  expandedIds: Set<string>;
  loadingIds: Set<string>;
  loadedIds: Set<string>;
  selectedId: string | null;
}

interface SidebarProps {
  connections: ConnectionInfo[];
  /** 已保存的连接（嵌套结构：Connection | Group） */
  savedConnections?: Accessor<ConnectionList>;
  activeConnectionId?: string | null;
  /** 当需要刷新某 schema 时，父组件设置此值；Sidebar 刷新后调用 onRefreshHandled 清空 */
  refreshSchemaRequest?: Accessor<{ connectionId: string; schema: string } | null>;
  onRefreshHandled?: () => void;
  onDisconnect?: (connectionId: string) => void;
  onQueryRequest?: (connectionId: string, sql: string) => void;
  onOpenQueryTab?: (connectionId: string, connectionInfo: string) => void;
  onNewTable?: (connectionId: string, connectionInfo: string, schema: string) => void;
  onEditTable?: (connectionId: string, connectionInfo: string, schema: string, table: string) => void;
  onViewDdl?: (connectionId: string, connectionInfo: string, schema: string, table: string, ddl: string) => void;
  onViewFunctionDdl?: (connectionId: string, connectionInfo: string, schema: string, funcName: string, ddl: string) => void;
  onRequestSchemaRefresh?: (connectionId: string, schema: string) => void;
  onAddConnection?: () => void;
  onConnectFromSaved?: (stored: StoredConnection) => Promise<{ success: boolean; connectionId?: string }>;
  onRemoveSaved?: (id: string) => void;
  onOpenEditConnection?: (stored: StoredConnection) => void;
  onRefreshSavedConnections?: () => void;
  connectingSavedId?: string | null;
  /** MySQL：单击侧栏某库时登记为查询默认库（解决未填连接 database 时的 No database selected） */
  onMysqlDefaultSchema?: (connectionId: string, schema: string) => void;
  /** 删除 schema/库成功后，父级可清除该连接的默认库登记 */
  onMysqlSchemaRemoved?: (connectionId: string, schema: string) => void;
}

// 图标组件
function NodeIcon(props: { type: NodeType }) {
  const icons: Record<NodeType, string> = {
    savedConnection: "🔌",
    connection: "🔌",
    schema: "📁",
    tables: "📋",
    views: "👁️",
    functions: "⚙️",
    table: "📊",
    view: "👓",
    function: "ƒ",
    column: "📎",
    indexes: "🔑",
    index: "🏷️",
  };
  return <span style={{ "margin-right": "6px", "font-size": "14px" }}>{icons[props.type] ?? "•"}</span>;
}

export default function Sidebar(props: SidebarProps) {
  const { showPrompt, showConfirm, openRenameTable } = useDialog();
  const panel = Resizable.usePanelContext();
  const onCollapse = () => panel.collapse();
  const collapsed = () => panel.collapsed();

  // 获取连接显示名称
  const getConnectionDisplayName = (s: StoredConnection, connInfo?: string) =>
    connInfo ?? (s.name?.trim() || s.label);

  /** 连接是否来自某已保存配置（含多实例：id 或 id-xxx） */
  function isConnFromStored(connId: string, storedId: string): boolean {
    return connId === storedId || connId.startsWith(storedId + "-");
  }
  /** 连接是否已挂在某个 saved 节点下 */
  function isConnShownUnderSaved(connId: string, saved: ConnectionList): boolean {
    for (const s of saved) {
      if (isConnFromStored(connId, s.id)) return true;
    }
    return false;
  }

  // 构建树根节点（扁平列表）
  function buildRootNodes(): TreeNode[] {
    const conns = props.connections ?? [];
    const saved = props.savedConnections?.() ?? [];
    const roots: TreeNode[] = [];

    for (const s of saved) {
      const matchingConns = conns.filter((c) => isConnFromStored(c.id, s.id));
      if (matchingConns.length > 0) {
        for (const c of matchingConns) {
          roots.push({ id: `connection:${c.id}`, name: getConnectionDisplayName(s, c.info), type: "connection", connectionId: c.id, storedId: s.id, children: [] });
        }
      } else {
        roots.push({ id: `saved:${s.id}`, name: getConnectionDisplayName(s, undefined), type: "savedConnection", storedId: s.id, children: [] });
      }
    }

    for (const c of conns) {
      if (!isConnShownUnderSaved(c.id, saved)) {
        roots.push({ id: `connection:${c.id}`, name: c.info, type: "connection", connectionId: c.id, children: [] });
      }
    }
    return roots;
  }

  const [state, setState] = createStore<TreeState>({
    nodes: buildRootNodes(),
    expandedIds: new Set<string>(),
    loadingIds: new Set(),
    loadedIds: new Set(),
    selectedId: null,
  });

  const [searchTerm, setSearchTerm] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; node: TreeNode } | null>(null);
  const [copyModal, setCopyModal] = createSignal<{ connectionId: string; schema: string; table: string } | null>(null);
  const [deleteModal, setDeleteModal] = createSignal<{ connectionId: string; schema: string; table: string } | null>(null);
  const [truncateModal, setTruncateModal] = createSignal<{ connectionId: string; schema: string; table: string } | null>(null);
  const [fakeDataModal, setFakeDataModal] = createSignal<{ connectionId: string; schema: string; table: string } | null>(null);
  const [backupModal, setBackupModal] = createSignal<
    | { connectionId: string; schema: string }
    | { connectionId: string; schema: null }
    | null
  >(null);
  const [erDiagramModal, setErDiagramModal] = createSignal<
    | { connectionId: string; schema: string }
    | { connectionId: string; selection: ErDiagramSelection }
    | null
  >(null);
  const [erDiagramPickerModal, setErDiagramPickerModal] = createSignal<{ connectionId: string } | null>(null);
  const [partitionTableModal, setPartitionTableModal] = createSignal<{
    connectionId: string;
    schema: string;
    table: string;
  } | null>(null);
  const [pgStatModal, setPgStatModal] = createSignal<{ connectionId: string } | null>(null);
  const [extensionsModal, setExtensionsModal] = createSignal<{ connectionId: string } | null>(null);
  const [createSchemaModalCid, setCreateSchemaModalCid] = createSignal<string | null>(null);
  const [deleteSchemaModal, setDeleteSchemaModal] = createSignal<{ connectionId: string; schema: string } | null>(null);
  const [dragOverZone, setDragOverZone] = createSignal<string | null>(null);

  // 右键菜单打开时，点击文档任意处关闭。必须用 bubble(false)，否则 capture 会先于菜单项 onClick 执行并关闭菜单，导致新建查询/刷新/断开等无反应
  createEffect(() => {
    if (!contextMenu()) return;
    const handler = () => closeContextMenu();
    document.addEventListener("click", handler, false);
    document.addEventListener("contextmenu", handler, false);
    onCleanup(() => {
      document.removeEventListener("click", handler, false);
      document.removeEventListener("contextmenu", handler, false);
    });
  });

  /** 从树节点 id 解析 connectionId（schema:/table:/connection: 等格式统一为第 2 段） */
  function connectionIdFromNodeId(nodeId: string): string | undefined {
    const parts = nodeId.split(":");
    return parts.length >= 2 ? parts[1] : undefined;
  }

  /** 某连接刷新 schema 列表后，对已展开的 schema / 表重新拉取数据 */
  function reloadExpandedDescendants(connectionId: string) {
    const expanded = [...state.expandedIds];
    const schemaJobs: Promise<unknown>[] = [];
    for (const expId of expanded) {
      const n = findNode(state.nodes, expId);
      if (n?.type === "schema" && n.connectionId === connectionId && n.schema) {
        schemaJobs.push(
          loadTables(connectionId, n.schema).finally(() => {
            setState("loadedIds", (p) => new Set(p).add(expId));
          })
        );
      }
    }
    void Promise.all(schemaJobs).then(() => {
      for (const expId of expanded) {
        const n = findNode(state.nodes, expId);
        if (
          (n?.type === "table" || n?.type === "view") &&
          n.connectionId === connectionId &&
          n.schema &&
          n.table
        ) {
          void Promise.all([
            loadColumns(connectionId, n.schema, n.table),
            n.type === "table" ? loadIndexes(connectionId, n.schema, n.table) : Promise.resolve(),
          ]).finally(() => {
            setState("loadedIds", (p) => new Set(p).add(expId));
          });
        }
      }
    });
  }

  /** 清除该连接下所有已缓存的加载标记（含子节点） */
  function clearLoadedIdsForConnection(connectionId: string) {
    setState("loadedIds", (prev) =>
      new Set([...prev].filter((id) => connectionIdFromNodeId(id) !== connectionId))
    );
  }

  // 刷新所有连接：必须丢弃 schema 下缓存的表/视图，否则仅重拉 schema 列表时界面看起来「没反应」
  function refreshAll(e?: MouseEvent) {
    e?.stopPropagation();
    const connNodes = state.nodes.filter((n) => n.type === "connection" && n.connectionId);
    if (connNodes.length === 0) return;
    const cids = new Set(connNodes.map((n) => n.connectionId!));
    setState("loadedIds", (prev) =>
      new Set([...prev].filter((id) => {
        const cid = connectionIdFromNodeId(id);
        return !cid || !cids.has(cid);
      }))
    );
    for (const n of connNodes) {
      const cid = n.connectionId!;
      void loadSchemas(cid, n.id, false).then(() => reloadExpandedDescendants(cid));
    }
  }

  // connections / savedConnections 变化时重建顶层节点
  createEffect(() => {
    const conns = props.connections ?? [];
    const connIds = new Set(conns.map((c) => c.id));
    const newRoots = buildRootNodes();
    setState(produce((s) => {
      s.expandedIds = new Set([...s.expandedIds].filter((id) => {
        const parts = id.split(":");
        if (parts.length < 2) return true;
        return connIds.has(parts[1]);
      }));
      s.loadedIds = new Set([...s.loadedIds].filter((id) => {
        const parts = id.split(":");
        if (parts.length < 2) return true;
        return connIds.has(parts[1]);
      }));
      s.nodes = newRoots.map((r) => {
        if (r.type === "connection" && r.connectionId) {
          const existing = s.nodes.find((n) => n.id === r.id || (n.connectionId === r.connectionId && n.type === "connection"));
          if (existing?.children?.length) return { ...r, children: existing.children };
        }
        return r;
      });
    }));
  });

  // 递归查找节点并返回路径索引
  function findNodePath(nodes: TreeNode[], nodeId: string, path: number[] = []): number[] | null {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === nodeId) {
        return [...path, i];
      }
      if (nodes[i].children.length > 0) {
        const found = findNodePath(nodes[i].children, nodeId, [...path, i]);
        if (found) return found;
      }
    }
    return null;
  }

  // 使用 produce 更新指定节点的 children
  function updateNodeChildren(nodeId: string, newChildren: TreeNode[]) {
    setState(produce((s) => {
      const path = findNodePath(s.nodes, nodeId);
      if (!path) return;

      let current: any = s.nodes;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]].children;
      }
      const target = current[path[path.length - 1]];
      target.children = newChildren;
    }));
  }

  // 从树中递归查找节点
  function findNode(nodes: TreeNode[], nodeId: string): TreeNode | null {
    for (const n of nodes) {
      if (n.id === nodeId) return n;
      if (n.children.length > 0) {
        const found = findNode(n.children, nodeId);
        if (found) return found;
      }
    }
    return null;
  }

  // 加载 schemas，挂到指定连接节点下。reuseChildren=true 时保留已展开的 tables/views（普通展开）；false 用于全局/连接刷新，避免旧列表不更新
  async function loadSchemas(connectionId: string, connectionNodeId: string, reuseChildren = true) {
    try {
      const data = await getSchemas(connectionId);
      if (data.schemas) {
        const connNode = findNode(state.nodes, connectionNodeId);
        const existingSchemas = connNode?.children ?? [];
        const schemaNodes: TreeNode[] = data.schemas.map((schema: string) => {
          const schemaId = `schema:${connectionId}:${schema}`;
          const existing = existingSchemas.find((s) => s.id === schemaId);
          const emptyTables = { id: `tables:${connectionId}:${schema}`, name: "Tables", type: "tables" as NodeType, schema, connectionId, children: [] };
          const emptyViews = { id: `views:${connectionId}:${schema}`, name: "Views", type: "views" as NodeType, schema, connectionId, children: [] };
          const emptyFunctions = { id: `functions:${connectionId}:${schema}`, name: "Functions", type: "functions" as NodeType, schema, connectionId, children: [] };
          const tablesNode = reuseChildren
            ? (existing?.children?.find((c) => c.type === "tables") ?? emptyTables)
            : emptyTables;
          const viewsNode = reuseChildren
            ? (existing?.children?.find((c) => c.type === "views") ?? emptyViews)
            : emptyViews;
          const functionsNode = reuseChildren
            ? (existing?.children?.find((c) => c.type === "functions") ?? emptyFunctions)
            : emptyFunctions;
          const baseChildren: TreeNode[] = [tablesNode, viewsNode, functionsNode];
          return {
            id: schemaId,
            name: schema,
            type: "schema" as NodeType,
            schema,
            connectionId,
            children: baseChildren,
          };
        });
        updateNodeChildren(connectionNodeId, schemaNodes);
        setState("loadedIds", (prev) => new Set(prev).add(connectionNodeId));
      }
    } catch (e) {
      console.error("加载 schemas 失败:", e);
    }
  }

  function reloadConnectionSchemaList(connectionId: string) {
    const nodeId = `connection:${connectionId}`;
    clearLoadedIdsForConnection(connectionId);
    void loadSchemas(connectionId, nodeId, false).then(() => reloadExpandedDescendants(connectionId));
  }

  // 加载表和视图
  async function loadTables(connectionId: string, schema: string) {
    try {
      const data = await getTables(connectionId, schema);

      const tablesId = `tables:${connectionId}:${schema}`;
      const viewsId = `views:${connectionId}:${schema}`;

      // 更新 tables 节点
      const tableChildren: TreeNode[] = (data.tables || []).map((t: string) => ({
        id: `table:${connectionId}:${schema}.${t}`,
        name: t,
        type: "table" as NodeType,
        schema,
        table: t,
        connectionId,
        children: [
          { id: `columns:${connectionId}:${schema}.${t}`, name: "Columns", type: "tables" as NodeType, schema, table: t, connectionId, children: [] },
          { id: `indexes:${connectionId}:${schema}.${t}`, name: "Indexes", type: "indexes" as NodeType, schema, table: t, connectionId, children: [] },
        ],
      }));
      updateNodeChildren(tablesId, tableChildren);

      // 更新 views 节点
      const viewChildren: TreeNode[] = (data.views || []).map((v: string) => ({
        id: `view:${connectionId}:${schema}.${v}`,
        name: v,
        type: "view" as NodeType,
        schema,
        table: v,
        connectionId,
        children: [
          { id: `columns:${connectionId}:${schema}.${v}`, name: "Columns", type: "tables" as NodeType, schema, table: v, connectionId, children: [] },
        ],
      }));
      updateNodeChildren(viewsId, viewChildren);

      // 更新 functions 节点
      const functionsId = `functions:${connectionId}:${schema}`;
      const functionChildren: TreeNode[] = (data.functions || []).map((f: { oid: number; name: string; args: string }) => ({
        id: `function:${connectionId}:${schema}.${f.name}`,
        name: f.args ? `${f.name}(${f.args})` : f.name,
        type: "function" as NodeType,
        schema,
        connectionId,
        children: [],
        meta: { oid: f.oid, args: f.args, funcName: f.name },
      }));
      updateNodeChildren(functionsId, functionChildren);
    } catch (e) {
      console.error("加载表失败:", e);
    }
  }

  // 响应外部刷新请求（新建表/编辑表成功后）
  createEffect(() => {
    const req = props.refreshSchemaRequest?.();
    if (!req) return;
    loadTables(req.connectionId, req.schema).then(() => {
      const tablePrefix = `table:${req.connectionId}:${req.schema}.`;
      const viewPrefix = `view:${req.connectionId}:${req.schema}.`;
      // For any table/view nodes that are currently expanded, reload their columns immediately
      const expandedTableIds = [...state.expandedIds].filter(
        (id) => id.startsWith(tablePrefix) || id.startsWith(viewPrefix)
      );
      for (const tableId of expandedTableIds) {
        const node = findNode(state.nodes, tableId);
        if (node && node.table && node.schema && node.connectionId) {
          loadColumns(node.connectionId, node.schema, node.table);
          if (node.type === "table") loadIndexes(node.connectionId, node.schema, node.table);
        }
      }
      // Clear loadedIds so unexpanded tables will reload on next expand
      setState("loadedIds", (prev) => {
        const s = new Set(prev);
        for (const id of s) {
          if (id.startsWith(tablePrefix) || id.startsWith(viewPrefix)) s.delete(id);
        }
        return s;
      });
    }).finally(() => props.onRefreshHandled?.());
  });

  // 加载列信息
  async function loadColumns(connectionId: string, schema: string, table: string) {
    try {
      const data = await getColumns(connectionId, schema, table);

      const columnsId = `columns:${connectionId}:${schema}.${table}`;
      const columnChildren: TreeNode[] = (data.columns || []).map((col: any) => ({
        id: `column:${connectionId}:${schema}.${table}.${col.column_name}`,
        name: `${col.column_name} : ${col.data_type}${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`,
        type: "column" as NodeType,
        schema,
        table,
        connectionId,
        children: [],
        meta: col,
      }));
      updateNodeChildren(columnsId, columnChildren);
    } catch (e) {
      console.error("加载列失败:", e);
    }
  }

  // 加载索引信息
  async function loadIndexes(connectionId: string, schema: string, table: string) {
    try {
      const data = await getIndexes(connectionId, schema, table);

      const indexesId = `indexes:${connectionId}:${schema}.${table}`;
      const indexChildren: TreeNode[] = (data.indexes || []).map((idx: any) => ({
        id: `index:${connectionId}:${schema}.${table}.${idx.indexname}`,
        name: idx.indexname,
        type: "index" as NodeType,
        schema,
        table,
        connectionId,
        children: [],
        meta: idx,
      }));
      updateNodeChildren(indexesId, indexChildren);
    } catch (e) {
      console.error("加载索引失败:", e);
    }
  }

  // 切换节点展开状态
  function toggleNode(node: TreeNode) {
    const isExpanded = state.expandedIds.has(node.id);

    if (!isExpanded) {
      // 展开节点
      setState("expandedIds", (prev) => new Set(prev).add(node.id));

      // 检查是否已经加载过数据
      if (state.loadedIds.has(node.id)) return;

      // 根据节点类型异步加载数据
      const cid = node.connectionId ?? (node.id.startsWith("connection:") ? node.id.replace("connection:", "") : "");
      if (node.type === "connection" && cid) {
        setState("loadingIds", (prev) => new Set(prev).add(node.id));
        loadSchemas(cid, node.id).finally(() => {
          setState("loadingIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
        });
      } else if (node.type === "schema" && node.schema && cid) {
        setState("loadingIds", (prev) => new Set(prev).add(node.id));
        loadTables(cid, node.schema).finally(() => {
          setState("loadingIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
          setState("loadedIds", (prev) => new Set(prev).add(node.id));
        });
      } else if ((node.type === "table" || node.type === "view") && node.schema && node.table && cid) {
        setState("loadingIds", (prev) => new Set(prev).add(node.id));
        Promise.all([
          loadColumns(cid, node.schema, node.table),
          node.type === "table" ? loadIndexes(cid, node.schema, node.table) : Promise.resolve()
        ]).finally(() => {
          setState("loadingIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
          setState("loadedIds", (prev) => new Set(prev).add(node.id));
        });
      }
    } else {
      // 折叠节点
      setState("expandedIds", (prev) => {
        const s = new Set(prev);
        s.delete(node.id);
        return s;
      });
    }
  }

  // 处理节点点击
  function handleNodeClick(node: TreeNode, e: MouseEvent) {
    e.stopPropagation();
    setState("selectedId", node.id);

    const schemaCid = node.connectionId;
    if (node.type === "schema" && node.schema && schemaCid && isMysqlFamily(getRegisteredDbType(schemaCid))) {
      props.onMysqlDefaultSchema?.(schemaCid, node.schema);
    }

    if (node.type === "savedConnection" && node.storedId && e.detail === 1) {
      const stored = node.storedId ? findStoredConnection(props.savedConnections?.() ?? [], node.storedId) : undefined;
      if (stored && !props.connectingSavedId) {
        (async () => {
          const result = await props.onConnectFromSaved?.(stored);
          if (result?.success && result.connectionId) {
            const connNode: TreeNode = {
              id: `connection:${result.connectionId}`,
              name: stored.label,
              type: "connection",
              connectionId: result.connectionId,
              children: [],
            };
            toggleNode(connNode);
          }
        })();
      }
      return;
    }

    const canExpand = node.type === "connection" || node.type === "savedConnection" || node.type === "schema" || node.type === "table" || node.type === "view" ||
      node.type === "tables" || node.type === "views" || node.type === "functions" || node.type === "indexes";
    if (canExpand) toggleNode(node);

    const cid = node.connectionId;
    if (e.detail === 2 && (node.type === "table" || node.type === "view") && node.schema && node.table && cid) {
      props.onQueryRequest?.(cid, `SELECT * FROM ${node.schema}.${node.table}`);
    }
    // 双击函数：展示源码
    if (e.detail === 2 && node.type === "function" && node.schema && cid && props.onViewFunctionDdl) {
      const schema = node.schema;
      const funcName = node.meta?.funcName ?? node.name.replace(/\(.*\)$/, "");
      const oid = node.meta?.oid;
      getFunctionDdl(cid, schema, funcName, oid)
        .then(({ ddl }) => ddl && props.onViewFunctionDdl?.(cid, props.connections.find((c) => c.id === cid)?.info ?? node.name, schema, funcName, ddl))
        .catch((e) => console.error("获取函数源码失败:", e));
    }
  }

  // 右键菜单
  function handleContextMenu(node: TreeNode, e: MouseEvent) {
    e.preventDefault();
    setState("selectedId", node.id);
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }

  // 关闭右键菜单
  function closeContextMenu() {
    setContextMenu(null);
  }

  // 右键菜单操作
  function handleMenuAction(action: string) {
    const menu = contextMenu();
    if (!menu) return;

    const { node } = menu;
    const cid = node.connectionId ?? (node.id.startsWith("connection:") ? node.id.replace("connection:", "") : (node.id.split(":")[1] || ""));
    switch (action) {
      case "select":
        if (node.schema && node.table && cid) {
          props.onQueryRequest?.(cid, `SELECT * FROM ${node.schema}.${node.table}`);
        }
        break;
      case "selectTop100":
        if (node.schema && node.table && cid) {
          props.onQueryRequest?.(cid, `SELECT * FROM ${node.schema}.${node.table} LIMIT 100`);
        }
        break;
      case "count":
        if (node.schema && node.table && cid) {
          props.onQueryRequest?.(cid, `SELECT COUNT(*) FROM ${node.schema}.${node.table}`);
        }
        break;
      case "refresh":
        if (node.type === "schema" && node.schema && cid) {
          setState("loadedIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
          loadTables(cid, node.schema);
        }
        break;
      case "refreshConnection":
        if (node.type === "connection" && cid) {
          clearLoadedIdsForConnection(cid);
          void loadSchemas(cid, node.id, false).then(() => reloadExpandedDescendants(cid));
        }
        break;
      case "openQuery":
        if (node.type === "connection" && cid) {
          props.onOpenQueryTab?.(cid, node.name);
        }
        break;
      case "disconnect":
        if (node.type === "connection" && cid) {
          props.onDisconnect?.(cid);
        }
        break;
      case "connectSaved":
        if (node.type === "savedConnection" && node.storedId) {
          const stored = node.storedId ? findStoredConnection(props.savedConnections?.() ?? [], node.storedId) : undefined;
          if (stored && !props.connectingSavedId) {
            (async () => {
              const result = await props.onConnectFromSaved?.(stored);
              if (result?.success && result.connectionId) {
                const connNode: TreeNode = {
                  id: `connection:${result.connectionId}`,
                  name: stored.label,
                  type: "connection",
                  connectionId: result.connectionId,
                  children: [],
                };
                toggleNode(connNode);
              }
            })();
          }
        }
        break;
      case "editSaved":
        if (node.type === "savedConnection" && node.storedId) {
          const stored = node.storedId ? findStoredConnection(props.savedConnections?.() ?? [], node.storedId) : undefined;
          if (stored) props.onOpenEditConnection?.(stored);
        }
        break;
      case "removeSaved":
        if (node.type === "savedConnection" && node.storedId) {
          props.onRemoveSaved?.(node.storedId);
        }
        break;
      case "createNewGroup":
      case "deleteGroup":
        break;
      case "newTable":
        if ((node.type === "schema" || node.type === "tables" || node.type === "table") && node.schema && cid) {
          const conn = props.connections.find((c) => c.id === cid);
          props.onNewTable?.(cid, conn?.info ?? node.name, node.schema);
        }
        break;
      case "editTable":
        if ((node.type === "table" || node.type === "view") && node.schema && node.table && cid) {
          const conn = props.connections.find((c) => c.id === cid);
          props.onEditTable?.(cid, conn?.info ?? node.name, node.schema, node.table);
        }
        break;
      case "deleteTable":
        if (node.type === "table" && node.schema && node.table && cid) {
          setDeleteModal({ connectionId: cid, schema: node.schema, table: node.table });
        }
        break;
      case "truncateTable":
        if (node.type === "table" && node.schema && node.table && cid) {
          setTruncateModal({ connectionId: cid, schema: node.schema, table: node.table });
        }
        break;
      case "generateFakeData":
        if (node.type === "table" && node.schema && node.table && cid) {
          setFakeDataModal({ connectionId: cid, schema: node.schema, table: node.table });
        }
        break;
      case "viewErDiagram":
        if (node.type === "schema" && node.schema && cid) {
          setErDiagramModal({ connectionId: cid, schema: node.schema });
        }
        break;
      case "viewErDiagramFromConnection":
        if (node.type === "connection" && cid) {
          setErDiagramPickerModal({ connectionId: cid });
        }
        break;
      case "backupDatabase":
        if (node.type === "connection" && cid) {
          setBackupModal({ connectionId: cid, schema: null });
        }
        break;
      case "newSchema":
        if (node.type === "connection" && cid) {
          setCreateSchemaModalCid(cid);
        }
        break;
      case "deleteSchema":
        if (node.type === "schema" && node.schema && cid && !isSystemSchema(cid, node.schema)) {
          setDeleteSchemaModal({ connectionId: cid, schema: node.schema });
        }
        break;
      case "openPgStat":
        if (node.type === "connection" && cid) {
          setPgStatModal({ connectionId: cid });
        }
        break;
      case "openExtensions":
        if (node.type === "connection" && cid) {
          setExtensionsModal({ connectionId: cid });
        }
        break;
      case "backupSchema":
        if (node.type === "schema" && node.schema && cid) {
          setBackupModal({ connectionId: cid, schema: node.schema });
        }
        break;
      case "copyTable":
        if (node.type === "table" && node.schema && node.table && cid) {
          setCopyModal({
            connectionId: cid,
            schema: node.schema,
            table: node.table,
          });
        }
        break;
      case "renameTable":
        if (node.type === "table" && node.schema && node.table && cid) {
          openRenameTable({
            connectionId: cid,
            schema: node.schema,
            table: node.table,
            onSuccess: (connectionId, schema) => props.onRequestSchemaRefresh?.(connectionId, schema),
          });
        }
        break;
      case "viewDdl":
        if ((node.type === "table" || node.type === "view") && node.schema && node.table && cid) {
          const schema = node.schema;
          const table = node.table;
          const conn = props.connections.find((c) => c.id === cid);
          getTableDdl(cid, schema, table)
            .then(({ ddl }) => ddl && props.onViewDdl?.(cid, conn?.info ?? node.name, schema, table, ddl))
            .catch((e) => console.error("获取 DDL 失败:", e));
        }
        break;
      case "partitionTable":
        if (node.type === "table" && node.schema && node.table && cid) {
          setPartitionTableModal({ connectionId: cid, schema: node.schema, table: node.table });
        }
        break;
      case "viewFunctionDdl":
        if (node.type === "function" && node.schema && cid && props.onViewFunctionDdl) {
          const schema = node.schema;
          const funcName = node.meta?.funcName ?? node.name.replace(/\(.*\)$/, "");
          const oid = node.meta?.oid;
          const conn = props.connections.find((c) => c.id === cid);
          getFunctionDdl(cid, schema, funcName, oid)
            .then(({ ddl }) => ddl && props.onViewFunctionDdl?.(cid, conn?.info ?? node.name, schema, funcName, ddl))
            .catch((e) => console.error("获取函数源码失败:", e));
        }
        break;
      default:
        break;
    }
    closeContextMenu();
  }

  // 过滤节点
  function filterNodes(nodes: TreeNode[], term: string): TreeNode[] {
    if (!term) return nodes;
    return nodes
      .map((node) => {
        if (node.name.toLowerCase().includes(term.toLowerCase())) {
          return node;
        }
        if (node.children.length > 0) {
          const filtered = filterNodes(node.children, term);
          if (filtered.length > 0) {
            return { ...node, children: filtered };
          }
        }
        return null;
      })
      .filter((n): n is TreeNode => n !== null);
  }

  // 拖拽排序（仅顶层 savedConnection / connection）
  function handleDragStart(e: DragEvent, node: TreeNode) {
    const id = node.storedId ?? node.connectionId;
    if (id) {
      e.dataTransfer!.setData("text/plain", id);
      e.dataTransfer!.effectAllowed = "move";
    }
  }
  function handleDropZoneDragOver(e: DragEvent, zoneId: string) {
    if (!e.dataTransfer?.types.includes("text/plain")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOverZone(zoneId);
  }
  function handleDropZoneDragLeave(e: DragEvent) {
    const related = e.relatedTarget as Node | null;
    if (related && (e.currentTarget as Node).contains(related)) return;
    setDragOverZone(null);
  }
  // zoneId: "top" | "after:{storedId}"
  function handleDropZoneDrop(e: DragEvent, insertBeforeStoredId: string | null) {
    setDragOverZone(null);
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer?.getData("text/plain");
    if (!draggedId) return;
    const saved = props.savedConnections?.() ?? [];
    // 找到被拖拽项
    const draggedItem = saved.find((c) => c.id === draggedId);
    if (!draggedItem) return;
    // 构建新列表
    const without = saved.filter((c) => c.id !== draggedId);
    let newList: ConnectionList;
    if (insertBeforeStoredId === null) {
      // 追加到末尾
      newList = [...without, draggedItem];
    } else {
      const idx = without.findIndex((c) => c.id === insertBeforeStoredId);
      if (idx === -1) return;
      newList = [...without.slice(0, idx), draggedItem, ...without.slice(idx)];
    }
    reorderConnectionList(newList)
      .then(() => props.onRefreshSavedConnections?.())
      .catch((err) => console.warn("排序失败:", err));
  }

  // 渲染 drop zone 分隔线
  function renderDropZone(zoneId: string, insertBeforeStoredId: string | null) {
    const isActive = () => dragOverZone() === zoneId;
    return (
      <div
        style={{
          height: "4px",
          margin: "0 12px",
          "border-radius": "2px",
          "background-color": isActive() ? vscode.accent : "transparent",
          transition: "background-color 0.1s ease",
        }}
        onDragOver={(e) => handleDropZoneDragOver(e, zoneId)}
        onDragLeave={handleDropZoneDragLeave}
        onDrop={(e) => handleDropZoneDrop(e, insertBeforeStoredId)}
      />
    );
  }

  // 渲染单个节点
  function renderNode(node: TreeNode, depth: number = 0) {
    const isExpanded = () => state.expandedIds.has(node.id);
    const isLoading = () => state.loadingIds.has(node.id) || (node.type === "savedConnection" && node.storedId === props.connectingSavedId);
    const isSelected = () => state.selectedId === node.id;
    const hasChildren = () => node.children.length > 0;
    const canExpand = node.type === "connection" || node.type === "savedConnection" || node.type === "schema" || node.type === "table" || node.type === "view" ||
      node.type === "tables" || node.type === "views" || node.type === "functions" || node.type === "indexes";
    const isDraggable = depth === 0 && (node.type === "savedConnection" || node.type === "connection");

    return (
      <div>
        <div
          draggable={isDraggable}
          onDragStart={(e) => isDraggable && handleDragStart(e, node)}
          onClick={(e) => handleNodeClick(node, e)}
          onContextMenu={(e) => handleContextMenu(node, e)}
          style={{
            display: "flex",
            "align-items": "center",
            padding: "4px 8px",
            "padding-left": `${depth * 16 + 8}px`,
            cursor: isDraggable ? "grab" : "pointer",
            "background-color": isSelected() ? vscode.listSelect : "transparent",
            "border-left": node.type === "connection" && node.connectionId === props.activeConnectionId
              ? `3px solid ${vscode.accent}`
              : "3px solid transparent",
            color: isSelected() ? "#fff" : vscode.foreground,
            "border-radius": "4px",
            "margin": "1px 4px",
            "font-size": "13px",
            "font-family": "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            transition: "background-color 0.15s ease",
          }}
          onMouseEnter={(e) => !isSelected() && (e.currentTarget.style.backgroundColor = vscode.listHover)}
          onMouseLeave={(e) => !isSelected() && (e.currentTarget.style.backgroundColor = "transparent")}
        >
          {/* 展开/折叠箭头 */}
          <span
            style={{
              width: "16px",
              height: "16px",
              display: "flex",
              "align-items": "center",
              "justify-content": "center",
              "margin-right": "4px",
              color: vscode.foregroundDim,
              "font-size": "10px",
              transition: "transform 0.2s ease",
              transform: isExpanded() ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            {canExpand ? (isLoading() ? "⏳" : "▶") : ""}
          </span>

          {/* connection/savedConnection 用状态圆点替换 🔌，其他类型用 NodeIcon */}
          <Show when={node.type === "connection" || node.type === "savedConnection"} fallback={<NodeIcon type={node.type} />}>
            <span
              style={{
                width: "8px",
                height: "8px",
                "border-radius": "50%",
                "margin-right": "6px",
                "flex-shrink": 0,
                "background-color": node.type === "connection" ? vscode.success : vscode.foregroundMuted,
              }}
              title={node.type === "connection" ? "已连接" : "未连接，点击连接"}
            />
          </Show>

          <span style={{
            flex: 1,
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap",
            opacity: node.type === "savedConnection" && node.storedId === props.connectingSavedId ? 0.7 : 1,
          }}>
            {node.type === "savedConnection" && node.storedId === props.connectingSavedId ? "⏳ " : ""}{node.name}
          </span>

          {/* 计数徽章 */}
          <Show when={hasChildren() && isExpanded()}>
            <span style={{
              "font-size": "10px",
              color: vscode.foregroundDim,
              "background-color": vscode.inputBg,
              padding: "1px 6px",
              "border-radius": "10px",
              "margin-left": "4px",
            }}>
              {node.children.length}
            </span>
          </Show>
        </div>

        {/* 子节点 */}
        <Show when={isExpanded() && hasChildren()}>
          <div style={{ overflow: "hidden" }}>
            <For each={node.children}>
              {(child) => renderNode(child, depth + 1)}
            </For>
          </div>
        </Show>
      </div>
    );
  }

  const filteredTree = () => filterNodes(state.nodes, searchTerm());

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <Show when={collapsed()}>
        <button
          onClick={() => panel.expand()}
          title="展开侧边栏"
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            padding: "8px",
            border: "none",
            background: "none",
            color: vscode.foregroundDim,
            cursor: "pointer",
            "font-size": "14px",
            "z-index": 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
          onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
        >
          »
        </button>
      </Show>
      <div
        style={{
          width: "100%",
          height: "100%",
          "background-color": vscode.sidebarBg,
          "border-right": `1px solid ${vscode.border}`,
          display: collapsed() ? "none" : "flex",
          "flex-direction": "column",
          "user-select": "none",
        }}
        onClick={closeContextMenu}
      >
        {/* 标题栏：数据库 */}
        <div
          style={{
            padding: "10px 12px",
            "border-bottom": `1px solid ${vscode.border}`,
            "flex-shrink": 0,
            display: "flex",
            "align-items": "center",
            gap: "8px",
          }}
        >
          <span style={{ "font-size": "14px" }}>🗄️</span>
          <span style={{ "font-size": "13px", color: vscode.foreground, "font-weight": "600" }}>数据库</span>
          <div style={{ "margin-left": "auto", display: "flex", gap: "4px" }}>
            <button
              onClick={props.onAddConnection}
              style={{ background: "none", border: "none", color: vscode.foregroundDim, cursor: "pointer", padding: "4px", "font-size": "14px" }}
              title="添加数据库连接"
              onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
              onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
            >➕</button>
            <Show when={(props.connections ?? []).length > 0}>
              <button
                type="button"
                onClick={(e) => refreshAll(e)}
                style={{ background: "none", border: "none", color: vscode.foregroundDim, cursor: "pointer", padding: "4px", "font-size": "14px" }}
                title="刷新"
                onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
                onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
              >🔄</button>
            </Show>
            <button
              onClick={onCollapse}
              style={{ background: "none", border: "none", color: vscode.foregroundDim, cursor: "pointer", padding: "4px", "font-size": "14px" }}
              title="收起侧边栏"
              onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
              onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
            >◀</button>
          </div>
        </div>

      {/* 搜索框 */}
      <div style={{ padding: "8px 12px", "border-bottom": `1px solid ${vscode.border}` }}>
        <input
          type="text"
          placeholder="🔍 搜索表、视图..."
          value={searchTerm()}
          onInput={(e) => setSearchTerm(e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            "background-color": vscode.inputBg,
            border: `1px solid ${vscode.border}`,
            color: vscode.inputFg,
            "font-size": "12px",
            outline: "none",
            "box-sizing": "border-box",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = vscode.accent)}
          onBlur={(e) => (e.currentTarget.style.borderColor = vscode.border)}
        />
      </div>

      {/* 树形结构 */}
      <div
        style={{
          flex: 1,
          "overflow-y": "auto",
          "overflow-x": "hidden",
          padding: "8px 12px",
        }}
      >
        <Show when={filteredTree().length > 0} fallback={
          <div style={{
            padding: "20px",
            "text-align": "center",
            color: vscode.foregroundDim,
            "font-size": "13px"
          }}>
            {searchTerm() ? "未找到匹配项" : "暂无数据，请先连接数据库"}
          </div>
        }>
          {(() => {
            const nodes = filteredTree();
            const items: any[] = [];
            for (let i = 0; i < nodes.length; i++) {
              const n = nodes[i];
              const isDraggableNode = n.type === "savedConnection" || n.type === "connection";
              // drop zone before first draggable node
              if (i === 0 && isDraggableNode) {
                items.push(renderDropZone("zone-top", n.storedId ?? n.connectionId ?? null));
              }
              items.push(renderNode(n, 0));
              if (isDraggableNode) {
                // drop zone after this node (= before next node, or at bottom)
                const nextStoredId = nodes[i + 1]?.storedId ?? nodes[i + 1]?.connectionId ?? null;
                items.push(renderDropZone(`zone-after-${n.storedId ?? n.connectionId}`, nextStoredId));
              }
            }
            return <>{items}</>;
          })()}
        </Show>
      </div>

      {/* 右键菜单 */}
      <Show when={contextMenu()}>
        {(menu) => (
          <div
            style={{
              position: "fixed",
              left: `${menu().x}px`,
              top: `${menu().y}px`,
              "background-color": vscode.sidebarBg,
              border: `1px solid ${vscode.border}`,
              "border-radius": "8px",
              "box-shadow": "0 8px 24px rgba(0,0,0,0.4)",
              "z-index": "1000",
              "min-width": "180px",
              padding: "4px 0",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={menu().node.type === "schema" || menu().node.type === "tables" || menu().node.type === "table"}>
              <div
                onClick={() => handleMenuAction("newTable")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📋</span> 新增表
              </div>
            </Show>
            <Show when={menu().node.type === "table"}>
              <div
                onClick={() => handleMenuAction("editTable")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>✏️</span> 编辑表
              </div>
              <div
                onClick={() => handleMenuAction("copyTable")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📋</span> 复制表
              </div>
              <div
                onClick={() => handleMenuAction("renameTable")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>✏️</span> 修改表名
              </div>
              <div
                onClick={() => handleMenuAction("viewDdl")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📄</span> 查看 DDL
              </div>
              <div
                onClick={() => handleMenuAction("partitionTable")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔀</span> 分区结构 / 裁剪预览
              </div>
              <div
                onClick={() => handleMenuAction("generateFakeData")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📊</span> 生成假数据
              </div>
              <div style={{ height: "1px", "background-color": vscode.border, margin: "4px 0" }} />
              <div
                onClick={() => handleMenuAction("truncateTable")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🗑</span> 清空表
              </div>
              <div
                onClick={() => handleMenuAction("deleteTable")}
                style={{
                  padding: "8px 16px",
                  color: vscode.error,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🗑</span> 删除表
              </div>
            </Show>
            <Show when={menu().node.type === "function"}>
              <div
                onClick={() => handleMenuAction("viewFunctionDdl")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📄</span> 查看源码
              </div>
            </Show>
            <Show when={menu().node.type === "view"}>
              <div
                onClick={() => handleMenuAction("viewDdl")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📄</span> 查看 DDL
              </div>
            </Show>
            <Show when={menu().node.type === "table" || menu().node.type === "view"}>
              <div
                onClick={() => handleMenuAction("select")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>▶️</span> SELECT *
              </div>
              <div
                onClick={() => handleMenuAction("selectTop100")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔝</span> SELECT TOP 100
              </div>
              <div
                onClick={() => handleMenuAction("count")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>#️⃣</span> COUNT(*)
              </div>
              <div style={{ height: "1px", "background-color": vscode.border, margin: "4px 0" }} />
            </Show>
            <Show when={menu().node.type === "connection"}>
              <div
                onClick={() => handleMenuAction("newSchema")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>➕</span> 新增 Schema
              </div>
              <div
                onClick={() => handleMenuAction("viewErDiagramFromConnection")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔗</span> 查看 ER 图
              </div>
              <div
                onClick={() => handleMenuAction("backupDatabase")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📦</span> 备份全库
              </div>
              <Show
                when={
                  menu().node.connectionId &&
                  getEffectiveDbCapabilities(menu().node.connectionId).sessionMonitor
                }
              >
                <div
                  onClick={() => handleMenuAction("openPgStat")}
                  style={{
                    padding: "8px 16px",
                    color: vscode.foreground,
                    cursor: "pointer",
                    "font-size": "13px",
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <span>📈</span> 会话与锁监控
                </div>
              </Show>
              <Show
                when={
                  menu().node.connectionId &&
                  getEffectiveDbCapabilities(menu().node.connectionId).pgExtensionCatalog
                }
              >
                <div
                  onClick={() => handleMenuAction("openExtensions")}
                  style={{
                    padding: "8px 16px",
                    color: vscode.foreground,
                    cursor: "pointer",
                    "font-size": "13px",
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <span>🧩</span> 扩展管理
                </div>
              </Show>
              <div
                onClick={() => handleMenuAction("openQuery")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📝</span> 新建查询
              </div>
              <div
                onClick={() => handleMenuAction("refreshConnection")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔄</span> 刷新
              </div>
              <div
                onClick={() => handleMenuAction("disconnect")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔌</span> 断开连接
              </div>
            </Show>
            <Show when={menu().node.type === "savedConnection"}>
              <div
                onClick={() => handleMenuAction("editSaved")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>✏️</span> 编辑
              </div>
              <div
                onClick={() => handleMenuAction("connectSaved")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔌</span> 连接
              </div>
              <div
                onClick={() => handleMenuAction("removeSaved")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🗑</span> 删除
              </div>
            </Show>
            <Show when={menu().node.type === "schema"}>
              <div
                onClick={() => handleMenuAction("viewErDiagram")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔗</span> 查看 ER 图
              </div>
              <div
                onClick={() => handleMenuAction("backupSchema")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>📦</span> 备份 Schema
              </div>
              <div
                onClick={() => handleMenuAction("refresh")}
                style={{
                  padding: "8px 16px",
                  color: vscode.foreground,
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔄</span> 刷新
              </div>
              <Show
                when={
                  !!menu().node.schema &&
                  !!menu().node.connectionId &&
                  !isSystemSchema(menu().node.connectionId!, menu().node.schema!)
                }
              >
                <div style={{ height: "1px", "background-color": vscode.border, margin: "4px 0" }} />
                <div
                  onClick={() => handleMenuAction("deleteSchema")}
                  style={{
                    padding: "8px 16px",
                    color: vscode.error,
                    cursor: "pointer",
                    "font-size": "13px",
                    display: "flex",
                    "align-items": "center",
                    gap: "8px",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.listHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                >
                  <span>🗑</span> 删除 Schema
                </div>
              </Show>
            </Show>
          </div>
        )}
      </Show>

      <Show when={createSchemaModalCid()}>
        {(() => {
          const cid = createSchemaModalCid()!;
          return (
            <CreateSchemaModal
              connectionId={cid}
              onClose={() => setCreateSchemaModalCid(null)}
              onSuccess={(id) => reloadConnectionSchemaList(id)}
            />
          );
        })()}
      </Show>
      <Show when={deleteSchemaModal()}>
        {(() => {
          const m = deleteSchemaModal()!;
          return (
            <DeleteSchemaModal
              connectionId={m.connectionId}
              schema={m.schema}
              onClose={() => setDeleteSchemaModal(null)}
              onSuccess={(id) => {
                props.onMysqlSchemaRemoved?.(m.connectionId, m.schema);
                reloadConnectionSchemaList(id);
              }}
            />
          );
        })()}
      </Show>
      <Show when={deleteModal()}>
        {(() => {
          const m = deleteModal()!;
          return (
            <DeleteTableModal
              connectionId={m.connectionId}
              schema={m.schema}
              table={m.table}
              onClose={() => setDeleteModal(null)}
              onSuccess={(connectionId, schema) => props.onRequestSchemaRefresh?.(connectionId, schema)}
            />
          );
        })()}
      </Show>
      <Show when={truncateModal()}>
        {(() => {
          const m = truncateModal()!;
          return (
            <TruncateTableModal
              connectionId={m.connectionId}
              schema={m.schema}
              table={m.table}
              onClose={() => setTruncateModal(null)}
              onSuccess={(connectionId, schema) => props.onRequestSchemaRefresh?.(connectionId, schema)}
            />
          );
        })()}
      </Show>
      <Show when={copyModal()}>
        {(() => {
          const m = copyModal()!;
          return (
            <CopyTableModal
              connectionId={m.connectionId}
              schema={m.schema}
              table={m.table}
              onClose={() => setCopyModal(null)}
              onSuccess={(connectionId, schema) => props.onRequestSchemaRefresh?.(connectionId, schema)}
            />
          );
        })()}
      </Show>
      <Show when={fakeDataModal()}>
        {(() => {
          const m = fakeDataModal()!;
          return (
            <FakeDataModal
              connectionId={m.connectionId}
              schema={m.schema}
              table={m.table}
              onClose={() => setFakeDataModal(null)}
              onSuccess={() => props.onRequestSchemaRefresh?.(m.connectionId, m.schema)}
            />
          );
        })()}
      </Show>
      <Show when={backupModal()}>
        {(() => {
          const m = backupModal()!;
          return (
            <BackupModal
              connectionId={m.connectionId}
              schema={m.schema}
              onClose={() => setBackupModal(null)}
              onSuccess={() => {}}
            />
          );
        })()}
      </Show>
      <Show when={erDiagramModal()}>
        {(() => {
          const m = erDiagramModal()!;
          return (
            <ErDiagramModal
              connectionId={m.connectionId}
              schema={"schema" in m ? m.schema : undefined}
              selection={"selection" in m ? m.selection : undefined}
              onClose={() => setErDiagramModal(null)}
            />
          );
        })()}
      </Show>
      <Show when={erDiagramPickerModal()}>
        {(() => {
          const p = erDiagramPickerModal()!;
          const connectionId = p.connectionId;
          return (
            <ErDiagramPickerModal
              connectionId={connectionId}
              onClose={() => setErDiagramPickerModal(null)}
              onConfirm={(selection) => {
                setErDiagramPickerModal(null);
                setErDiagramModal({ connectionId, selection });
              }}
            />
          );
        })()}
      </Show>
      <Show when={partitionTableModal()}>
        {(() => {
          const m = partitionTableModal()!;
          return (
            <PartitionTableModal
              connectionId={m.connectionId}
              schema={m.schema}
              table={m.table}
              onClose={() => setPartitionTableModal(null)}
            />
          );
        })()}
      </Show>
      <Show when={pgStatModal()}>
        {(() => {
          const m = pgStatModal()!;
          return <PgStatModal connectionId={m.connectionId} onClose={() => setPgStatModal(null)} />;
        })()}
      </Show>
      <Show when={extensionsModal()}>
        {(() => {
          const m = extensionsModal()!;
          return <ExtensionsModal connectionId={m.connectionId} onClose={() => setExtensionsModal(null)} />;
        })()}
      </Show>

      {/* 底部状态栏 */}
      <div
        style={{
          padding: "8px 16px",
          "border-top": `1px solid ${vscode.border}`,
          "font-size": "11px",
          color: vscode.foregroundDim,
          display: "flex",
          "justify-content": "space-between",
        }}
      >
        <span>Connections: {state.nodes.length}</span>
        <span>💡 双击表查询 · 双击函数查看源码</span>
      </div>
      </div>
    </div>
  );
}
