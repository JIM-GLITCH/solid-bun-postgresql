import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { vscode, MODAL_Z_FULLSCREEN } from "./theme";

export interface TimestampEditorProps {
  initialValue: string | null;
  isReadOnly: boolean;
  withTimeZone: boolean;
  onSave: (value: string | null) => void;
  onClose: () => void;
}

type ParsedTimestamp = {
  date: string;
  time: string;
  second: string;
  microsecond: string;
  tz: string;
};

function parseTimestampInput(input: string | null | undefined): ParsedTimestamp {
  const fallback: ParsedTimestamp = { date: "", time: "00:00", second: "00", microsecond: "000000", tz: "+00:00" };
  if (!input) return fallback;
  const raw = String(input).trim();
  if (!raw) return fallback;
  const normalized = raw.replace("T", " ");
  const m = normalized.match(
    /^(\d{4}-\d{2}-\d{2})[ \t]+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(?:\s*(Z|[+\-]\d{2}(?::?\d{2})?))?$/i
  );
  if (!m) {
    const d = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (d) return { ...fallback, date: d[1] };
    return fallback;
  }
  const date = m[1] ?? "";
  const hh = m[2] ?? "00";
  const mm = m[3] ?? "00";
  const ss = m[4] ?? "00";
  const micro = (m[5] ?? "").padEnd(6, "0").slice(0, 6) || "000000";
  let tz = m[6] ?? "+00:00";
  if (/^z$/i.test(tz)) tz = "+00:00";
  if (/^[+\-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  if (/^[+\-]\d{2}$/.test(tz)) tz = `${tz}:00`;
  return { date, time: `${hh}:${mm}`, second: ss, microsecond: micro, tz };
}

type TzOption = { value: string; label: string };
function buildOffsetOptions(): TzOption[] {
  const commonByOffset: Record<string, string> = {
    "-08:00": "America/Los_Angeles",
    "-05:00": "America/New_York",
    "+00:00": "UTC / Europe/London",
    "+01:00": "Europe/Berlin",
    "+03:00": "Europe/Moscow",
    "+05:30": "Asia/Kolkata",
    "+08:00": "Asia/Shanghai",
    "+09:00": "Asia/Tokyo",
    "+10:00": "Australia/Sydney",
  };
  const offsets: TzOption[] = [];
  for (let h = -12; h <= 14; h += 1) {
    const sign = h >= 0 ? "+" : "-";
    const hh = String(Math.abs(h)).padStart(2, "0");
    const value = `${sign}${hh}:00`;
    const place = commonByOffset[value];
    offsets.push({ value, label: place ? `${value}  ${place}` : value });
  }
  offsets.push({ value: "+05:30", label: "+05:30  Asia/Kolkata" });
  offsets.sort((a, b) => a.value.localeCompare(b.value));
  return offsets;
}

export function TimestampEditor(props: TimestampEditorProps) {
  let modalPanelEl: HTMLDivElement | undefined;
  const parsed = parseTimestampInput(props.initialValue);
  const [datePart, setDatePart] = createSignal(parsed.date);
  const [timePart, setTimePart] = createSignal(parsed.time);
  const [secondPart, setSecondPart] = createSignal(parsed.second);
  const [microsecondPart, setMicrosecondPart] = createSignal(parsed.microsecond);
  const [tzPart, setTzPart] = createSignal(parsed.tz);
  const [error, setError] = createSignal<string | null>(null);
  const offsetOptions = buildOffsetOptions();

  function pad2(v: string): string {
    const n = Number(v);
    if (!Number.isFinite(n)) return "00";
    const clamped = Math.max(0, Math.min(59, Math.trunc(n)));
    return String(clamped).padStart(2, "0");
  }

  function buildValue(): string | null {
    const d = datePart().trim();
    if (!d) {
      setError("请选择日期");
      return null;
    }
    const t = timePart().trim();
    if (!/^\d{2}:\d{2}$/.test(t)) {
      setError("时间格式应为 HH:mm");
      return null;
    }
    const sec = secondPart().trim();
    if (!/^\d{1,2}$/.test(sec)) {
      setError("秒应为 0-59");
      return null;
    }
    const micro = microsecondPart().trim();
    if (!/^\d{0,6}$/.test(micro)) {
      setError("微秒应为 0-999999");
      return null;
    }
    const microNorm = (micro || "0").padStart(6, "0").slice(0, 6);
    const fraction = microNorm === "000000" ? "" : `.${microNorm}`;
    const hhmmss = `${t}:${pad2(sec)}${fraction}`;
    if (props.withTimeZone) {
      const tz = tzPart().trim();
      if (!/^[+\-]\d{2}:\d{2}$/.test(tz)) {
        setError("时区偏移格式应为 +08:00");
        return null;
      }
      setError(null);
      return `${d} ${hhmmss}${tz}`;
    }
    setError(null);
    return `${d} ${hhmmss}`;
  }

  const preview = createMemo(() => {
    const v = buildValue();
    return v ?? "(无效输入)";
  });

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
      return;
    }
    if (e.key === "Enter" && !props.isReadOnly) {
      e.preventDefault();
      const v = buildValue();
      if (v !== null) props.onSave(v);
    }
  }

  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
    queueMicrotask(() => modalPanelEl?.focus());
  });
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  return (
    <div
      style={{
        position: "fixed",
        inset: "0",
        width: "100vw",
        height: "100vh",
        background: "rgba(0,0,0,0.5)",
        "z-index": MODAL_Z_FULLSCREEN,
        isolation: "isolate",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        ref={(el) => {
          modalPanelEl = el;
        }}
        tabIndex={-1}
        style={{
          width: "560px",
          "max-width": "92vw",
          background: vscode.editorBg,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          display: "flex",
          "flex-direction": "column",
          "box-shadow": "0 8px 32px rgba(0,0,0,0.6)",
          outline: "none",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "12px 16px",
            "border-bottom": `1px solid ${vscode.border}`,
            color: vscode.foreground,
            "font-size": "14px",
            "font-weight": "600",
          }}
        >
          {props.isReadOnly ? "查看时间戳" : "编辑时间戳"} {props.withTimeZone ? "(timestamptz)" : "(timestamp)"}
        </div>
        <div style={{ padding: "14px 16px", display: "grid", gap: "10px" }}>
          <label style={{ display: "grid", gap: "6px", color: vscode.foreground }}>
            <span>日期</span>
            <input
              type="date"
              value={datePart()}
              disabled={props.isReadOnly}
              onInput={(e) => setDatePart(e.currentTarget.value)}
              style={{ "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.border}`, padding: "6px 8px", "border-radius": "4px" }}
            />
          </label>
          <div style={{ display: "grid", "grid-template-columns": props.withTimeZone ? "1fr 100px 120px 1fr" : "1fr 100px 120px", gap: "10px" }}>
            <label style={{ display: "grid", gap: "6px", color: vscode.foreground }}>
              <span>时分</span>
              <input
                type="time"
                step={60}
                value={timePart()}
                disabled={props.isReadOnly}
                onInput={(e) => setTimePart(e.currentTarget.value)}
                style={{ "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.border}`, padding: "6px 8px", "border-radius": "4px" }}
              />
            </label>
            <label style={{ display: "grid", gap: "6px", color: vscode.foreground }}>
              <span>秒</span>
              <input
                type="number"
                min={0}
                max={59}
                step={1}
                value={secondPart()}
                disabled={props.isReadOnly}
                onInput={(e) => setSecondPart(e.currentTarget.value)}
                style={{ "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.border}`, padding: "6px 8px", "border-radius": "4px" }}
              />
            </label>
            <label style={{ display: "grid", gap: "6px", color: vscode.foreground }}>
              <span>微秒</span>
              <input
                type="number"
                min={0}
                max={999999}
                step={1}
                value={microsecondPart()}
                disabled={props.isReadOnly}
                onInput={(e) => setMicrosecondPart(e.currentTarget.value)}
                style={{ "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.border}`, padding: "6px 8px", "border-radius": "4px" }}
              />
            </label>
            <Show when={props.withTimeZone}>
              <label style={{ display: "grid", gap: "6px", color: vscode.foreground }}>
                <span>时区偏移</span>
                <select
                  value={tzPart()}
                  disabled={props.isReadOnly}
                  onChange={(e) => setTzPart(e.currentTarget.value)}
                  style={{ "background-color": vscode.inputBg, color: vscode.inputFg, border: `1px solid ${vscode.border}`, padding: "6px 8px", "border-radius": "4px" }}
                >
                  <For each={offsetOptions}>{(off) => <option value={off.value}>{off.label}</option>}</For>
                </select>
              </label>
            </Show>
          </div>
          <div style={{ color: vscode.foregroundDim, "font-size": "12px" }}>
            预览: <code>{preview()}</code>
          </div>
          <Show when={error()}>
            <div style={{ color: vscode.error, "font-size": "12px" }}>{error()}</div>
          </Show>
        </div>
        <div
          style={{
            padding: "10px 16px",
            "border-top": `1px solid ${vscode.border}`,
            display: "flex",
            "justify-content": "space-between",
            gap: "8px",
          }}
        >
          <Show when={!props.isReadOnly}>
            <button
              onClick={() => props.onSave(null)}
              style={{
                background: vscode.buttonSecondary,
                color: vscode.foreground,
                border: "none",
                "border-radius": "4px",
                padding: "6px 12px",
                cursor: "pointer",
                "font-size": "13px",
              }}
            >
              设为 NULL
            </button>
          </Show>
          <div style={{ display: "flex", gap: "8px", "margin-left": "auto" }}>
            <button
              onClick={props.onClose}
              style={{
                background: vscode.buttonSecondary,
                color: vscode.foreground,
                border: "none",
                "border-radius": "4px",
                padding: "6px 16px",
                cursor: "pointer",
                "font-size": "13px",
              }}
            >
              {props.isReadOnly ? "关闭" : "取消"}
            </button>
            <Show when={!props.isReadOnly}>
              <button
                onClick={() => {
                  const v = buildValue();
                  if (v !== null) props.onSave(v);
                }}
                style={{
                  background: vscode.buttonBg,
                  color: vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  padding: "6px 16px",
                  cursor: "pointer",
                  "font-size": "13px",
                }}
              >
                确认
              </button>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}

