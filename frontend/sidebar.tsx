import { createSignal, For, Show, createEffect } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { getSchemas, getTables, getColumns, getIndexes } from "./api";
import type { ConnectionInfo } from "./app";

// 数据库对象类型
type NodeType = "connection" | "schema" | "tables" | "views" | "table" | "view" | "column" | "indexes" | "index";

interface TreeNode {
  id: string;
  name: string;
  type: NodeType;
  schema?: string;
  table?: string;
  connectionId?: string;
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
  activeConnectionId?: string | null;
  onDisconnect?: (connectionId: string) => void;
  onQueryRequest?: (connectionId: string, sql: string) => void;
  onSetActiveConnection?: (connectionId: string) => void;
  onCollapse?: () => void;
  onAddConnection?: () => void;
}

// 图标组件
function NodeIcon(props: { type: NodeType }) {
  const icons: Record<NodeType, string> = {
    connection: "🔌",
    schema: "📁",
    tables: "📋",
    views: "👁️",
    table: "📊",
    view: "👓",
    column: "📎",
    indexes: "🔑",
    index: "🏷️",
  };
  return <span style={{ "margin-right": "6px", "font-size": "14px" }}>{icons[props.type]}</span>;
}

export default function Sidebar(props: SidebarProps) {
  const initialNodes = (): TreeNode[] =>
    props.connections.map((c) => ({
      id: `connection:${c.id}`,
      name: c.info,
      type: "connection" as NodeType,
      connectionId: c.id,
      children: [],
    }));

  const [state, setState] = createStore<TreeState>({
    nodes: initialNodes(),
    expandedIds: new Set<string>(),
    loadingIds: new Set(),
    loadedIds: new Set(),
    selectedId: null,
  });

  const [searchTerm, setSearchTerm] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<{ x: number; y: number; node: TreeNode } | null>(null);

  // 连接列表变化时重建顶层节点（保留已加载的 children）
  createEffect(() => {
    const conns = props.connections;
    setState(produce((s) => {
      s.nodes = conns.map((c) => {
        const existing = s.nodes.find((n) => n.connectionId === c.id || n.id === `connection:${c.id}`);
        if (existing) return { ...existing, name: c.info };
        return { id: `connection:${c.id}`, name: c.info, type: "connection" as NodeType, connectionId: c.id, children: [] };
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
      current[path[path.length - 1]].children = newChildren;
    }));
  }

  // 加载 schemas，挂到指定连接节点下
  async function loadSchemas(connectionId: string, connectionNodeId: string) {
    try {
      const data = await getSchemas(connectionId);
      if (data.schemas) {
        const schemaNodes: TreeNode[] = data.schemas.map((schema: string) => ({
          id: `schema:${connectionId}:${schema}`,
          name: schema,
          type: "schema" as NodeType,
          schema,
          connectionId,
          children: [
            { id: `tables:${connectionId}:${schema}`, name: "Tables", type: "tables" as NodeType, schema, connectionId, children: [] },
            { id: `views:${connectionId}:${schema}`, name: "Views", type: "views" as NodeType, schema, connectionId, children: [] },
          ],
        }));
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
    } catch (e) {
      console.error("加载表失败:", e);
    }
  }

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

    // 只有可展开的节点才触发展开/折叠
    const canExpand = node.type === "connection" || node.type === "schema" || node.type === "table" || node.type === "view" ||
      node.type === "tables" || node.type === "views" || node.type === "indexes";
    if (canExpand) {
      toggleNode(node);
    }

    // 双击表/视图时发送查询
    const cid = node.connectionId;
    if (e.detail === 2 && (node.type === "table" || node.type === "view") && node.schema && node.table && cid) {
      const sql = `SELECT * FROM ${node.schema}.${node.table}`;
      props.onQueryRequest?.(cid, sql);
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
      case "setActive":
        if (node.type === "connection" && cid) {
          props.onSetActiveConnection?.(cid);
        }
        break;
      case "disconnect":
        if (node.type === "connection" && cid) {
          props.onDisconnect?.(cid);
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

  // 渲染单个节点
  function renderNode(node: TreeNode, depth: number = 0) {
    const isExpanded = () => state.expandedIds.has(node.id);
    const isLoading = () => state.loadingIds.has(node.id);
    const isSelected = () => state.selectedId === node.id;
    const hasChildren = () => node.children.length > 0;
    const canExpand = node.type === "schema" || node.type === "table" || node.type === "view" ||
      node.type === "tables" || node.type === "views" || node.type === "indexes";

    return (
      <div>
        <div
          onClick={(e) => handleNodeClick(node, e)}
          onContextMenu={(e) => handleContextMenu(node, e)}
          style={{
            display: "flex",
            "align-items": "center",
            padding: "4px 8px",
            "padding-left": `${depth * 16 + 8}px`,
            cursor: "pointer",
            "background-color": isSelected() ? "#2d4a7c" : "transparent",
            color: isSelected() ? "#fff" : "#c9d1d9",
            "border-radius": "4px",
            "margin": "1px 4px",
            "font-size": "13px",
            "font-family": "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
            transition: "background-color 0.15s ease",
          }}
          onMouseEnter={(e) => !isSelected() && (e.currentTarget.style.backgroundColor = "#1c2e4a")}
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
              color: "#6e7681",
              "font-size": "10px",
              transition: "transform 0.2s ease",
              transform: isExpanded() ? "rotate(90deg)" : "rotate(0deg)",
            }}
          >
            {canExpand ? (isLoading() ? "⏳" : "▶") : ""}
          </span>

          <NodeIcon type={node.type} />

          <span style={{
            flex: 1,
            overflow: "hidden",
            "text-overflow": "ellipsis",
            "white-space": "nowrap"
          }}>
            {node.name}
          </span>

          {/* 计数徽章 */}
          <Show when={hasChildren() && isExpanded()}>
            <span style={{
              "font-size": "10px",
              color: "#6e7681",
              "background-color": "#21262d",
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
    <div
      style={{
        width: "100%",
        height: "100%",
        "background-color": "#0d1117",
        "border-right": "1px solid #21262d",
        display: "flex",
        "flex-direction": "column",
        "user-select": "none",
      }}
      onClick={closeContextMenu}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: "12px 16px",
          "border-bottom": "1px solid #21262d",
          display: "flex",
          "align-items": "center",
          gap: "8px",
        }}
      >
        <span style={{ "font-size": "14px" }}>🗄️</span>
        <span
          style={{
            color: "#c9d1d9",
            "font-weight": "600",
            "font-size": "14px",
            "letter-spacing": "0.5px",
          }}
        >
          Database Navigator
        </span>
        <div style={{ "margin-left": "auto", display: "flex", gap: "4px" }}>
          <Show when={props.onAddConnection}>
            <button
              onClick={() => props.onAddConnection?.()}
              style={{
                background: "none",
                border: "none",
                color: "#6e7681",
                cursor: "pointer",
                padding: "4px",
                "border-radius": "4px",
                "font-size": "14px",
              }}
              title="添加数据库连接"
              onMouseEnter={(e) => (e.currentTarget.style.color = "#c9d1d9")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6e7681")}
            >
              ➕
            </button>
          </Show>
          <button
            onClick={() => {
              state.nodes.filter((n) => n.type === "connection").forEach((n) => {
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
            }}
            style={{
              background: "none",
              border: "none",
              color: "#6e7681",
              cursor: "pointer",
              padding: "4px",
              "border-radius": "4px",
              "font-size": "14px",
            }}
            title="刷新"
            onMouseEnter={(e) => (e.currentTarget.style.color = "#c9d1d9")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "#6e7681")}
          >
            🔄
          </button>
          <Show when={props.onCollapse}>
            <button
              onClick={() => props.onCollapse?.()}
              style={{
                background: "none",
                border: "none",
                color: "#6e7681",
                cursor: "pointer",
                padding: "4px",
                "border-radius": "4px",
                "font-size": "14px",
              }}
              title="收起侧边栏"
              onMouseEnter={(e) => (e.currentTarget.style.color = "#c9d1d9")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#6e7681")}
            >
              ◀
            </button>
          </Show>
        </div>
      </div>

      {/* 搜索框 */}
      <div style={{ padding: "8px 12px", "border-bottom": "1px solid #21262d" }}>
        <input
          type="text"
          placeholder="🔍 搜索表、视图..."
          value={searchTerm()}
          onInput={(e) => setSearchTerm(e.currentTarget.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            "background-color": "#161b22",
            border: "1px solid #30363d",
            "border-radius": "6px",
            color: "#c9d1d9",
            "font-size": "12px",
            outline: "none",
            "box-sizing": "border-box",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "#58a6ff")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "#30363d")}
        />
      </div>

      {/* 树形结构 */}
      <div
        style={{
          flex: 1,
          "overflow-y": "auto",
          "overflow-x": "hidden",
          padding: "8px 0",
        }}
      >
        <Show when={filteredTree().length > 0} fallback={
          <div style={{
            padding: "20px",
            "text-align": "center",
            color: "#6e7681",
            "font-size": "13px"
          }}>
            {searchTerm() ? "未找到匹配项" : "暂无数据，请先连接数据库"}
          </div>
        }>
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
              "background-color": "#161b22",
              border: "1px solid #30363d",
              "border-radius": "8px",
              "box-shadow": "0 8px 24px rgba(0,0,0,0.4)",
              "z-index": "1000",
              "min-width": "180px",
              padding: "4px 0",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Show when={menu().node.type === "table" || menu().node.type === "view"}>
              <div
                onClick={() => handleMenuAction("select")}
                style={{
                  padding: "8px 16px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#21262d")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>▶️</span> SELECT *
              </div>
              <div
                onClick={() => handleMenuAction("selectTop100")}
                style={{
                  padding: "8px 16px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#21262d")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔝</span> SELECT TOP 100
              </div>
              <div
                onClick={() => handleMenuAction("count")}
                style={{
                  padding: "8px 16px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#21262d")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>#️⃣</span> COUNT(*)
              </div>
              <div style={{ height: "1px", "background-color": "#30363d", margin: "4px 0" }} />
            </Show>
            <Show when={menu().node.type === "connection"}>
              <div
                onClick={() => handleMenuAction("setActive")}
                style={{
                  padding: "8px 16px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#21262d")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>✓</span> 设为当前连接
              </div>
              <div
                onClick={() => handleMenuAction("refreshConnection")}
                style={{
                  padding: "8px 16px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#21262d")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔄</span> 刷新
              </div>
              <div
                onClick={() => handleMenuAction("disconnect")}
                style={{
                  padding: "8px 16px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#21262d")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔌</span> 断开连接
              </div>
            </Show>
            <Show when={menu().node.type === "schema"}>
              <div
                onClick={() => handleMenuAction("refresh")}
                style={{
                  padding: "8px 16px",
                  color: "#c9d1d9",
                  cursor: "pointer",
                  "font-size": "13px",
                  display: "flex",
                  "align-items": "center",
                  gap: "8px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#21262d")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span>🔄</span> 刷新
              </div>
            </Show>
          </div>
        )}
      </Show>

      {/* 底部状态栏 */}
      <div
        style={{
          padding: "8px 16px",
          "border-top": "1px solid #21262d",
          "font-size": "11px",
          color: "#6e7681",
          display: "flex",
          "justify-content": "space-between",
        }}
      >
        <span>Connections: {state.nodes.length}</span>
        <span>💡 双击表查询</span>
      </div>
    </div>
  );
}
