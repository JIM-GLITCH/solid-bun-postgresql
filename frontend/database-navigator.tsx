/**
 * CloudBeaver 风格：数据库导航器
 * - 未连接时：显示「新建连接」入口 + 已保存连接
 * - 已连接时：显示连接列表及 schema/表树 + 已保存连接
 */
import { For, Show } from 'solid-js';
import Resizable from '@corvu/resizable';
import Sidebar from './sidebar';
import type { ConnectionInfo } from './app';
import type { StoredConnection } from './connection-storage';

interface DatabaseNavigatorProps {
  connections: ConnectionInfo[];
  savedConnections: StoredConnection[];
  activeConnectionId: string | null;
  onAddConnection: () => void;
  onDisconnect?: (connectionId: string) => void;
  onQueryRequest?: (connectionId: string, sql: string) => void;
  onOpenQueryTab?: (connectionId: string, connectionInfo: string) => void;
  onSetActiveConnection?: (connectionId: string) => void;
  onConnectFromSaved?: (stored: StoredConnection) => void;
  onRemoveSaved?: (id: string) => void;
  connectingSavedId?: string | null;
  onCollapse?: () => void;
}

export default function DatabaseNavigator(props: DatabaseNavigatorProps) {
  const panel = Resizable.usePanelContext();
  const onCollapse = () => panel.collapse();
  const collapsed = () => panel.collapsed();

  return (
    <Show
      when={!collapsed()}
      fallback={
        <button
          onClick={() => panel.expand()}
          title="展开侧边栏"
          style={{
            width: '100%',
            height: '100%',
            padding: '8px',
            border: 'none',
            background: 'none',
            color: '#6e7681',
            cursor: 'pointer',
            'font-size': '14px',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = '#c9d1d9')}
          onMouseLeave={(e) => (e.currentTarget.style.color = '#6e7681')}
        >
          »
        </button>
      }
    >
    <div
      style={{
        width: '100%',
        height: '100%',
        'background-color': '#0d1117',
        'border-right': '1px solid #21262d',
        display: 'flex',
        'flex-direction': 'column',
        'user-select': 'none',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          padding: '10px 12px',
          'border-bottom': '1px solid #21262d',
          'flex-shrink': 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '6px',
            'font-size': '13px',
            color: '#94a3b8',
            'font-weight': '600',
          }}
        >
          <span>🗄️</span>
          <span>数据库连接</span>
        </div>
      </div>

      <Show
        when={props.connections.length > 0}
        fallback={
          /* 未连接：显示新建连接 + 已保存连接 */
          <div
            style={{
              flex: 1,
              padding: '12px',
              display: 'flex',
              'flex-direction': 'column',
              gap: '12px',
              overflow: 'auto',
            }}
          >
            <button
              onClick={props.onAddConnection}
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '8px',
                padding: '10px 12px',
                'font-size': '13px',
                'background-color': '#238636',
                color: '#fff',
                border: 'none',
                'border-radius': '6px',
                cursor: 'pointer',
                width: '100%',
                'text-align': 'left',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#2ea043';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = '#238636';
              }}
            >
              <span style={{ 'font-size': '16px' }}>➕</span>
              新建 PostgreSQL 连接
            </button>
            <Show when={props.savedConnections.length > 0}>
              <div style={{ 'font-size': '12px', color: '#6e7681', 'margin-top': '4px' }}>
                已保存的连接
              </div>
              <For each={props.savedConnections}>
                {(stored) => (
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '6px',
                      padding: '8px 10px',
                      'font-size': '12px',
                      'background-color': '#161b22',
                      'border-radius': '6px',
                      border: '1px solid #21262d',
                    }}
                  >
                    <button
                      onClick={() => props.onConnectFromSaved?.(stored)}
                      disabled={props.connectingSavedId === stored.id}
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        'text-align': 'left',
                        color: '#c9d1d9',
                        background: 'none',
                        border: 'none',
                        cursor: props.connectingSavedId === stored.id ? 'wait' : 'pointer',
                        'font-size': '12px',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                        'white-space': 'nowrap',
                        opacity: props.connectingSavedId === stored.id ? 0.7 : 1,
                      }}
                      title={stored.label}
                    >
                      {props.connectingSavedId === stored.id ? '⏳ ' : '🔌 '}{stored.label}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); props.onRemoveSaved?.(stored.id); }}
                      title="删除"
                      style={{
                        padding: '4px',
                        color: '#6e7681',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        'font-size': '12px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = '#f87171')}
                      onMouseLeave={(e) => (e.currentTarget.style.color = '#6e7681')}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </For>
            </Show>
            <div
              style={{
                color: '#6e7681',
                'font-size': '12px',
                'line-height': 1.5,
                padding: '0 4px',
              }}
            >
              点击「新建连接」或已保存连接添加数据库。
            </div>
          </div>
        }
      >
        {/* 已连接：已保存的快捷连接 + 表树 */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', 'flex-direction': 'column' }}>
          <Show when={props.savedConnections.length > 0}>
            <div style={{ padding: '8px 12px', 'border-bottom': '1px solid #21262d', 'flex-shrink': 0 }}>
              <div style={{ 'font-size': '11px', color: '#6e7681', 'margin-bottom': '6px' }}>已保存</div>
              <For each={props.savedConnections}>
                {(stored) => (
                  <div
                    style={{
                      display: 'flex',
                      'align-items': 'center',
                      gap: '4px',
                      marginBottom: '4px',
                    }}
                  >
                    <button
                      onClick={() => props.onConnectFromSaved?.(stored)}
                      disabled={props.connectingSavedId === stored.id}
                      style={{
                        flex: 1,
                        padding: '4px 8px',
                        'text-align': 'left',
                        color: '#94a3b8',
                        background: props.connections.some((c) => c.id === stored.id) ? '#238636' : '#21262d',
                        border: '1px solid #30363d',
                        'border-radius': '4px',
                        cursor: props.connectingSavedId === stored.id ? 'wait' : 'pointer',
                        'font-size': '11px',
                        overflow: 'hidden',
                        'text-overflow': 'ellipsis',
                      }}
                      title={stored.label}
                    >
                      {props.connectingSavedId === stored.id ? '⏳ ' : props.connections.some((c) => c.id === stored.id) ? '● ' : ''}{stored.label}
                    </button>
                    <button
                      onClick={() => props.onRemoveSaved?.(stored.id)}
                      title="删除"
                      style={{ padding: '2px 4px', color: '#6e7681', background: 'none', border: 'none', cursor: 'pointer', 'font-size': '10px' }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Sidebar
            connections={props.connections}
            activeConnectionId={props.activeConnectionId}
            onDisconnect={props.onDisconnect}
            onQueryRequest={props.onQueryRequest}
            onOpenQueryTab={props.onOpenQueryTab}
            onSetActiveConnection={props.onSetActiveConnection}
            onCollapse={onCollapse}
            onAddConnection={props.onAddConnection}
          />
        </div>
      </Show>
    </div>
    </Show>
  );
}
