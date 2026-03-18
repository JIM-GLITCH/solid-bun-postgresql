import type { Accessor } from "solid-js";
import { createSignal, For, Show, createEffect, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import Resizable from "@corvu/resizable";
import { getSchemas, getTables, getColumns, getIndexes, getTableDdl, getFunctionDdl } from "./api";
import RenameTableModal from "./rename-table-modal";
import CopyTableModal from "./copy-table-modal";
import DeleteTableModal from "./delete-table-modal";
import TruncateTableModal from "./truncate-table-modal";
import FakeDataModal from "./fake-data-modal";
import BackupModal from "./backup-modal";
import ErDiagramModal from "./er-diagram-modal";
import ErDiagramPickerModal from "./er-diagram-picker-modal";
import type { ErDiagramSelection } from "./er-diagram-modal";
import type { ConnectionInfo } from "./app";
import { findStoredConnection, hasStoredConnection, createGroup, updateStoredConnectionMeta, type ConnectionList, type StoredConnection, type StoredConnectionItem, type StoredConnectionGroup } from "./connection-storage";
import { vscode } from "./theme";

// 数据库对象类型
type NodeType = "connectionGroup" | "savedConnection" | "connection" | "schema" | "tables" | "views" | "functions" | "table" | "view" | "function" | "column" | "indexes" | "index";

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
}

