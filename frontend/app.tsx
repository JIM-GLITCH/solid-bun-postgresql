import { createSignal, Show, For, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import Resizable from '@corvu/resizable';
import ConnectionForm from './connection-form';
import QueryInterface from './query-interface';
import TableDesigner from './table-designer';
import DdlViewer from './ddl-viewer';
import Sidebar from './sidebar';
import { disconnectPostgres } from './api';
import {
  loadStoredConnections,
  connectFromSaved,
  removeStoredConnection,
  type StoredConnection,
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

export type Tab = QueryTab | DesignTableTab | DdlViewTab | FunctionDdlTab;

export default function App() {
  const [connections, setConnections] = createStore<ConnectionInfo[]>([]);
  const [savedConnections, setSavedConnections] = createSignal<StoredConnection[]>([]);
  const [externalQuery, setExternalQuery] = createSignal<{ connectionId: string; sql: string } | null>(null);
  const [showConnectionForm, setShowConnectionForm] = createSignal(false);
  const [connectingSavedId, setConnectingSavedId] = createSignal<string | null>(null);
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);
  const [refreshSidebarRequest, setRefreshSidebarRequest] = createSignal<{ connectionId: string; schema: string } | null>(null);

  onMount(() => {
    loadStoredConnections().then(setSavedConnections);
  });

  const handleConnected = (connectionId: string, info: string) => {
    setConnections(connections.length, { id: connectionId, info });
    setShowConnectionForm(false);
  };

  const handleSavedRefresh = () => {
    loadStoredConnections().then(setSavedConnections);
  };

  const handleConnectFromSaved = async (stored: StoredConnection): Promise<{ success: boolean; connectionId?: string }> => {
    const already = connections.some((c) => c.id === stored.id);
    if (already) {
      addOrFocusQueryTab(stored.id, stored.label);
      return { success: true, connectionId: stored.id };
    }
    setConnectingSavedId(stored.id);
    try {
      const { success, connectionId, error } = await connectFromSaved(stored.id);
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

  const handleAddConnection = () => {
    setShowConnectionForm(true);
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
          <Show when={connections.length > 0} fallback={
            /* 未连接时：主区域显示连接表单或欢迎页 */
            <Show when={showConnectionForm()} fallback={
              <div style={{
                flex: 1,
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                padding: '24px',
                'background-color': vscode.editorBg,
              }}>
                <div style={{
                  color: vscode.foregroundDim,
                  'font-size': '13px',
                  'text-align': 'center',
                  'max-width': '320px',
                }}>
                  点击左侧「新建 PostgreSQL 连接」添加数据库连接
                </div>
              </div>
            }>
              <div style={{
                flex: 1,
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                padding: '24px',
                'background-color': vscode.editorBg,
              }}>
                <div style={{
                  width: '100%',
                  'max-width': '480px',
                  padding: '24px',
                  'background-color': vscode.sidebarBg,
                  'border': `1px solid ${vscode.border}`,
                }}>
                  <ConnectionForm onConnected={handleConnected} onSaved={handleSavedRefresh} />
                </div>
              </div>
            </Show>
          }>
            <Show when={showConnectionForm()}>
              <div style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                'background-color': 'rgba(0,0,0,0.5)',
                'z-index': 100,
              }}>
                <div style={{
                  width: '100%',
                  'max-width': '480px',
                  padding: '24px',
                  'background-color': vscode.sidebarBg,
                  'border': `1px solid ${vscode.border}`,
                  position: 'relative',
                }}>
                  <button
                    onClick={() => setShowConnectionForm(false)}
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      padding: '4px 12px',
                      'font-size': '12px',
                      'background-color': vscode.buttonSecondary,
                      color: vscode.foreground,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = vscode.buttonSecondaryHover)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = vscode.buttonSecondary)}
                  >
                    取消
                  </button>
                  <ConnectionForm onConnected={handleConnected} onSaved={handleSavedRefresh} />
                </div>
              </div>
            </Show>
            <Show when={tabs().length > 0} fallback={
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
            }>
              <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column', overflow: 'hidden' }}>
                {/* Tab 栏 - VS Code 风格 */}
                <div style={{
                  display: 'flex',
                  'align-items': 'flex-end',
                  gap: '0',
                  'background-color': vscode.tabBarBg,
                  'border-bottom': `1px solid ${vscode.border}`,
                  'flex-shrink': 0,
                  overflow: 'auto',
                }}>
                  <For each={tabs()}>
                    {(tab) => {
                      const isActive = () => activeTabId() === tab.id;
                      const tabLabel = () =>
                        tab.type === 'query'
                          ? tab.connectionInfo
                          : tab.type === 'ddl-view'
                            ? `DDL: ${tab.schema}.${tab.table}`
                            : tab.type === 'function-ddl'
                              ? `函数: ${tab.schema}.${tab.function}`
                              : tab.mode === 'create'
                                ? `设计表: ${tab.schema}.新建`
                                : `设计表: ${tab.schema}.${tab.table}`;
                      const tabIcon = () => (tab.type === 'query' ? '📝' : tab.type === 'ddl-view' ? '📄' : tab.type === 'function-ddl' ? 'ƒ' : '📋');
                      return (
                        <div
                          onClick={() => setActiveTabId(tab.id)}
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
                          <button
                            onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
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
                        </div>
                      );
                    }}
                  </For>
                </div>
                <div style={{ flex: 1, overflow: 'hidden', 'min-height': 0, position: 'relative' }}>
                  <For each={tabs()}>
                    {(tab) => (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: activeTabId() === tab.id ? 'flex' : 'none',
                          'flex-direction': 'column',
                          overflow: 'hidden',
                        }}
                      >
                        {tab.type === 'query' ? (
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
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </Show>
        </Resizable.Panel>
      </Resizable>
    </main>
  );
}
