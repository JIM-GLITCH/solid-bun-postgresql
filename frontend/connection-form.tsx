import { For, createSignal, Show, createEffect, createResource } from 'solid-js';
import { connectPostgres, disconnectPostgres } from './api';
import { saveConnection, getStoredConnectionParams } from './connection-storage';
import { vscode } from './theme';
import type { PostgresLoginParams, DbKind } from '../shared/src';
import type { StoredConnection } from './connection-storage';

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
  { key: 'database', label: 'database', desc: '数据库名（可空）。PostgreSQL 未填时默认同名库；MySQL 未填时请在侧栏单击要用的库作默认库，或在此填写库名', example: 'mydb' },
  { key: 'username', label: 'username', desc: '数据库用户', example: 'postgres' },
  { key: 'password', label: 'password', desc: '数据库密码', example: 'secret' },
];

const initForm = (): PostgresLoginParams =>
  fields.reduce<PostgresLoginParams>((acc, f) => {
    acc[f.key] = f.example ?? '';
    return acc;
  }, {} as PostgresLoginParams);

/** 将后端返回的参数规范化为表单所需格式（确保字符串类型等） */
function normalizeParamsForForm(p: PostgresLoginParams): PostgresLoginParams {
  return {
    host: String(p.host ?? ''),
    port: String(p.port ?? '5432'),
    database: String(p.database ?? ''),
    username: String(p.username ?? ''),
    password: String(p.password ?? ''),
    sshEnabled: p.sshEnabled,
    sshHost: p.sshHost != null ? String(p.sshHost) : undefined,
    sshPort: p.sshPort != null ? String(p.sshPort) : '22',
    sshUsername: p.sshUsername != null ? String(p.sshUsername) : undefined,
    sshPassword: p.sshPassword != null ? String(p.sshPassword) : undefined,
    sshPrivateKey: p.sshPrivateKey != null ? String(p.sshPrivateKey) : undefined,
    connectionTimeoutSec: typeof p.connectionTimeoutSec === 'number' ? p.connectionTimeoutSec : 30,
  };
}

const sshFields: Array<{ key: keyof PostgresLoginParams; label: string; desc: string; example: string; type?: 'password' | 'textarea' }> = [
  { key: 'sshHost', label: 'SSH 主机', desc: '跳板机地址', example: 'jump.example.com' },
  { key: 'sshPort', label: 'SSH 端口', desc: '跳板机 SSH 端口', example: '22' },
  { key: 'sshUsername', label: 'SSH 用户', desc: '跳板机登录用户', example: 'ubuntu' },
  { key: 'sshPassword', label: 'SSH 密码', desc: '跳板机密码（与私钥二选一）', example: '', type: 'password' },
  { key: 'sshPrivateKey', label: 'SSH 私钥', desc: 'PEM 格式私钥（与密码二选一）', example: '', type: 'textarea' },
  { key: 'connectionTimeoutSec', label: '连接超时(秒)', desc: 'SSH 与数据库连接超时时间', example: '30' },
];

interface ConnectionFormProps {
  /** 保留供宿主挂载；当前表单仅「测试连接 + 保存」，建立会话请从侧栏已保存连接进入 */
  onConnected?: (connectionId: string, info: string) => void;
  onSaved?: () => void;
  compact?: boolean;
  connectionInfo?: string;
  connectionId?: string;
  onDisconnect?: (connectionId: string) => void;
  /** 编辑模式：与新建相同的完整表单，可编辑所有字段 */
  editStored?: StoredConnection;
}

