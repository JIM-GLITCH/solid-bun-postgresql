import { createSignal, Show, For, onMount } from 'solid-js';
import Resizable from '@corvu/resizable';
import ConnectionForm from './connection-form';
import QueryInterface from './query-interface';
import DatabaseNavigator from './database-navigator';
import { disconnectPostgres, connectPostgres } from './api';
import {
  loadStoredConnections,
  saveConnection,
  decryptConnection,
  removeStoredConnection,
  type StoredConnection,
} from './connection-storage';

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
  const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);
  const [externalQuery, setExternalQuery] = createSignal<{ connectionId: string; sql: string } | null>(null);
  const [showConnectionForm, setShowConnectionForm] = createSignal(false);
  const [connectingSavedId, setConnectingSavedId] = createSignal<string | null>(null);
  const [queryTabs, setQueryTabs] = createSignal<QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string | null>(null);

  onMount(() => {
    setSavedConnections(loadStoredConnections());
  });

  const handleConnected = (connectionId: string, info: string) => {
    setConnections((prev) => [...prev, { id: connectionId, info }]);
    setActiveConnectionId(connectionId);
    setShowConnectionForm(false);
  };

  const handleSavedRefresh = () => {
    setSavedConnections(loadStoredConnections());
  };

  const handleConnectFromSaved = async (stored: StoredConnection) => {
    const already = connections().some((c) => c.id === stored.id);
    if (already) {
      setActiveConnectionId(stored.id);
      return;
    }
    setConnectingSavedId(stored.id);
    try {
      const params = await decryptConnection(stored);
      const { id, ...loginParams } = params;
      const { sucess, error: err } = await connectPostgres(id, loginParams);
      if (sucess) {
        setConnections((prev) => [...prev, { id, info: stored.label }]);
        setActiveConnectionId(id);
        setShowConnectionForm(false);
      } else {
        alert(`连接失败: ${err ?? '未知错误'}`);
      }
    } catch (e) {
      alert(`连接失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnectingSavedId(null);
    }
  };

  const handleRemoveSaved = (id: string) => {
    removeStoredConnection(id);
    setSavedConnections(loadStoredConnections());
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
    setConnections((prev) => {
      const next = prev.filter((c) => c.id !== connectionId);
      if (activeConnectionId() === connectionId) {
        setActiveConnectionId(next[0]?.id ?? null);
      }
      return next;
    });
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
    setActiveConnectionId(connectionId);
    addOrFocusQueryTab(connectionId, "", sql);
  };

  const clearExternalQuery = () => {
    setExternalQuery(null);
  };

  const handleAddConnection = () => {
    setShowConnectionForm(true);
  };

  const activeConn = () => connections().find((c) => c.id === activeConnectionId());

  return (
    <main style={{
      height: '100vh',
      display: 'flex',
      'flex-direction': 'column',
      overflow: 'hidden',
      'background-color': '#0f172a',
    }}>
      {/* 顶部工具栏 */}
      <header style={{
        'flex-shrink': 0,
        height: '40px',
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        padding: '0 16px',
        'background-color': '#1e293b',
        'border-bottom': '1px solid #334155',
      }}>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '12px' }}>
          <span style={{ color: '#e2e8f0', 'font-weight': '600', 'font-size': '14px' }}>
            数据库
          </span>
          <span style={{ color: '#64748b', 'font-size': '12px' }}>|</span>
          <Show when={connections().length > 0} fallback={
            <span style={{ color: '#94a3b8', 'font-size': '13px' }}>未连接</span>
          }>
            <span style={{ color: '#22c55e', 'font-size': '12px' }}>●</span>
            <span style={{ color: '#94a3b8', 'font-size': '13px' }}>
              {activeConn()?.info ?? `${connections().length} 个连接`}
            </span>
            {activeConnectionId() && (
              <ConnectionForm
                compact
                connectionId={activeConnectionId()!}
                connectionInfo={activeConn()?.info}
                onConnected={() => {}}
                onDisconnect={handleDisconnect}
              />
            )}
          </Show>
        </div>
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <Show when={connections().length > 0}>
            <button
              onClick={handleAddConnection}
              style={{
                padding: '4px 10px',
                'font-size': '12px',
                'background-color': '#238636',
                color: '#fff',
                border: 'none',
                'border-radius': '4px',
                cursor: 'pointer',
              }}
            >
              ➕ 添加连接
            </button>
          </Show>
        </div>
      </header>

      {/* CloudBeaver 风格：左侧 Database Navigator + 右侧主区域 */}
      <Resizable
        initialSizes={[0.2, 0.8]}
        style={{
          flex: 1,
          display: 'flex',
          overflow: 'hidden',
          'background-color': '#0f172a',
        }}
      >
        <Resizable.Panel
          minSize={0.12}
          collapsible
          collapsedSize={0.02}
          style={{
            overflow: 'hidden',
            'background-color': '#0d1117',
            'border-right': '1px solid #21262d',
          }}
        >
          <DatabaseNavigator
            connections={connections()}
            savedConnections={savedConnections()}
            activeConnectionId={activeConnectionId()}
            onAddConnection={handleAddConnection}
            onDisconnect={handleDisconnect}
            onQueryRequest={handleQueryRequest}
            onOpenQueryTab={handleOpenQueryTab}
            onSetActiveConnection={setActiveConnectionId}
            onConnectFromSaved={handleConnectFromSaved}
            connectingSavedId={connectingSavedId()}
            onRemoveSaved={handleRemoveSaved}
            onCollapse={() => {}}
          />
        </Resizable.Panel>
        <Resizable.Handle
          aria-label="调整侧边栏宽度"
          style={{
            width: '5px',
            'flex-shrink': 0,
            'background-color': 'transparent',
          }}
        />
        <Resizable.Panel
          minSize={0.3}
          style={{
            overflow: 'hidden',
            display: 'flex',
            'flex-direction': 'column',
            'background-color': '#0f172a',
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
                'background-color': '#0f172a',
              }}>
                <div style={{
                  color: '#94a3b8',
                  'font-size': '15px',
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
                'background-color': '#0f172a',
              }}>
                <div style={{
                  width: '100%',
                  'max-width': '480px',
                  padding: '32px',
                  'background-color': '#1e293b',
                  'border-radius': '12px',
                  'border': '1px solid #334155',
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
                'background-color': 'rgba(0,0,0,0.6)',
                'z-index': 100,
              }}>
                <div style={{
                  width: '100%',
                  'max-width': '480px',
                  padding: '32px',
                  'background-color': '#1e293b',
                  'border-radius': '12px',
                  'border': '1px solid #334155',
                  position: 'relative',
                }}>
                  <button
                    onClick={() => setShowConnectionForm(false)}
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      padding: '4px 8px',
                      'font-size': '12px',
                      'background-color': '#334155',
                      color: '#e2e8f0',
                      border: 'none',
                      'border-radius': '4px',
                      cursor: 'pointer',
                    }}
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
                color: '#64748b',
                'font-size': '14px',
              }}>
                右键点击左侧数据库连接 → 选择「新建查询」打开查询窗口
              </div>
            }>
              <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column', overflow: 'hidden' }}>
                <div style={{
                  display: 'flex',
                  'align-items': 'center',
                  gap: '2px',
                  padding: '4px 8px',
                  'background-color': '#1e293b',
                  'border-bottom': '1px solid #334155',
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
                            padding: '6px 12px',
                            'font-size': '13px',
                            cursor: 'pointer',
                            'background-color': isActive() ? '#334155' : 'transparent',
                            color: isActive() ? '#fff' : '#94a3b8',
                            'border-radius': '4px',
                            'max-width': '200px',
                            overflow: 'hidden',
                            'text-overflow': 'ellipsis',
                            'white-space': 'nowrap',
                          }}
                          onMouseEnter={(e) => !isActive() && (e.currentTarget.style.backgroundColor = '#2d3748')}
                          onMouseLeave={(e) => !isActive() && (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <span style={{ 'font-size': '12px' }}>📝</span>
                          <span style={{ overflow: 'hidden', 'text-overflow': 'ellipsis' }}>{tab.connectionInfo}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); removeQueryTab(tab.id); }}
                            style={{
                              padding: '2px',
                              background: 'none',
                              border: 'none',
                              color: '#64748b',
                              cursor: 'pointer',
                              'font-size': '14px',
                              'line-height': 1,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                            onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
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
