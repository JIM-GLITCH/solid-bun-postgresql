/**
 * VS Code 风格：数据库导航器
 * - 单一标题「数据库」，始终保持树状结构
 * - 树根：新建连接 + 已保存连接（节点）+ 活跃连接（可展开 schema/表）
 */
import type { Accessor } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { vscode } from './theme';
import Resizable from '@corvu/resizable';
import Sidebar from './sidebar';
import type { ConnectionInfo } from './app';
import type { StoredConnection } from './connection-storage';

interface DatabaseNavigatorProps {
  connections: Accessor<ConnectionInfo[]>;
  savedConnections: Accessor<StoredConnection[]>;
  activeConnectionId: string | null;
  onAddConnection: () => void;
  onDisconnect?: (connectionId: string) => void;
  onQueryRequest?: (connectionId: string, sql: string) => void;
  onOpenQueryTab?: (connectionId: string, connectionInfo: string) => void;
  onConnectFromSaved?: (stored: StoredConnection) => void;
  onRemoveSaved?: (id: string) => void;
  connectingSavedId?: string | null;
  onCollapse?: () => void;
}

export default function DatabaseNavigator(props: DatabaseNavigatorProps) {
  const panel = Resizable.usePanelContext();
  const onCollapse = () => panel.collapse();
  const collapsed = () => panel.collapsed();
  const [refreshTrigger, setRefreshTrigger] = createSignal(0);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Show when={collapsed()}>
        <button
          onClick={() => panel.expand()}
          title="展开侧边栏"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            padding: '8px',
            border: 'none',
            background: 'none',
            color: vscode.foregroundDim,
            cursor: 'pointer',
            'font-size': '14px',
            'z-index': 1,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
          onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
        >
          »
        </button>
      </Show>
    <div
      style={{
        width: '100%',
        height: '100%',
        'background-color': vscode.sidebarBg,
        'border-right': `1px solid ${vscode.border}`,
        display: collapsed() ? 'none' : 'flex',
        'flex-direction': 'column',
        'user-select': 'none',
      }}
    >
      {/* 单一标题栏：数据库 */}
      <div
        style={{
          padding: '10px 12px',
          'border-bottom': `1px solid ${vscode.border}`,
          'flex-shrink': 0,
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
        }}
      >
        <span style={{ 'font-size': '14px' }}>🗄️</span>
        <span style={{ 'font-size': '13px', color: vscode.foreground, 'font-weight': '600' }}>数据库</span>
        <div style={{ 'margin-left': 'auto', display: 'flex', gap: '4px' }}>
          <button
            onClick={props.onAddConnection}
            style={{ background: 'none', border: 'none', color: vscode.foregroundDim, cursor: 'pointer', padding: '4px', 'font-size': '14px' }}
            title="添加数据库连接"
            onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
            onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
          >➕</button>
          <Show when={props.connections().length > 0}>
            <button
              onClick={() => setRefreshTrigger((n) => n + 1)}
              style={{ background: 'none', border: 'none', color: vscode.foregroundDim, cursor: 'pointer', padding: '4px', 'font-size': '14px' }}
              title="刷新"
              onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
              onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
            >🔄</button>
          </Show>
          <button
            onClick={onCollapse}
            style={{ background: 'none', border: 'none', color: vscode.foregroundDim, cursor: 'pointer', padding: '4px', 'font-size': '14px' }}
            title="收起侧边栏"
            onMouseEnter={(e) => (e.currentTarget.style.color = vscode.foreground)}
            onMouseLeave={(e) => (e.currentTarget.style.color = vscode.foregroundDim)}
          >◀</button>
        </div>
      </div>

      {/* 始终显示树状结构 */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', 'flex-direction': 'column' }}>
        <Sidebar
          connections={props.connections}
          savedConnections={props.savedConnections}
          activeConnectionId={props.activeConnectionId}
          onDisconnect={props.onDisconnect}
          onQueryRequest={props.onQueryRequest}
          onOpenQueryTab={props.onOpenQueryTab}
          onAddConnection={props.onAddConnection}
          onConnectFromSaved={props.onConnectFromSaved}
          onRemoveSaved={props.onRemoveSaved}
          connectingSavedId={props.connectingSavedId}
          refreshTrigger={refreshTrigger}
          hideHeader
        />
      </div>
    </div>
    </div>
  );
}
