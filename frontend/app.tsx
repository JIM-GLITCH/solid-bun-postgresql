import { createSignal, Show, For, onMount, createEffect, onCleanup, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import Resizable from '@corvu/resizable';
import ConnectionForm from './connection-form';
import QueryInterface from './query-interface';
import TableDesigner from './table-designer';
import DdlViewer from './ddl-viewer';
import Sidebar from './sidebar';
import { disconnectPostgres, subscribeEvents } from './api';
import {
  loadStoredConnections,
  connectFromSaved,
  removeStoredConnection,
  type StoredConnection,
  type ConnectionList,
} from './connection-storage';
import { vscode } from './theme';

export interface ConnectionInfo {
  id: string;
  info: string;
}

export interface QueryTab {
  id: string;
  type: "query";
  connectionId: string;
  connectionInfo: string;
}

export interface DesignTableTab {
  id: string;
  type: "design";
  connectionId: string;
  connectionInfo: string;
  schema: string;
  table?: string;
  mode: "create" | "edit";
}

export interface DdlViewTab {
  id: string;
  type: "ddl-view";
  connectionId: string;
  connectionInfo: string;
  schema: string;
  table: string;
  ddl: string;
}

export interface FunctionDdlTab {
  id: string;
  type: "function-ddl";
  connectionId: string;
  connectionInfo: string;
  schema: string;
  function: string;
  ddl: string;
}

export interface ConnectionFormTab {
  id: string;
  type: "connection-form";
}

export interface ConnectionEditTab {
  id: string;
  type: "connection-edit";
  stored: StoredConnection;
}

export type Tab = QueryTab | DesignTableTab | DdlViewTab | FunctionDdlTab | ConnectionFormTab | ConnectionEditTab;

export default function App() {
  const [connections, setConnections] = createStore<ConnectionInfo[]>([]);
  const [savedConnections, setSavedConnections] = createSignal<ConnectionList>([]);
  const [externalQuery, setExternalQuery] = createSignal<{ connectionId: string; sql: string } | null>(null);
  const [showConnectionForm, setShowConnectionForm] = createSignal(false);
  const [connectingSavedId, setConnectingSavedId] = createSignal<string | null>(null);
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);
  const [refreshSidebarRequest, setRefreshSidebarRequest] = createSignal<{ connectionId: string; schema: string } | null>(null);
  const [connectionSwitcherOpen, setConnectionSwitcherOpen] = createSignal(false);
  const [sessionId] = createSignal(crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

  createEffect(() => {
    if (!connectionSwitcherOpen()) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('[data-connection-switcher]')) setConnectionSwitcherOpen(false);
    };
    document.addEventListener('click', close, true);
    onCleanup(() => document.removeEventListener('click', close, true));
  });

  onMount(() => {
    loadStoredConnections().then(setSavedConnections);
  });

  // 为每个连接维持 SSE，关闭标签页时服务端可检测断开并释放 connectionMap 资源
  createEffect(() => {
    const conns = connections;
    const unsubs = conns.map((c) => subscribeEvents(c.id, () => {}));
    return () => unsubs.forEach((u) => u());
  });

  const handleConnected = (connectionId: string, info: string) => {
    setConnections(connections.length, { id: connectionId, info });
    setShowConnectionForm(false);
    const all = tabs();
    const remaining = all.filter((t) => t.type !== "connection-form");
    const wasOnFormTab = all.some((t) => t.type === "connection-form" && t.id === activeTabId());
    setTabs(remaining);
    if (wasOnFormTab) setActiveTabId(remaining[0]?.id ?? null);
  };

  const handleSavedRefresh = () => {
    loadStoredConnections().then(setSavedConnections);
  };

  const handleConnectFromSaved = async (stored: StoredConnection): Promise<{ success: boolean; connectionId?: string }> => {
    const existing = connections.find((c) => c.id === stored.id || c.id.startsWith(stored.id + "-"));
    if (existing) {
      addOrFocusQueryTab(existing.id, stored.label);
      return { success: true, connectionId: existing.id };
    }
    setConnectingSavedId(stored.id);
    try {
      const { success, connectionId, error } = await connectFromSaved(stored.id, sessionId());
      if (success && connectionId) {
        setConnections(connections.length, { id: connectionId, info: stored.label });
        setShowConnectionForm(false);
        return { success: true, connectionId };
      } else {
        alert(`连接失败: ${error ?? '未知错误'}`);
        return { success: false };
      }
    } catch (e) {
      alert(`连接失败: ${e instanceof Error ? e.message : String(e)}`);
      return { success: false };
    } finally {
      setConnectingSavedId(null);
    }
  };

  const handleRemoveSaved = async (id: string) => {
    try {
      await removeStoredConnection(id);
      loadStoredConnections().then(setSavedConnections);
    } catch (e) {
      console.warn('删除失败:', e);
    }
  };

  const handleDisconnect = async (connectionId: string) => {
    try {
      await disconnectPostgres(connectionId);
    } catch (e) {
      console.warn("断开连接 API 调用失败:", e);
    }
    const remainingTabs = tabs().filter((t) => t.connectionId !== connectionId);
    setTabs(remainingTabs);
    const currentTab = tabs().find((t) => t.id === activeTabId());
    if (currentTab?.connectionId === connectionId) {
      setActiveTabId(remainingTabs[0]?.id ?? null);
    }
    setConnections(connections.filter((c) => c.id !== connectionId));
  };

  const addOrFocusQueryTab = (connectionId: string, connectionInfo: string, initialSql?: string) => {
    const allTabs = tabs();
    const existing = allTabs.find((t) => t.type === "query" && t.connectionId === connectionId);
    if (existing) {
      setActiveTabId(existing.id);
      if (initialSql) setExternalQuery({ connectionId, sql: initialSql });
      return;
    }
    const conn = connections.find((c) => c.id === connectionId);
    const info = conn?.info ?? connectionInfo;
    const tab: QueryTab = { id: connectionId, type: "query", connectionId, connectionInfo: info };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    if (initialSql) setExternalQuery({ connectionId, sql: initialSql });
  };

  const addDesignTableTab = (connectionId: string, connectionInfo: string, schema: string, table?: string) => {
    const conn = connections.find((c) => c.id === connectionId);
    const info = conn?.info ?? connectionInfo;
    const mode: "create" | "edit" = table ? "edit" : "create";
    const tabId = `design-${connectionId}-${schema}-${table ?? "new"}-${Date.now()}`;
    const tab: DesignTableTab = { id: tabId, type: "design", connectionId, connectionInfo: info, schema, table, mode };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const addDdlViewTab = (connectionId: string, connectionInfo: string, schema: string, table: string, ddl: string) => {
    const conn = connections.find((c) => c.id === connectionId);
    const info = conn?.info ?? connectionInfo;
    const tabId = `ddl-${connectionId}-${schema}-${table}-${Date.now()}`;
    const tab: DdlViewTab = { id: tabId, type: "ddl-view", connectionId, connectionInfo: info, schema, table, ddl };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const addFunctionDdlTab = (connectionId: string, connectionInfo: string, schema: string, funcName: string, ddl: string) => {
    const conn = connections.find((c) => c.id === connectionId);
    const info = conn?.info ?? connectionInfo;
    const tabId = `func-ddl-${connectionId}-${schema}-${funcName}-${Date.now()}`;
    const tab: FunctionDdlTab = { id: tabId, type: "function-ddl", connectionId, connectionInfo: info, schema, function: funcName, ddl };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const removeTab = (tabId: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeTabId() === tabId) {
      const remaining = tabs().filter((t) => t.id !== tabId);
      setActiveTabId(remaining[0]?.id ?? null);
    }
  };

  const handleOpenQueryTab = (connectionId: string, connectionInfo: string) => {
    addOrFocusQueryTab(connectionId, connectionInfo);
  };

  const handleQueryRequest = (connectionId: string, sql: string) => {
    addOrFocusQueryTab(connectionId, "", sql);
  };

  const handleNewTable = (connectionId: string, connectionInfo: string, schema: string) => {
    addDesignTableTab(connectionId, connectionInfo, schema);
  };

  const handleEditTable = (connectionId: string, connectionInfo: string, schema: string, table: string) => {
    addDesignTableTab(connectionId, connectionInfo, schema, table);
  };

  const handleViewDdl = (connectionId: string, connectionInfo: string, schema: string, table: string, ddl: string) => {
    addDdlViewTab(connectionId, connectionInfo, schema, table, ddl);
  };

  const handleViewFunctionDdl = (connectionId: string, connectionInfo: string, schema: string, funcName: string, ddl: string) => {
    addFunctionDdlTab(connectionId, connectionInfo, schema, funcName, ddl);
  };

  // 当前高亮的连接：有标签页时取当前标签的连接，否则为 null
  const activeConnectionIdForSidebar = () => {
    const tab = tabs().find((t) => t.id === activeTabId());
    return tab?.connectionId ?? null;
  };

  const clearExternalQuery = () => {
    setExternalQuery(null);
  };

  const handleQuickSwitchConnection = (connectionId: string, connectionInfo: string) => {
    addOrFocusQueryTab(connectionId, connectionInfo);
    setConnectionSwitcherOpen(false);
  };

  const handleOpenEditConnection = (stored: StoredConnection) => {
    const existing = tabs().find((t) => t.type === "connection-edit" && t.stored.id === stored.id);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }
    const tabId = `connection-edit-${stored.id}-${Date.now()}`;
    const tab: ConnectionEditTab = { id: tabId, type: "connection-edit", stored };
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const handleAddConnection = () => {
    if (connections.length > 0) {
      const existing = tabs().find((t) => t.type === "connection-form");
      if (existing) {
        setActiveTabId(existing.id);
        return;
      }
      const tabId = `connection-form-${Date.now()}`;
      const tab: ConnectionFormTab = { id: tabId, type: "connection-form" };
      setTabs((prev) => [...prev, tab]);
      setActiveTabId(tab.id);
    } else {
      setShowConnectionForm(true);
    }
  };

  const CONNECTION_FORM_DEFAULT_ID = "connection-form-default";
  const WELCOME_DEFAULT_ID = "welcome-default";

  const showTabBar = () =>
    connections.length > 0 || showConnectionForm() || tabs().some((t) => t.type === "connection-edit");

  const displayTabs = createMemo(() => {
    if (connections.length === 0 && showConnectionForm()) {
      return [{ id: CONNECTION_FORM_DEFAULT_ID, type: "connection-form" }] as ConnectionFormTab[];
    }
    if (connections.length === 0 && tabs().length > 0) return tabs();
    if (connections.length > 0 && tabs().length > 0) return tabs();
    if (connections.length > 0) return [{ id: WELCOME_DEFAULT_ID, type: "connection-form" }] as ConnectionFormTab[];
    return [];
  });

  const displayActiveTabId = createMemo(() => {
    if (connections.length === 0 && showConnectionForm()) return CONNECTION_FORM_DEFAULT_ID;
    if (connections.length === 0 && tabs().length > 0) return activeTabId() ?? tabs()[0]?.id ?? null;
    if (connections.length > 0 && tabs().length > 0) return activeTabId() ?? tabs()[0]?.id ?? null;
    if (connections.length > 0) return WELCOME_DEFAULT_ID;
    return null;
  });

  const isPinnedTab = (id: string) => id === WELCOME_DEFAULT_ID;
  const handleCloseTab = (tabId: string) => {
    if (tabId === CONNECTION_FORM_DEFAULT_ID) setShowConnectionForm(false);
    else removeTab(tabId);
  };

  return (
    <main style={{
      height: '100vh',
      display: 'flex',
      'flex-direction': 'column',
      overflow: 'hidden',
      'background-color': vscode.editorBg,
      'font-family': "'Segoe UI', 'Microsoft YaHei', sans-serif",
    }}>
      {/* 左侧 Database Navigator + 右侧主区域 */}
        <Resizable
        initialSizes={[0.2, 0.8]}
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          'background-color': vscode.editorBg,
        }}
      >
        <Resizable.Panel
          minSize={0.12}
          collapsible
          collapsedSize={0.02}
          style={{
            overflow: 'hidden',
            'background-color': vscode.sidebarBg,
            'border-right': `1px solid ${vscode.border}`,
          }}
        >
          <div data-app-sidebar style={{ height: '100%', overflow: 'auto' }}>
          <Sidebar
            connections={connections}
            savedConnections={savedConnections}
            activeConnectionId={activeConnectionIdForSidebar()}
            refreshSchemaRequest={refreshSidebarRequest}
            onRefreshHandled={() => setRefreshSidebarRequest(null)}
            onAddConnection={handleAddConnection}
            onDisconnect={handleDisconnect}
            onQueryRequest={handleQueryRequest}
            onOpenQueryTab={handleOpenQueryTab}
            onNewTable={handleNewTable}
            onEditTable={handleEditTable}
            onViewDdl={handleViewDdl}
            onViewFunctionDdl={handleViewFunctionDdl}
            onRequestSchemaRefresh={(connectionId, schema) => setRefreshSidebarRequest({ connectionId, schema })}
            onConnectFromSaved={handleConnectFromSaved}
            connectingSavedId={connectingSavedId()}
            onRemoveSaved={handleRemoveSaved}
            onOpenEditConnection={handleOpenEditConnection}
            onRefreshSavedConnections={() => loadStoredConnections().then(setSavedConnections)}
          />
          </div>
        </Resizable.Panel>
        <Resizable.Handle
          aria-label="调整侧边栏宽度"
          style={{
            width: '4px',
            'flex-shrink': 0,
            'background-color': vscode.border,
          }}
        />
        <Resizable.Panel
          minSize={0.3}
          style={{
            overflow: 'hidden',
            display: 'flex',
            'flex-direction': 'column',
            'background-color': vscode.editorBg,
            position: 'relative',
          }}
        >
          <Show when={showTabBar()} fallback={
            <div style={{
              flex: 1,
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              padding: '24px',
              'background-color': vscode.editorBg,
            }}>
              <div style={{ color: vscode.foregroundDim, 'font-size': '13px', 'text-align': 'center', 'max-width': '320px' }}>
                点击左侧「➕」或已保存连接添加数据库连接
              </div>
            </div>
          }>
          <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column', overflow: 'hidden' }}>
            {/* Tab 栏 - 点击新建连接或有连接时显示 */}
            <div style={{
              display: 'flex',
              'align-items': 'flex-end',
              gap: '0',
              'background-color': vscode.tabBarBg,
              'border-bottom': `1px solid ${vscode.border}`,
              'flex-shrink': 0,
              'min-height': 0,
              'overflow-x': 'auto',
              'overflow-y': 'hidden',
            }}>
              <Show when={connections.length > 1}>
                    <div data-connection-switcher style={{ position: 'relative', 'flex-shrink': 0 }}>
                      <button
                        onClick={() => setConnectionSwitcherOpen((v) => !v)}
                        style={{
                          display: 'flex',
                          'align-items': 'center',
                          gap: '6px',
                          padding: '8px 12px',
                          'font-size': '12px',
                          cursor: 'pointer',
                          'background-color': connectionSwitcherOpen() ? vscode.listHover : 'transparent',
                          color: vscode.foregroundDim,
                          border: 'none',
                          'border-right': `1px solid ${vscode.border}`,
                        }}
                        onMouseEnter={(e) => !connectionSwitcherOpen() && (e.currentTarget.style.backgroundColor = vscode.listHover)}
                        onMouseLeave={(e) => !connectionSwitcherOpen() && (e.currentTarget.style.backgroundColor = 'transparent')}
                        title="快速切换连接"
                      >
                        <span>🔌</span>
                        <span>切换</span>
                        <span style={{ 'font-size': '10px' }}>▼</span>
                      </button>
                      <Show when={connectionSwitcherOpen()}>
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            'z-index': 100,
                            'min-width': '200px',
                            'max-height': '280px',
                            overflow: 'auto',
                            'background-color': vscode.sidebarBg,
                            border: `1px solid ${vscode.border}`,
                            'border-radius': '4px',
                            'box-shadow': '0 4px 12px rgba(0,0,0,0.3)',
                            padding: '4px 0',
                          }}
                        >
                          <For each={connections}>
                            {(conn) => (
                              <div
                                onClick={() => handleQuickSwitchConnection(conn.id, conn.info)}
                                style={{
                                  padding: '8px 12px',
                                  'font-size': '13px',
                                  cursor: 'pointer',
                                  color: vscode.foreground,
                                  'white-space': 'nowrap',
                                  overflow: 'hidden',
                                  'text-overflow': 'ellipsis',
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.backgroundColor = vscode.listHover;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.backgroundColor = 'transparent';
                                }}
                              >
                                {conn.info}
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </div>
                  </Show>
                  <For each={displayTabs()}>
                    {(tab) => {
                      const isActive = () => displayActiveTabId() === tab.id;
                      const tabLabel = () =>
                        tab.id === WELCOME_DEFAULT_ID
                          ? '开始'
                          : tab.type === 'query'
                            ? tab.connectionInfo
                            :                             tab.type === 'connection-form'
                              ? '新建连接'
                              : tab.type === 'connection-edit'
                              ? '编辑连接'
                              : tab.type === 'ddl-view'
                              ? `DDL: ${tab.schema}.${tab.table}`
                              : tab.type === 'function-ddl'
                                ? `函数: ${tab.schema}.${tab.function}`
                                : tab.mode === 'create'
                                  ? `设计表: ${tab.schema}.新建`
                                  : `设计表: ${tab.schema}.${tab.table}`;
                      const tabIcon = () => (tab.type === 'query' ? '📝' : tab.type === 'connection-form' || tab.type === 'connection-edit' ? '🔌' : tab.type === 'ddl-view' ? '📄' : tab.type === 'function-ddl' ? 'ƒ' : '📋');
                      return (
                        <div
                          onClick={() => !isPinnedTab(tab.id) && setActiveTabId(tab.id)}
                          style={{
                            display: 'flex',
                            'align-items': 'center',
                            gap: '6px',
                            padding: '8px 16px',
                            'font-size': '13px',
                            cursor: 'pointer',
                            'background-color': isActive() ? vscode.tabActiveBg : 'transparent',
                            color: isActive() ? vscode.foreground : vscode.foregroundDim,
                            'border-right': `1px solid ${vscode.border}`,
                            'max-width': '220px',
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                          }}
                          onMouseEnter={(e) => !isActive() && (e.currentTarget.style.backgroundColor = vscode.listHover)}
                          onMouseLeave={(e) => !isActive() && (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <span style={{ 'font-size': '12px' }}>{tabIcon()}</span>
                          <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis' }}>{tabLabel()}</span>
                          <Show when={!isPinnedTab(tab.id)}>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCloseTab(tab.id); }}
                              style={{
                                padding: '0 4px',
                                background: 'none',
                                border: 'none',
                                color: vscode.foregroundDim,
                                cursor: 'pointer',
                                'font-size': '16px',
                                'line-height': 1,
                              }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
                              onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
                              title="关闭"
                            >
                              ×
                            </button>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
                <div style={{ flex: 1, overflow: 'hidden', 'min-height': 0, position: 'relative' }}>
                  <For each={displayTabs()}>
                    {(tab) => (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: displayActiveTabId() === tab.id ? 'flex' : 'none',
                          'flex-direction': 'column',
                          'min-height': 0,
                          overflow: 'hidden',
                        }}
                      >
                        <div style={{ flex: 1, 'min-height': 0, 'overflow-y': 'auto', 'overflow-x': 'hidden' }}>
                        {tab.id === CONNECTION_FORM_DEFAULT_ID ? (
                          <div style={{ padding: '24px', 'background-color': vscode.editorBg }}>
                              <div style={{ margin: '0 auto', maxWidth: '560px' }}>
                                <ConnectionForm onConnected={handleConnected} onSaved={handleSavedRefresh} />
                              </div>
                          </div>
                        ) : tab.id === WELCOME_DEFAULT_ID ? (
                          <div style={{
                            flex: 1,
                            display: 'flex',
                            'align-items': 'center',
                            'justify-content': 'center',
                            color: vscode.foregroundDim,
                            'font-size': '13px',
                          }}>
                            右键点击左侧数据库连接 → 选择「新建查询」打开查询窗口
                          </div>
                        ) : tab.type === 'connection-form' ? (
                          <div style={{ padding: '24px', 'background-color': vscode.editorBg }}>
                              <div style={{ margin: '0 auto', maxWidth: '560px' }}>
                                <ConnectionForm onConnected={handleConnected} onSaved={handleSavedRefresh} />
                              </div>
                          </div>
                        ) : tab.type === 'connection-edit' ? (
                          <div style={{ padding: '24px', 'background-color': vscode.editorBg }}>
                              <div style={{ margin: '0 auto', maxWidth: '560px' }}>
                                <ConnectionForm
                                  editStored={tab.stored}
                                  onConnected={(connectionId, info) => {
                                    handleConnected(connectionId, info);
                                    const remaining = tabs().filter((t) => t.id !== tab.id);
                                    setTabs(remaining);
                                    if (activeTabId() === tab.id) setActiveTabId(remaining[0]?.id ?? null);
                                  }}
                                  onSaved={() => {
                                    handleSavedRefresh();
                                    const remaining = tabs().filter((t) => t.id !== tab.id);
                                    setTabs(remaining);
                                    if (activeTabId() === tab.id) setActiveTabId(remaining[0]?.id ?? null);
                                  }}
                                />
                              </div>
                          </div>
                        ) : tab.type === 'query' ? (
                          <QueryInterface
                            activeConnectionId={() => tab.connectionId}
                            isActiveTab={() => activeTabId() === tab.id}
                            externalQuery={() => {
                              const ext = externalQuery();
                              if (!ext || ext.connectionId !== tab.connectionId) return null;
                              return ext;
                            }}
                            onExternalQueryHandled={clearExternalQuery}
                          />
                        ) : tab.type === 'ddl-view' ? (
                          <DdlViewer schema={tab.schema} table={tab.table} ddl={tab.ddl} />
                        ) : tab.type === 'function-ddl' ? (
                          <DdlViewer schema={tab.schema} table={tab.function} ddl={tab.ddl} title={`函数: ${tab.schema}.${tab.function}`} />
                        ) : (
                          <TableDesigner
                            connectionId={tab.connectionId}
                            connectionInfo={tab.connectionInfo}
                            schema={tab.schema}
                            table={tab.table}
                            mode={tab.mode}
                            onSuccess={(connectionId, schema) => setRefreshSidebarRequest({ connectionId, schema })}
                          />
                        )}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
          </div>
          </Show>
        </Resizable.Panel>
      </Resizable>
    </main>
  );
}
