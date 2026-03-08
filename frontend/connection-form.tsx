import { For, createSignal, Show } from 'solid-js';
import { connectPostgres } from './api';
import { saveConnection } from './connection-storage';
import { vscode } from './theme';
import type { PostgresLoginParams } from '../shared/src';

function generateConnectionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const fields: Array<{ key: keyof PostgresLoginParams; label: string; desc: string; example: string }> = [
  { key: 'host', label: 'host', desc: '数据库主机名或 IP', example: 'localhost' },
  { key: 'port', label: 'port', desc: '数据库端口', example: '5432' },
  { key: 'database', label: 'database', desc: '数据库名称', example: 'mydb' },
  { key: 'username', label: 'username', desc: '数据库用户', example: 'postgres' },
  { key: 'password', label: 'password', desc: '数据库密码', example: 'secret' },
];

const initForm = (): PostgresLoginParams =>
  fields.reduce<PostgresLoginParams>((acc, f) => {
    acc[f.key] = f.example ?? '';
    return acc;
  }, {} as PostgresLoginParams);

interface ConnectionFormProps {
  onConnected: (connectionId: string, info: string) => void;
  onSaved?: () => void;
  compact?: boolean;
  connectionInfo?: string;
  connectionId?: string;
  onDisconnect?: (connectionId: string) => void;
}

export default function ConnectionForm(props: ConnectionFormProps) {
  const [form, setForm] = createSignal<PostgresLoginParams>(initForm());
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [rememberPassword, setRememberPassword] = createSignal(false);

  const onChange = (key: keyof PostgresLoginParams, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
  };

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const connectionId = props.connectionId ?? generateConnectionId();
      const { sucess, error: err } = await connectPostgres(connectionId, form());
      if (sucess) {
        const p = form();
        if (rememberPassword()) {
          try {
            await saveConnection(connectionId, p);
            props.onSaved?.();
          } catch (e) {
            console.warn('保存连接失败:', e);
          }
        }
        props.onConnected(connectionId, `${p.username}@${p.host}:${p.port}/${p.database}`);
      } else {
        setError(String(err ?? '连接失败'));
      }
    } catch (e: any) {
      setError(e?.message ?? '连接失败');
    } finally {
      setConnecting(false);
    }
  };

  if (props.compact && props.connectionId) {
    return (
      <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
        <span style={{ color: vscode.foreground, 'font-size': '13px' }}>
          {props.connectionInfo || 'PostgreSQL 已连接'}
        </span>
        {props.onDisconnect && (
          <button
            onClick={() => props.onDisconnect?.(props.connectionId!)}
            style={{
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
            断开
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{
      padding: '20px',
      'background-color': vscode.sidebarBg,
      'border': `1px solid ${vscode.border}`,
    }}>
      <h2 style={{ 'margin': '0 0 16px 0', 'font-size': '16px', color: vscode.foreground }}>
        PostgreSQL 连接
      </h2>
      <Show when={error()}>
        <div style={{ color: vscode.error, 'margin-bottom': '12px', 'font-size': '13px' }}>
          {error()}
        </div>
      </Show>
      <table style={{ 'border-collapse': 'collapse', width: '100%', 'max-width': '600px' }}>
        <thead>
          <tr>
            <th style={{ 'text-align': 'left', padding: '8px 12px 8px 0', color: vscode.foreground, 'font-size': '13px' }}>字段</th>
            <th style={{ 'text-align': 'left', padding: '8px 12px 8px 0', color: vscode.foreground, 'font-size': '13px' }}>说明</th>
            <th style={{ 'text-align': 'left', padding: '8px 0', color: vscode.foreground, 'font-size': '13px' }}>值</th>
          </tr>
        </thead>
        <tbody>
          <For each={fields}>
            {(field) => (
              <tr>
                <td style={{ padding: '8px 12px 8px 0', color: vscode.foreground }}>{field.label}</td>
                <td style={{ padding: '8px 12px 8px 0', color: vscode.foregroundDim, 'font-size': '13px' }}>{field.desc}</td>
                <td style={{ padding: '8px 0' }}>
                  <input
                    type={field.key === 'password' ? 'password' : 'text'}
                    value={form()[field.key]}
                    onInput={(e) => onChange(field.key, e.currentTarget.value)}
                    placeholder={field.example}
                    aria-label={`${field.label} 输入`}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: `1px solid ${vscode.border}`,
                      'background-color': vscode.inputBg,
                      color: vscode.inputFg,
                      'font-size': '13px',
                    }}
                  />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', cursor: 'pointer', fontSize: '13px', color: vscode.foregroundDim }}>
        <input
          type="checkbox"
          checked={rememberPassword()}
          onInput={(e) => setRememberPassword(e.currentTarget.checked)}
        />
        记住密码（加密存储）
      </label>
      <button
        onClick={connect}
        disabled={connecting()}
        style={{
          'margin-top': '12px',
          padding: '8px 20px',
          'font-size': '13px',
          'background-color': connecting() ? vscode.buttonSecondary : vscode.buttonBg,
          color: '#fff',
          border: 'none',
          cursor: connecting() ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => !connecting() && (e.currentTarget.style.backgroundColor = vscode.buttonHover)}
        onMouseLeave={(e) => !connecting() && (e.currentTarget.style.backgroundColor = vscode.buttonBg)}
      >
        {connecting() ? '连接中...' : '连接'}
      </button>
    </div>
  );
}
