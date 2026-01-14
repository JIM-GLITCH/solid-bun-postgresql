// client/src/Postgres.tsx
import { useNavigate } from '@solidjs/router';
import { For, createSignal } from 'solid-js';
import { getSessionId } from './session';
export interface PostgresLoginParmas {
    host: string
    port: string
    database: string
    username: string
    password: string
}
const fields = [
    { key: 'host', label: 'host', desc: '数据库主机名或 IP', example: 'localhost' },
    { key: 'port', label: 'port', desc: '数据库端口', example: '5432' },
    { key: 'database', label: 'database', desc: '数据库名称', example: 'mydb' },
    { key: 'username', label: 'username', desc: '数据库用户', example: 'postgres' },
    { key: 'password', label: 'password', desc: '数据库密码', example: 'secret' },
    // { key: 'ssl', label: 'ssl', desc: '是否启用 SSL（可选）', example: 'true/false' },
];

const initForm = () =>
    fields.reduce<Record<string, string>>((acc, f) => {
        acc[f.key] = f.example ?? '';
        return acc;
    }, {});

export default function Postgres() {
    const navagate = useNavigate()
    const [form, setForm] = createSignal<Record<string, string>>(initForm());

    const onChange = (key: string, value: string) => {
        setForm((prev) => ({ ...prev, [key]: value }));
    };

    const connect = async () => {
        console.log("connect")
        const sessionId = getSessionId();
        const { sucess, error } = await (await fetch('/api/connect-postgres', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...form(), sessionId }),
        })).json();
        if(sucess){
            navagate('/postgres/query-interface')
        }

    }
    return (
        <>
            <table>
                <thead>
                    <tr>
                        <th>字段</th>
                        <th>说明</th>
                        <th>示例</th>
                    </tr>
                </thead>
                <tbody>
                    <For each={fields}>
                        {(field) => (
                            <tr>
                                <td>{field.label}</td>
                                <td>{field.desc}</td>
                                <td>
                                    <input
                                        value={form()[field.key]}
                                        onInput={(e) => onChange(field.key, e.currentTarget.value)}
                                        placeholder="请输入值"
                                        aria-label={`${field.label} 示例输入`}
                                    />
                                </td>
                            </tr>
                        )}
                    </For>
                </tbody>
            </table>
            <button onClick={connect}>连接</button>
        </>
    );
}