export default function ConnectionForm(props: ConnectionFormProps) {
  const [form, setForm] = createSignal<PostgresLoginParams>(initForm());
  const [dbType, setDbType] = createSignal<DbKind>('postgres');
  const [connecting, setConnecting] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [successHint, setSuccessHint] = createSignal<string | null>(null);
  const [connectionName, setConnectionName] = createSignal(props.editStored?.name ?? props.editStored?.label ?? '');
  const [connectionGroup, setConnectionGroup] = createSignal(props.editStored?.group ?? '');

  const onChange = (key: keyof PostgresLoginParams, value: string) => {
    setError(null);
    setSuccessHint(null);
    if (key === 'connectionTimeoutSec') {
      const n = parseInt(value, 10);
      setForm((prev) => ({ ...prev, connectionTimeoutSec: n > 0 ? n : 30 }));
    } else {
      setForm((prev) => ({ ...prev, [key]: value }));
    }
  };

  const setSshEnabled = (enabled: boolean) => {
    setForm((prev) => ({ ...prev, sshEnabled: enabled }));
    setError(null);
    setSuccessHint(null);
  };

  const setDbKind = (k: DbKind) => {
    setSuccessHint(null);
    setDbType(k);
    setForm((prev) => {
      const next = { ...prev };
      if (k === 'mysql' && (prev.port === '' || prev.port === '5432')) next.port = '3306';
      if (k === 'postgres' && (prev.port === '' || prev.port === '3306')) next.port = '5432';
      return next;
    });
    setError(null);
  };

  const buildPayload = (): PostgresLoginParams => form();

  /** 临时建连校验账号密码，成功后立即断开，不在侧栏建立会话 */
  const testConnection = async () => {
    setSuccessHint(null);
    setConnecting(true);
    setError(null);
    try {
      const testId = `__test_${generateConnectionId()}`;
      const payload = buildPayload();
      const { sucess, error: err } = await connectPostgres(testId, payload, dbType());
      if (sucess) {
        try {
          await disconnectPostgres(testId);
        } catch {
          /* ignore */
        }
        setSuccessHint('测试连接成功');
      } else {
        setError(String(err ?? '连接失败'));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '连接失败');
    } finally {
      setConnecting(false);
    }
  };

  const saveOnly = async () => {
    setSaving(true);
    setError(null);
    setSuccessHint(null);
    try {
      const connectionId = props.editStored?.id ?? props.connectionId ?? generateConnectionId();
      const payload = buildPayload();
      await saveConnection(connectionId, { ...payload, dbType: dbType() }, {
        name: connectionName().trim() || undefined,
        group: connectionGroup().trim() || undefined,
      });
      props.onSaved?.();
    } catch (e: any) {
      setError(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    if (!props.editStored) return;
    setSaving(true);
    setError(null);
    setSuccessHint(null);
    try {
      const payload = buildPayload();
      await saveConnection(props.editStored.id, { ...payload, dbType: dbType() }, {
        name: connectionName().trim() || undefined,
        group: connectionGroup().trim() || undefined,
      });
      props.onSaved?.();
    } catch (e: any) {
      setError(e?.message ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const [paramsResource] = createResource(
    () => props.editStored?.id ?? null,
    (id) => (id ? getStoredConnectionParams(id) : Promise.resolve(null))
  );

  createEffect(() => {
    const p = paramsResource();
    if (p) {
      setForm(normalizeParamsForForm(p));
      setDbType(p.dbType ?? 'postgres');
    }
  });

  if (props.compact && props.connectionId && !props.editStored) {
    return (
      <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
        <span style={{ color: vscode.foreground, 'font-size': '13px' }}>
          {props.connectionInfo || '数据库已连接'}
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
        {props.editStored ? '编辑连接配置' : '数据库连接'}
      </h2>
      <Show when={props.editStored && paramsResource.loading}>
        <div style={{ color: vscode.foregroundDim, 'margin-bottom': '12px', 'font-size': '13px' }}>加载连接配置中...</div>
      </Show>
      <Show when={props.editStored && paramsResource.error}>
        <div style={{ color: vscode.error, 'margin-bottom': '12px', 'font-size': '13px' }}>加载失败，请重试</div>
      </Show>
        <Show when={error()}>
          <div style={{ color: vscode.error, 'margin-bottom': '12px', 'font-size': '13px' }}>
            {error()}
          </div>
        </Show>
        <Show when={successHint()}>
          <div style={{ color: vscode.success, 'margin-bottom': '12px', 'font-size': '13px' }}>
            {successHint()}
          </div>
        </Show>
      <div style={{ 'margin-bottom': '14px', display: 'flex', 'align-items': 'center', gap: '10px', 'flex-wrap': 'wrap' }}>
        <label style={{ color: vscode.foreground, 'font-size': '13px' }}>数据库类型</label>
        <select
          value={dbType()}
          onChange={(e) => setDbKind(e.currentTarget.value as DbKind)}
          style={{
            padding: '6px 10px',
            border: `1px solid ${vscode.border}`,
            'background-color': vscode.inputBg,
            color: vscode.inputFg,
            'font-size': '13px',
          }}
        >
          <option value="postgres">PostgreSQL</option>
          <option value="mysql">MySQL</option>
        </select>
      </div>
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
                    value={String(form()[field.key] ?? '')}
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

      <label style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-top': '12px', cursor: 'pointer', 'font-size': '13px', color: vscode.foregroundDim }}>
        <input
          type="checkbox"
          checked={form().sshEnabled ?? false}
          onInput={(e) => setSshEnabled(e.currentTarget.checked)}
        />
        启用 SSH 隧道（通过跳板机连接）
      </label>
      <Show when={form().sshEnabled}>
        <div style={{ 'margin-top': '6px', 'font-size': '12px', color: vscode.foregroundDim }}>
          上方的 host / port 为<strong>跳板机可访问</strong>的数据库地址（如数据库在跳板机本机填 localhost，在内网填内网 IP 或主机名）。
        </div>
      </Show>

      <Show when={form().sshEnabled}>
        <div style={{ 'margin-top': '16px', padding: '12px', 'background-color': vscode.inputBg, border: `1px solid ${vscode.border}`, 'border-radius': '4px' }}>
          <div style={{ 'margin-bottom': '12px', 'font-size': '13px', color: vscode.foreground }}>SSH 跳板机配置</div>
          <table style={{ 'border-collapse': 'collapse', width: '100%', 'max-width': '600px' }}>
            <tbody>
              <For each={sshFields}>
                {(field) => (
                  <tr>
                    <td style={{ padding: '6px 12px 6px 0', color: vscode.foreground, width: '100px' }}>{field.label}</td>
                    <td style={{ padding: '6px 0' }}>
                      {field.type === 'textarea' ? (
                        <textarea
                          value={String(form()[field.key] ?? '')}
                          onInput={(e) => onChange(field.key, e.currentTarget.value)}
                          placeholder={field.example || field.desc}
                          rows={4}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: `1px solid ${vscode.border}`,
                            'background-color': vscode.sidebarBg,
                            color: vscode.inputFg,
                            'font-size': '12px',
                            'font-family': 'monospace',
                          }}
                        />
                      ) : (
                        <input
                          type={field.key === 'connectionTimeoutSec' ? 'number' : (field.type ?? 'text')}
                          min={field.key === 'connectionTimeoutSec' ? 5 : undefined}
                          value={field.key === 'connectionTimeoutSec' ? String(form().connectionTimeoutSec ?? 30) : String(form()[field.key] ?? '')}
                          onInput={(e) => onChange(field.key, e.currentTarget.value)}
                          placeholder={field.example}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            border: `1px solid ${vscode.border}`,
                            'background-color': vscode.sidebarBg,
                            color: vscode.inputFg,
                            'font-size': '13px',
                          }}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <div style={{ 'margin-top': '16px', padding: '12px', 'background-color': vscode.inputBg, border: `1px solid ${vscode.border}`, 'border-radius': '4px' }}>
        <div style={{ 'margin-bottom': '8px', 'font-size': '13px', color: vscode.foreground }}>连接配置（保存时生效）</div>
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
          <div>
            <label style={{ display: 'block', 'font-size': '12px', color: vscode.foregroundDim, 'margin-bottom': '4px' }}>显示名称（可选）</label>
            <input
              type="text"
              value={connectionName()}
              onInput={(e) => setConnectionName(e.currentTarget.value)}
              placeholder={props.editStored?.label ?? '如：生产库、测试库'}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${vscode.border}`,
                'background-color': vscode.sidebarBg,
                color: vscode.inputFg,
                'font-size': '13px',
                'box-sizing': 'border-box',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', 'font-size': '12px', color: vscode.foregroundDim, 'margin-bottom': '4px' }}>分组（可选）</label>
            <input
              type="text"
              value={connectionGroup()}
              onInput={(e) => setConnectionGroup(e.currentTarget.value)}
              placeholder="如：生产环境、开发环境"
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid ${vscode.border}`,
                'background-color': vscode.sidebarBg,
                color: vscode.inputFg,
                'font-size': '13px',
                'box-sizing': 'border-box',
              }}
            />
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', 'margin-top': '12px', 'flex-wrap': 'wrap' }}>
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={connecting() || saving()}
          style={{
            padding: '8px 20px',
            'font-size': '13px',
            'background-color': connecting() || saving() ? vscode.buttonSecondary : vscode.buttonBg,
            color: '#fff',
            border: 'none',
            cursor: connecting() || saving() ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => !(connecting() || saving()) && (e.currentTarget.style.backgroundColor = vscode.buttonHover)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = vscode.buttonBg)}
        >
          {connecting() ? '测试中...' : '测试连接'}
        </button>
        <button
          type="button"
          onClick={() => void (props.editStored ? saveEdit() : saveOnly())}
          disabled={saving() || connecting()}
          style={{
            padding: '8px 20px',
            'font-size': '13px',
            'background-color': saving() || connecting() ? vscode.buttonSecondary : vscode.buttonSecondary,
            color: vscode.foreground,
            border: 'none',
            cursor: saving() || connecting() ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => !(saving() || connecting()) && (e.currentTarget.style.backgroundColor = vscode.buttonSecondaryHover)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = vscode.buttonSecondary)}
        >
          {saving() ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}
