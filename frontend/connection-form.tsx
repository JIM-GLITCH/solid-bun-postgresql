import { For, createSignal, Show } from 'solid-js';
import { connectPostgres } from './api';
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
  compact?: boolean;
  connectionInfo?: string;
  connectionId?: string;
  onDisconnect?: (connectionId: string) => void;
}

export default function ConnectionForm(props: ConnectionFormProps) {
  const [form, setForm] = createSignal<PostgresLoginParams>(initForm());
  const [connecting, setConnecting] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

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
        <span style={{ color: '#94a3b8', 'font-size': '13px' }}>
          {props.connectionInfo || 'PostgreSQL 已连接'}
        </span>
        {props.onDisconnect && (
          <button
            onClick={() => props.onDisconnect?.(props.connectionId!)}
            style={{
              padding: '4px 10px',
              'font-size': '12px',
              'background-color': '#334155',
              color: '#e2e8f0',
              border: 'none',
              'border-radius': '4px',
              cursor: 'pointer',
            }}
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
      'background-color': '#f8fafc',
      'border-radius': '8px',
      'border': '1px solid #e2e8f0',
      'margin-bottom': '20px',
    }}>
      <h2 style={{ 'margin': '0 0 16px 0', 'font-size': '18px', color: '#1e293b' }}>
        PostgreSQL 连接
      </h2>
      <Show when={error()}>
        <div style={{ color: '#dc2626', 'margin-bottom': '12px', 'font-size': '14px' }}>
          {error()}
        </div>
      </Show>
      <table style={{ 'border-collapse': 'collapse', width: '100%', 'max-width': '600px' }}>
        <thead>
          <tr>
            <th style={{ 'text-align': 'left', padding: '8px 12px 8px 0' }}>字段</th>
            <th style={{ 'text-align': 'left', padding: '8px 12px 8px 0' }}>说明</th>
            <th style={{ 'text-align': 'left', padding: '8px 0' }}>值</th>
          </tr>
        </thead>
        <tbody>
          <For each={fields}>
            {(field) => (
              <tr>
                <td style={{ padding: '8px 12px 8px 0' }}>{field.label}</td>
                <td style={{ padding: '8px 12px 8px 0', color: '#64748b', 'font-size': '13px' }}>{field.desc}</td>
                <td style={{ padding: '8px 0' }}>
                  <input
                    value={form()[field.key]}
                    onInput={(e) => onChange(field.key, e.currentTarget.value)}
                    placeholder={field.example}
                    aria-label={`${field.label} 输入`}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: '1px solid #d1d5db',
                      'border-radius': '6px',
                      'font-size': '14px',
                    }}
                  />
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
      <button
        onClick={connect}
        disabled={connecting()}
        style={{
          'margin-top': '12px',
          padding: '10px 24px',
          'font-size': '14px',
          'font-weight': '500',
          'background-color': connecting() ? '#94a3b8' : '#10b981',
          color: '#fff',
          border: 'none',
          'border-radius': '6px',
          cursor: connecting() ? 'not-allowed' : 'pointer',
        }}
      >
        {connecting() ? '连接中...' : '连接'}
      </button>
    </div>
  );
}
