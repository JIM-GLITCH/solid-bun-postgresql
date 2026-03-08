import { createSignal, Show, For, onMount } from 'solid-js';
import Resizable from '@corvu/resizable';
import ConnectionForm from './connection-form';
import QueryInterface from './query-interface';
import DatabaseNavigator from './database-navigator';
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
  connectionId: string;
  connectionInfo: string;
}

export default function App() {
  const [connections, setConnections] = createSignal<ConnectionInfo[]>([]);
  const [savedConnections, setSavedConnections] = createSignal<StoredConnection[]>([]);
  const [externalQuery, setExternalQuery] = createSignal<{ connectionId: string; sql: string } | null>(null);
  const [showConnectionForm, setShowConnectionForm] = createSignal(false);
  const [connectingSavedId, setConnectingSavedId] = createSignal<string | null>(null);
  const [queryTabs, setQueryTabs] = createSignal<QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

  onMount(() => {
    loadStoredConnections().then(setSavedConnections);
  });

  const handleConnected = (connectionId: string, info: string) => {
    setConnections((prev) => [...prev, { id: connectionId, info }]);
    setShowConnectionForm(false);
  };

  const handleSavedRefresh = () => {
    loadStoredConnections().then(setSavedConnections);
  };

  const handleConnectFromSaved = async (stored: StoredConnection) => {
    const already = connections().some((c) => c.id === stored.id);
    if (already) {
      addOrFocusQueryTab(stored.id, stored.label);
      return;
    }
    setConnectingSavedId(stored.id);
    try {
      const { success, connectionId, error } = await connectFromSaved(stored.id);
      if (success && connectionId) {
        setConnections((prev) => [...prev, { id: connectionId, info: stored.label }]);
        setShowConnectionForm(false);
      } else {
        alert(`连接失败: ${error ?? '未知错误'}`);
      }
    } catch (e) {
      alert(`连接失败: ${e instanceof Error ? e.message : String(e)}`);
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
    const remainingTabs = queryTabs().filter((t) => t.connectionId !== connectionId);
    setQueryTabs(remainingTabs);
    const currentTab = queryTabs().find((t) => t.id === activeTabId());
    if (currentTab?.connectionId === connectionId) {
      setActiveTabId(remainingTabs[0]?.id ?? null);
    }
      setConnections((prev) => prev.filter((c) => c.id !== connectionId));
  };

  const addOrFocusQueryTab = (connectionId: string, connectionInfo: string, initialSql?: string) => {
    const tabs = queryTabs();
    const existing = tabs.find((t) => t.connectionId === connectionId);
    if (existing) {
      setActiveTabId(existing.id);
      if (initialSql) setExternalQuery({ connectionId, sql: initialSql });
      return;
    }
    const conn = connections().find((c) => c.id === connectionId);
    const info = conn?.info ?? connectionInfo;
    const tab: QueryTab = { id: connectionId, connectionId, connectionInfo: info };
    setQueryTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    if (initialSql) setExternalQuery({ connectionId, sql: initialSql });
  };

  const removeQueryTab = (tabId: string) => {
    setQueryTabs((prev) => prev.filter((t) => t.id !== tabId));
    if (activeTabId() === tabId) {
      const remaining = queryTabs().filter((t) => t.id !== tabId);
      setActiveTabId(remaining[0]?.id ?? null);
    }
  };

  const handleOpenQueryTab = (connectionId: string, connectionInfo: string) => {
    addOrFocusQueryTab(connectionId, connectionInfo);
  };

  const handleQueryRequest = (connectionId: string, sql: string) => {
    addOrFocusQueryTab(connectionId, "", sql);
  };

  // 当前高亮的连接：有标签页时取当前标签的连接，否则为 null
  const activeConnectionIdForSidebar = () => {
    const tab = queryTabs().find((t) => t.id === activeTabId());
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
          <DatabaseNavigator
            connections={connections}
            savedConnections={savedConnections}
            activeConnectionId={activeConnectionIdForSidebar()}
            onAddConnection={handleAddConnection}
            onDisconnect={handleDisconnect}
            onQueryRequest={handleQueryRequest}
            onOpenQueryTab={handleOpenQueryTab}
            onConnectFromSaved={handleConnectFromSaved}
            connectingSavedId={connectingSavedId()}
            onRemoveSaved={handleRemoveSaved}
            onCollapse={() => {}}
          />
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
          <Show when={connections().length > 0} fallback={
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
            <Show when={queryTabs().length > 0} fallback={
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
                  <For each={queryTabs()}>
                    {(tab) => {
                      const isActive = () => activeTabId() === tab.id;
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
                          <span style={{ 'font-size': '12px' }}>📝</span>
                          <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis' }}>{tab.connectionInfo}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeQueryTab(tab.id); }}
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
                  <For each={queryTabs()}>
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
                        <QueryInterface
                          activeConnectionId={() => tab.connectionId}
                          externalQuery={() => {
                            const ext = externalQuery();
                            if (!ext || ext.connectionId !== tab.connectionId) return null;
                            return ext;
                          }}
                          onExternalQueryHandled={clearExternalQuery}
                        />
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
