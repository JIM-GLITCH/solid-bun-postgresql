/**
 * CloudBeaver 风格：数据库导航器
 * - 未连接时：显示「新建连接」入口
 * - 已连接时：显示连接列表及 schema/表树
 */
import { Show } from 'solid-js';
import Resizable from '@corvu/resizable';
import Sidebar from './sidebar';
import type { ConnectionInfo } from './app';

interface DatabaseNavigatorProps {
  connections: ConnectionInfo[];
  activeConnectionId: string | null;
  onAddConnection: () => void;
  onDisconnect?: (connectionId: string) => void;
  onQueryRequest?: (connectionId: string, sql: string) => void;
  onSetActiveConnection?: (connectionId: string) => void;
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
          /* 未连接：显示新建连接区域 */
          <div
            style={{
              flex: 1,
              padding: '12px',
              display: 'flex',
              'flex-direction': 'column',
              gap: '12px',
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
            <div
              style={{
                color: '#6e7681',
                'font-size': '12px',
                'line-height': 1.5,
                padding: '0 4px',
              }}
            >
              点击「新建连接」添加数据库，连接后可在左侧浏览 schema 和表。
            </div>
          </div>
        }
      >
        {/* 已连接：表树，每个连接一个顶层节点 */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', 'flex-direction': 'column' }}>
          <Sidebar
            connections={props.connections}
            activeConnectionId={props.activeConnectionId}
            onDisconnect={props.onDisconnect}
            onQueryRequest={props.onQueryRequest}
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
