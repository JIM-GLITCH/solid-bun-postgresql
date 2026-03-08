import { createSignal, Show } from 'solid-js';
import Resizable from '@corvu/resizable';
import ConnectionForm from './connection-form';
import QueryInterface from './query-interface';
import DatabaseNavigator from './database-navigator';
import { disconnectPostgres } from './api';

export interface ConnectionInfo {
  id: string;
  info: string;
}

export default function App() {
  const [connections, setConnections] = createSignal<ConnectionInfo[]>([]);
  const [activeConnectionId, setActiveConnectionId] = createSignal<string | null>(null);
  const [externalQuery, setExternalQuery] = createSignal<{ connectionId: string; sql: string } | null>(null);
  const [showConnectionForm, setShowConnectionForm] = createSignal(false);

  const handleConnected = (connectionId: string, info: string) => {
    setConnections((prev) => [...prev, { id: connectionId, info }]);
    setActiveConnectionId(connectionId);
    setShowConnectionForm(false);
  };

  const handleDisconnect = async (connectionId: string) => {
    try {
      await disconnectPostgres(connectionId);
    } catch (e) {
      console.warn("断开连接 API 调用失败:", e);
    }
    setConnections((prev) => {
      const next = prev.filter((c) => c.id !== connectionId);
      if (activeConnectionId() === connectionId) {
        setActiveConnectionId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleQueryRequest = (connectionId: string, sql: string) => {
    setActiveConnectionId(connectionId);
    setExternalQuery({ connectionId, sql });
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
            activeConnectionId={activeConnectionId()}
            onAddConnection={handleAddConnection}
            onDisconnect={handleDisconnect}
            onQueryRequest={handleQueryRequest}
            onSetActiveConnection={setActiveConnectionId}
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
                  <ConnectionForm onConnected={handleConnected} />
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
                  <ConnectionForm onConnected={handleConnected} />
                </div>
              </div>
            </Show>
            <QueryInterface
              activeConnectionId={() => activeConnectionId()}
              externalQuery={() => externalQuery()}
              onExternalQueryHandled={clearExternalQuery}
            />
          </Show>
        </Resizable.Panel>
      </Resizable>
    </main>
  );
}