// 图标组件
function NodeIcon(props: { type: NodeType }) {
  const icons: Record<NodeType, string> = {
    connectionGroup: "📁",
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
  const panel = Resizable.usePanelContext();
  const onCollapse = () => panel.collapse();
  const collapsed = () => panel.collapsed();

  // 获取连接显示名称
  const getConnectionDisplayName = (s: StoredConnection, connInfo?: string) =>
    connInfo ?? (s.name?.trim() || s.label);

  function isGroupNode(node: unknown): node is { group: string; connections: StoredConnectionItem[] } {
    const o = node as Record<string, unknown>;
    return o != null && Array.isArray(o.connections) && typeof o.group === "string";
  }

  /** 连接是否来自某已保存配置（含多实例：id 或 id-xxx） */
  function isConnFromStored(connId: string, storedId: string): boolean {
    return connId === storedId || connId.startsWith(storedId + "-");
  }
  /** 连接是否已挂在某个 saved 节点下 */
  function isConnShownUnderSaved(connId: string, saved: ConnectionList): boolean {
    for (const node of saved) {
      const ids = isGroupNode(node)
        ? (node as StoredConnectionGroup).connections.map((c: StoredConnectionItem) => c.id)
        : [(node as StoredConnectionItem).id];
      for (const id of ids) {
        if (isConnFromStored(connId, id)) return true;
      }
    }
    return false;
  }

  // 构建统一树根：直接解析嵌套结构 ConnectionList
  function buildRootNodes(): TreeNode[] {
    const conns = props.connections ?? [];
    const saved = props.savedConnections?.() ?? [];
    const roots: TreeNode[] = [];

    for (const node of saved) {
      if (isGroupNode(node)) {
        const groupChildren: TreeNode[] = [];
        for (const s of node.connections) {
          const matchingConns = conns.filter((c) => isConnFromStored(c.id, s.id));
          if (matchingConns.length > 0) {
            for (const c of matchingConns) {
              const displayName = getConnectionDisplayName(s, c.info);
              groupChildren.push({ id: `connection:${c.id}`, name: displayName, type: "connection", connectionId: c.id, storedId: s.id, children: [] });
            }
          } else {
            groupChildren.push({ id: `saved:${s.id}`, name: getConnectionDisplayName(s, undefined), type: "savedConnection", storedId: s.id, children: [] });
          }
        }
        roots.push({ id: `group:${node.group}`, name: node.group, type: "connectionGroup", children: groupChildren });
      } else {
        const s = node as StoredConnectionItem;
        const matchingConns = conns.filter((c) => isConnFromStored(c.id, s.id));
        if (matchingConns.length > 0) {
          for (const c of matchingConns) {
            const displayName = getConnectionDisplayName(s, c.info);
            roots.push({ id: `connection:${c.id}`, name: displayName, type: "connection", connectionId: c.id, storedId: s.id, children: [] });
          }
        } else {
          roots.push({ id: `saved:${s.id}`, name: getConnectionDisplayName(s, undefined), type: "savedConnection", storedId: s.id, children: [] });
        }
      }
    }

    for (const c of conns) {
      if (!isConnShownUnderSaved(c.id, saved)) {
        roots.push({
          id: `connection:${c.id}`,
          name: c.info,
          type: "connection",
          connectionId: c.id,
          children: [],
        });
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
  const [renameModal, setRenameModal] = createSignal<{ connectionId: string; connectionInfo: string; schema: string; table: string } | null>(null);
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
  const [dragOverGroupId, setDragOverGroupId] = createSignal<string | null>(null);
  const [dragOverUngroup, setDragOverUngroup] = createSignal(false);

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

  // 递归收集所有 connection 节点
  function* allConnectionNodes(nodes: TreeNode[]): Generator<TreeNode> {
    for (const n of nodes) {
      if (n.type === "connection") yield n;
      for (const c of n.children) yield* allConnectionNodes([c]);
    }
  }

  // 刷新所有连接
  function refreshAll() {
    [...allConnectionNodes(state.nodes)].forEach((n) => {
      const cid = n.connectionId ?? n.id.replace("connection:", "");
      if (cid) {
        setState("loadedIds", (prev) => {
          const s = new Set(prev);
          s.delete(n.id);
          return s;
        });
        loadSchemas(cid, n.id);
      }
    });
  }

  // 响应外部刷新触发

  // 递归收集节点及其所有子节点的 ID
  function collectNodeIds(node: TreeNode): string[] {
    const ids = [node.id];
    for (const child of node.children) {
      ids.push(...collectNodeIds(child));
    }
    return ids;
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
      
      // 递归收集所有要删除的连接节点的 ID（包括子节点）
      const nodeIdsToRemove = new Set<string>();
      for (const node of allConnectionNodes(s.nodes)) {
        if (node.connectionId && !connIds.has(node.connectionId)) {
          collectNodeIds(node).forEach((id) => nodeIdsToRemove.add(id));
        }
      }
      
      // 清除这些节点的 loadedIds
      s.loadedIds = new Set([...s.loadedIds].filter((id) => !nodeIdsToRemove.has(id)));
      
      s.nodes = newRoots.map((r) => {
        if (r.type === "connectionGroup") {
          return {
            ...r,
            children: r.children.map((conn) => {
              if (conn.type !== "connection" || !conn.connectionId) return conn;
              const existing = [...allConnectionNodes(s.nodes)].find(
                (n) => n.id === conn.id || (n.connectionId === conn.connectionId && n.type === "connection")
              );
              if (existing?.children?.length) return { ...conn, children: existing.children };
              return conn;
            }),
          };
        }
        if (r.type === "connection" && r.connectionId) {
          const existing = [...allConnectionNodes(s.nodes)].find(
            (n) => n.id === r.id || (n.connectionId === r.connectionId && n.type === "connection")
          );
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

  // 加载 schemas，挂到指定连接节点下（刷新时保留已加载的 tables/views）
  async function loadSchemas(connectionId: string, connectionNodeId: string) {
    try {
      const data = await getSchemas(connectionId);
      if (data.schemas) {
        const connNode = findNode(state.nodes, connectionNodeId);
        const existingSchemas = connNode?.children ?? [];
        const schemaNodes: TreeNode[] = data.schemas.map((schema: string) => {
          const schemaId = `schema:${connectionId}:${schema}`;
          const existing = existingSchemas.find((s) => s.id === schemaId);
          const tablesNode = existing?.children?.find((c) => c.type === "tables") ?? { id: `tables:${connectionId}:${schema}`, name: "Tables", type: "tables" as NodeType, schema, connectionId, children: [] };
          const viewsNode = existing?.children?.find((c) => c.type === "views") ?? { id: `views:${connectionId}:${schema}`, name: "Views", type: "views" as NodeType, schema, connectionId, children: [] };
          const functionsNode = existing?.children?.find((c) => c.type === "functions") ?? { id: `functions:${connectionId}:${schema}`, name: "Functions", type: "functions" as NodeType, schema, connectionId, children: [] };
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
    loadTables(req.connectionId, req.schema).finally(() => props.onRefreshHandled?.());
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

    const canExpand = node.type === "connectionGroup" || node.type === "connection" || node.type === "savedConnection" || node.type === "schema" || node.type === "table" || node.type === "view" ||
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
          setState("loadedIds", (prev) => {
            const s = new Set(prev);
            s.delete(node.id);
            return s;
          });
          loadSchemas(cid, node.id);
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
      case "createNewGroup": {
        closeContextMenu();
        const name = prompt("请输入分组名称");
        if (name?.trim()) {
          createGroup(name.trim())
            .then(() => props.onRefreshSavedConnections?.())
            .catch((e) => console.warn("创建分组失败:", e));
        }
        return;
      }
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
          const conn = props.connections.find((c) => c.id === cid);
          setRenameModal({
            connectionId: cid,
            connectionInfo: conn?.info ?? node.name,
            schema: node.schema,
            table: node.table,
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
        if (action.startsWith("moveToGroup:")) {
          const targetGroup = action.slice("moveToGroup:".length);
          const storedId = node.storedId ?? (node.type === "connection" ? node.connectionId : null);
          if (storedId && targetGroup) {
            updateStoredConnectionMeta(storedId, { group: targetGroup })
              .then(() => props.onRefreshSavedConnections?.())
              .catch((e) => console.warn("移动失败:", e));
          }
        } else if (action === "moveToGroupNew") {
          closeContextMenu();
          const storedId = node.storedId ?? (node.type === "connection" ? node.connectionId : null);
          if (storedId) {
            const name = prompt("请输入新分组名称");
            if (name?.trim()) {
              createGroup(name.trim())
                .then(() => updateStoredConnectionMeta(storedId, { group: name.trim() }))
                .then(() => props.onRefreshSavedConnections?.())
                .catch((e) => console.warn("操作失败:", e));
            }
          }
          return;
        }
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

  // 拖拽：连接 -> 分组
  function handleDragStart(e: DragEvent, node: TreeNode) {
    const storedId = node.storedId ?? (node.type === "connection" ? node.connectionId : null);
    if (storedId) {
      e.dataTransfer?.setData("text/plain", storedId);
      e.dataTransfer!.effectAllowed = "move";
    }
  }
  function handleDragOver(e: DragEvent, node: TreeNode) {
    if (node.type === "connectionGroup" && e.dataTransfer?.types.includes("text/plain")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverGroupId(node.id);
    }
  }
  function handleDragLeave() {
    setDragOverGroupId(null);
    setDragOverUngroup(false);
  }
  function handleDrop(e: DragEvent, node: TreeNode) {
    setDragOverGroupId(null);
    setDragOverUngroup(false);
    if (node.type !== "connectionGroup") return;
    e.preventDefault();
    const storedId = e.dataTransfer?.getData("text/plain");
    if (!storedId) return;
    const groupName = node.name;
    updateStoredConnectionMeta(storedId, { group: groupName })
      .then(() => props.onRefreshSavedConnections?.())
      .catch((err) => console.warn("移动失败:", err));
  }
  function handleUngroupDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes("text/plain")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverUngroup(true);
    }
  }
  function handleUngroupDrop(e: DragEvent) {
    setDragOverUngroup(false);
    e.preventDefault();
    const storedId = e.dataTransfer?.getData("text/plain");
    if (!storedId) return;
    updateStoredConnectionMeta(storedId, { group: "" })
      .then(() => props.onRefreshSavedConnections?.())
      .catch((err) => console.warn("移出分组失败:", err));
  }

  // 渲染单个节点
  function renderNode(node: TreeNode, depth: number = 0) {
    const isExpanded = () => state.expandedIds.has(node.id);
    const isLoading = () => state.loadingIds.has(node.id) || (node.type === "savedConnection" && node.storedId === props.connectingSavedId);
    const isSelected = () => state.selectedId === node.id;
    const hasChildren = () => node.children.length > 0;
    const canExpand = node.type === "connectionGroup" || node.type === "connection" || node.type === "savedConnection" || node.type === "schema" || node.type === "table" || node.type === "view" ||
      node.type === "tables" || node.type === "views" || node.type === "functions" || node.type === "indexes";
    const isDraggable = (node.type === "savedConnection" || node.type === "connection") && !!node.storedId;
    const isDropTarget = node.type === "connectionGroup" && dragOverGroupId() === node.id;

    return (
      <div>
        <div
          draggable={isDraggable}
          onDragStart={(e) => isDraggable && handleDragStart(e, node)}
          onDragOver={(e) => handleDragOver(e, node)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node)}
          onClick={(e) => handleNodeClick(node, e)}
          onContextMenu={(e) => handleContextMenu(node, e)}
          style={{
            display: "flex",
            "align-items": "center",
            padding: "4px 8px",
            "padding-left": `${depth * 16 + 8}px`,
            cursor: isDraggable ? "grab" : "pointer",
            "background-color": isDropTarget ? vscode.listHover : isSelected() ? vscode.listSelect : "transparent",
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
                onClick={refreshAll}
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
          <Show when={filteredTree().some((n) => n.type === "connectionGroup")}>
            <div
              onDragOver={handleUngroupDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleUngroupDrop}
              style={{
                padding: "6px 8px",
                "border-radius": "4px",
                margin: "1px 4px",
                "font-size": "12px",
                color: vscode.foregroundDim,
                "background-color": dragOverUngroup() ? vscode.listHover : "transparent",
                border: `1px dashed ${dragOverUngroup() ? vscode.accent : vscode.border}`,
                transition: "all 0.15s ease",
              }}
            >
              📤 拖放到此处移出分组
            </div>
          </Show>
          <For each={filteredTree()}>
            {(node) => renderNode(node, 0)}
          </For>
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
            <Show when={menu().node.type === "connectionGroup" || menu().node.type === "savedConnection" || menu().node.type === "connection"}>
              <div
                onClick={() => handleMenuAction("createNewGroup")}
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
                <span>📁</span> 新建分组
              </div>
            </Show>
            <Show when={(menu().node.type === "savedConnection" || menu().node.type === "connection") && menu().node.storedId}>
              <div style={{ "font-size": "12px", color: vscode.foregroundDim, padding: "4px 16px" }}>移动到分组</div>
              <For each={(() => {
                const list = props.savedConnections?.() ?? [];
                const groups: string[] = [];
                for (const n of list) {
                  if (isGroupNode(n)) groups.push(n.group);
                }
                return groups;
              })()}>
                {(g) => (
                  <div
                    onClick={() => handleMenuAction(`moveToGroup:${g}`)}
                    style={{
                      padding: "6px 16px 6px 24px",
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
                    <span>📁</span> {g}
                  </div>
                )}
              </For>
              <div
                onClick={() => handleMenuAction("moveToGroupNew")}
                style={{
                  padding: "6px 16px 6px 24px",
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
                <span>➕</span> 新建分组并移动
              </div>
              <Show when={(() => {
                const sid = menu().node.storedId;
                if (!sid) return false;
                const stored = findStoredConnection(props.savedConnections?.() ?? [], sid);
                return !!stored?.group;
              })()}>
                <div
                  onClick={() => handleMenuAction("moveToGroup:")}
                  style={{
                    padding: "6px 16px 6px 24px",
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
                  <span>📤</span> 移出分组
                </div>
              </Show>
              <div style={{ height: "1px", "background-color": vscode.border, margin: "4px 0" }} />
            </Show>
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
            </Show>
          </div>
        )}
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
      <Show when={renameModal()}>
        {(() => {
          const m = renameModal()!;
          return (
            <RenameTableModal
              connectionId={m.connectionId}
              schema={m.schema}
              table={m.table}
              onClose={() => setRenameModal(null)}
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
