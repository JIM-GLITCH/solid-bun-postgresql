/**
 * 表设计器「类型」列：可手填 + 主题化建议列表（替代原生 datalist 的系统下拉样式）
 */
import { createMemo, For, Show } from "solid-js";
import { vscode } from "./theme";

export interface TableDesignerTypeInputProps {
  rowIndex: number;
  value: string;
  onChange: (v: string) => void;
  options: () => string[];
  inputStyle: Record<string, string | number>;
  openRow: () => number | null;
  setOpenRow: (i: number | null) => void;
  placeholder?: string;
}

export function TableDesignerTypeInput(props: TableDesignerTypeInputProps) {
  const filtered = createMemo(() => {
    const all = props.options();
    const q = props.value.trim().toLowerCase();
    if (!q) return all.slice(0, 120);
    return all.filter((t) => t.toLowerCase().includes(q)).slice(0, 120);
  });

  const pick = (t: string) => {
    props.onChange(t);
    props.setOpenRow(null);
  };

  const clearType = () => {
    props.onChange("");
    props.setOpenRow(null);
  };

  return (
    <div style={{ position: "relative", display: "block", width: "100%", "min-width": "140px" }}>
      <input
        type="text"
        aria-label="列数据类型"
        title="列数据类型（可手填或从建议中选择）"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        onFocus={() => props.setOpenRow(props.rowIndex)}
        onBlur={() => {
          window.setTimeout(() => props.setOpenRow(null), 120);
        }}
        placeholder={props.placeholder ?? "类型，建议或手填"}
        autocomplete="off"
        style={{
          ...props.inputStyle,
          width: "100%",
          "font-family": "'JetBrains Mono', monospace",
          "box-sizing": "border-box",
          "padding-right": props.value.trim() ? "26px" : undefined,
        }}
      />
      <Show when={props.value.trim().length > 0}>
        <button
          type="button"
          aria-label="清空类型"
          title="清空"
          onMouseDown={(e) => {
            e.preventDefault();
            clearType();
          }}
          style={{
            position: "absolute",
            right: "4px",
            top: "50%",
            transform: "translateY(-50%)",
            display: "flex",
            "align-items": "center",
            "justify-content": "center",
            width: "20px",
            height: "20px",
            padding: "0",
            border: "none",
            "border-radius": "3px",
            background: "transparent",
            color: vscode.foregroundDim,
            cursor: "pointer",
            "font-size": "14px",
            "line-height": 1,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = vscode.foreground;
            e.currentTarget.style.backgroundColor = vscode.listHover;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = vscode.foregroundDim;
            e.currentTarget.style.backgroundColor = "transparent";
          }}
        >
          ×
        </button>
      </Show>
      <Show when={props.openRow() === props.rowIndex && filtered().length > 0}>
        <div
          style={{
            position: "absolute",
            left: "0",
            top: "100%",
            "margin-top": "2px",
            "min-width": "100%",
            width: "max-content",
            "max-width": "min(420px, 85vw)",
            "max-height": "220px",
            overflow: "auto",
            "z-index": "500",
            "background-color": vscode.editorBg,
            border: `1px solid ${vscode.border}`,
            "border-radius": "4px",
            "box-shadow": "0 6px 16px rgba(0,0,0,0.5)",
            "font-size": "12px",
            "font-family": "'JetBrains Mono', monospace",
          }}
          onMouseDown={(e) => e.preventDefault()}
          role="listbox"
        >
          <For each={filtered()}>
            {(t, idx) => (
              <div
                role="option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(t);
                }}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  color: vscode.foreground,
                  "border-bottom":
                    idx() < filtered().length - 1 ? `1px solid ${vscode.borderLight}` : "none",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = vscode.listHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                {t}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
