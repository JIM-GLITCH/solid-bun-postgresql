import { createMemo, createSignal, For, Show, onCleanup, onMount } from "solid-js";
import { getPgStatOverview, manageBackend } from "./api";
import { useDialog } from "./dialog-context";
import { MODAL_Z_FULLSCREEN, vscode } from "./theme";

interface PgStatModalProps {
  connectionId: string;
  onClose: () => void;
}

type PgStatData = Awaited<ReturnType<typeof getPgStatOverview>>;

export default function PgStatModal(props: PgStatModalProps) {
  const { showConfirm } = useDialog();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [data, setData] = createSignal<PgStatData | null>(null);
  const [autoRefresh, setAutoRefresh] = createSignal(true);
  const [refreshSec, setRefreshSec] = createSignal<3 | 5 | 10>(5);
  const [opLoadingPid, setOpLoadingPid] = createSignal<number | null>(null);

  let timer: number | null = null;
  const clearTimer = () => {
    if (timer != null) window.clearInterval(timer);
    timer = null;
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getPgStatOverview(props.connectionId, 20);
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const startAutoRefresh = () => {
    clearTimer();
    if (!autoRefresh()) return;
    timer = window.setInterval(fetchData, refreshSec() * 1000);
  };

  const runBackendAction = async (pid: number, action: "cancel" | "terminate") => {
    const tip = action === "terminate"
      ? `确定终止会话 ${pid} 吗？这会断开该连接并回滚其未提交事务。`
      : `确定取消会话 ${pid} 当前 SQL 吗？`;
    const title = action === "terminate" ? "终止会话" : "取消查询";
    if (!(await showConfirm(tip, title))) return;
    setOpLoadingPid(pid);
    try {
      const res = await manageBackend(props.connectionId, pid, action);
      if (!res.success) {
        throw new Error(`${action} 返回 false（可能该会话已结束或权限不足）`);
      }
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setOpLoadingPid(null);
    }
  };

  onMount(() => {
    void fetchData();
    startAutoRefresh();
  });
  onCleanup(clearTimer);

  const collectedAtText = createMemo(() => {
    const t = data()?.collectedAt;
    return t ? new Date(t).toLocaleTimeString() : "-";
  });

  return (
    <div
      onClick={props.onClose}
      style={{
        position: "fixed",
        inset: "0",
        background: "rgba(0,0,0,0.5)",
        "z-index": MODAL_Z_FULLSCREEN,
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(1100px, 96vw)",
          "max-height": "88vh",
          overflow: "auto",
          background: vscode.editorBg,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          padding: "14px 16px",
          display: "flex",
          "flex-direction": "column",
          gap: "10px",
        }}
      >
        <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
          <div style={{ "font-size": "15px", "font-weight": 600 }}>pg_stat 监控视图</div>
          <button onClick={props.onClose} style={iconBtnStyle()}>×</button>
        </div>

        <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
          <button onClick={() => void fetchData()} style={primaryBtnStyle()} disabled={loading()}>
            {loading() ? "刷新中..." : "手动刷新"}
          </button>
          <label style={{ display: "flex", gap: "6px", "align-items": "center", "font-size": "12px", color: vscode.foregroundDim }}>
            <input
              type="checkbox"
              checked={autoRefresh()}
              onInput={(e) => {
                setAutoRefresh(e.currentTarget.checked);
                startAutoRefresh();
              }}
            />
            自动刷新
          </label>
          <select
            value={String(refreshSec())}
            onInput={(e) => {
              setRefreshSec(Number(e.currentTarget.value) as 3 | 5 | 10);
              startAutoRefresh();
            }}
            style={selectStyle()}
          >
            <option value="3">3s</option>
            <option value="5">5s</option>
            <option value="10">10s</option>
          </select>
          <span style={{ "font-size": "12px", color: vscode.foregroundDim }}>最近采集: {collectedAtText()}</span>
        </div>

        <Show when={error()}>
          <div style={{ color: vscode.error, "font-size": "12px" }}>{error()}</div>
        </Show>

        <div style={{ display: "grid", "grid-template-columns": "repeat(4, minmax(0, 1fr))", gap: "8px" }}>
          <StatCard title="连接总数" value={String(data()?.connectionStats.total ?? 0)} />
          <StatCard title="活跃连接" value={String(data()?.connectionStats.active ?? 0)} />
          <StatCard title="空闲连接" value={String(data()?.connectionStats.idle ?? 0)} />
          <StatCard title="等待事件连接" value={String(data()?.connectionStats.waiting ?? 0)} />
        </div>

        <SectionTitle text={`慢查询 (${data()?.slowQuerySource === "pg_stat_statements" ? "pg_stat_statements" : "pg_stat_activity"})`} />
        <Show when={data()?.slowQuerySource === "pg_stat_activity"}>
          <div
            style={{
              "font-size": "12px",
              color: vscode.foregroundDim,
              background: vscode.sidebarBg,
              border: `1px solid ${vscode.border}`,
              "border-radius": "6px",
              padding: "8px 10px",
            }}
          >
            当前未启用 <code>pg_stat_statements</code>（或无权限读取），已降级使用 <code>pg_stat_activity</code>。
            如需更准确的 calls/耗时统计，请在数据库启用扩展并配置
            <code style={{ "margin-left": "4px" }}>shared_preload_libraries=pg_stat_statements</code>。
          </div>
        </Show>
        <TableWrap>
          <table style={tableStyle()}>
            <thead>
              <tr>
                <Th>SQL</Th>
                <Th>calls</Th>
                <Th>total(ms)</Th>
                <Th>mean(ms)</Th>
                <Th>rows/state</Th>
              </tr>
            </thead>
            <tbody>
              <For each={data()?.slowQueries ?? []}>
                {(r) => (
                  <tr>
                    <Td mono>{String(r.query ?? "")}</Td>
                    <Td>{String(r.calls ?? "-")}</Td>
                    <Td>{String(r.total_exec_time ?? "-")}</Td>
                    <Td>{String(r.mean_exec_time ?? "-")}</Td>
                    <Td>{String(r.rows ?? r.state ?? "-")}</Td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </TableWrap>

        <SectionTitle text="锁等待" />
        <TableWrap>
          <table style={tableStyle()}>
            <thead>
              <tr>
                <Th>waiting</Th>
                <Th>blocking</Th>
                <Th>wait_event</Th>
                <Th>waiting SQL</Th>
                <Th>blocking SQL</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              <For each={data()?.lockWaits ?? []}>
                {(r) => (
                  <tr>
                    <Td>{`${r.waiting_pid} (${r.waiting_user})`}</Td>
                    <Td>{`${r.blocking_pid} (${r.blocking_user})`}</Td>
                    <Td>{`${r.wait_event_type ?? "-"} / ${r.wait_event ?? "-"}`}</Td>
                    <Td mono>{r.waiting_query}</Td>
                    <Td mono>{r.blocking_query}</Td>
                    <Td>
                      <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap" }}>
                        <button
                          style={smallBtnStyle(false)}
                          disabled={opLoadingPid() === r.blocking_pid}
                          onClick={() => void runBackendAction(r.blocking_pid, "cancel")}
                        >
                          Cancel {r.blocking_pid}
                        </button>
                        <button
                          style={smallBtnStyle(true)}
                          disabled={opLoadingPid() === r.blocking_pid}
                          onClick={() => void runBackendAction(r.blocking_pid, "terminate")}
                        >
                          Kill {r.blocking_pid}
                        </button>
                      </div>
                    </Td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </TableWrap>
      </div>
    </div>
  );
}

function SectionTitle(props: { text: string }) {
  return <div style={{ "font-size": "13px", "font-weight": 600 }}>{props.text}</div>;
}
function StatCard(props: { title: string; value: string }) {
  return (
    <div style={{ border: `1px solid ${vscode.border}`, "border-radius": "6px", padding: "8px 10px", background: vscode.sidebarBg }}>
      <div style={{ color: vscode.foregroundDim, "font-size": "12px" }}>{props.title}</div>
      <div style={{ "font-size": "18px", "font-weight": 700 }}>{props.value}</div>
    </div>
  );
}
function TableWrap(props: { children: any }) {
  return <div style={{ overflow: "auto", border: `1px solid ${vscode.border}`, "border-radius": "6px" }}>{props.children}</div>;
}
function tableStyle() {
  return { width: "100%", "border-collapse": "collapse", "font-size": "12px" };
}
function Th(props: { children: any }) {
  return <th style={{ padding: "8px", "text-align": "left", background: vscode.sidebarBg, borderBottom: `1px solid ${vscode.border}` }}>{props.children}</th>;
}
function Td(props: { children: any; mono?: boolean }) {
  return (
    <td style={{ padding: "8px", borderBottom: `1px solid ${vscode.border}`, "font-family": props.mono ? "Consolas, monospace" : undefined }}>
      {props.children}
    </td>
  );
}
function iconBtnStyle() {
  return { background: "transparent", border: "none", color: vscode.foregroundDim, "font-size": "18px", cursor: "pointer" };
}
function primaryBtnStyle() {
  return {
    background: vscode.buttonBg,
    color: vscode.foreground,
    border: "none",
    padding: "6px 12px",
    "border-radius": "6px",
    cursor: "pointer",
    "font-size": "12px",
  };
}
function selectStyle() {
  return {
    background: vscode.inputBg,
    color: vscode.foreground,
    border: `1px solid ${vscode.border}`,
    "border-radius": "6px",
    padding: "4px 8px",
  };
}
function smallBtnStyle(danger: boolean) {
  return {
    background: danger ? "rgba(244, 67, 54, 0.22)" : vscode.buttonSecondary,
    color: vscode.foreground,
    border: `1px solid ${danger ? "rgba(244, 67, 54, 0.5)" : vscode.border}`,
    "border-radius": "4px",
    padding: "2px 6px",
    cursor: "pointer",
    "font-size": "11px",
  };
}

