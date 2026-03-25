import { createSignal, createEffect, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { formatCellDisplay, formatCellToEditable } from "../shared/src";
import { vscode } from "./theme";
import { JSONB_Editor } from "./jsonb-editor";

interface EditableCellProps {
  /** 直接传值，或传访问器 () => value 以建立对 store 的细粒度依赖 */
  value: any | (() => any);
  isEditable: boolean;
  isModified?: boolean;
  /** 该行是否已标记为待删除 */
  isPendingDelete?: boolean;
  /** 该行是否为待插入的新行 */
  isPendingInsert?: boolean;
  /** 该单元格是否在选区内 */
  isSelected?: boolean;
  /** 相邻单元格是否选中（用于隐藏选区内部网格线） */
  neighborSelected?: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
  /** 行索引（用于选区与 data 属性） */
  rowIndex?: number;
  /** 列索引（用于选区与 data 属性） */
  colIndex?: number;
  /** 列数据类型 OID（用于格式化显示，如 JSON 等） */
  dataTypeOid?: number;
  onSave?: (newValue: string | null) => void;
  onMouseDown?: (e: MouseEvent) => void;
  onContextMenu?: (e: MouseEvent) => void;
  align?: "left" | "right" | "center" | (() => "left" | "right" | "center");
}

export default function EditableCell(props: EditableCellProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");
  const [showJsonEditor, setShowJsonEditor] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    if (isEditing()) inputRef?.focus();
  });

  const getValue = () => (typeof props.value === "function" ? props.value() : props.value);
  const getAlign = () => (typeof props.align === "function" ? props.align() : (props.align ?? "left"));

  function startEditing() {
    if (props.dataTypeOid === 114 || props.dataTypeOid === 3802) {
      setShowJsonEditor(true);
      return;
    }
    if (!props.isEditable) return;
    setEditValue(formatCellToEditable(getValue(), props.dataTypeOid));
    setIsEditing(true);
  }

  function saveValue(value?: string | null) {
    if (isEditing()) setIsEditing(false);
    props.onSave?.(value !== undefined ? value : editValue());
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    props.onContextMenu?.(e);
  }

  function cancelEditing() {
    setIsEditing(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveValue();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEditing();
    }
  }

  const bgColor = () => {
    if (props.isPendingDelete) return "rgba(255, 100, 100, 0.12)";
    if (props.isPendingInsert) return "rgba(100, 200, 100, 0.12)";
    if (props.isModified) return "rgba(255, 240, 120, 0.15)";
    return "transparent";
  };

  return (
    <td
      data-rowindex={props.rowIndex}
      data-colindex={props.colIndex}
      onMouseDown={props.onMouseDown}
      onDblClick={startEditing}
      onContextMenu={handleContextMenu}
      style={{
        cursor: props.isEditable ? "pointer" : "default",
        padding: "8px 12px",
        "text-align": getAlign(),
        "border": `1px solid ${vscode.border}`,
        "white-space": "nowrap",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        color: props.isPendingDelete ? vscode.foregroundDim : vscode.foreground,
        "background-color": bgColor(),
        "box-shadow": props.isSelected ? [
          "inset 0 0 0 9999px rgba(0, 176, 255, 0.2)",
          !props.neighborSelected?.left && "inset 1px 0 0 0 #2aaaff",
          !props.neighborSelected?.right && "inset -1px 0 0 0 #2aaaff",
          !props.neighborSelected?.top && "inset 0 1px 0 0 #2aaaff",
          !props.neighborSelected?.bottom && "inset 0 -1px 0 0 #2aaaff"
        ].filter(Boolean).join(", ") : "none",
        "text-decoration": props.isPendingDelete ? "line-through" : "none",
        opacity: props.isPendingDelete ? 0.85 : 1
      }}
    >
      <Show
        when={isEditing()}
        fallback={
          <span
            title={props.isEditable ? "双击编辑" : ""}
            style={
              getValue() === null || getValue() === undefined
                ? { "font-style": "italic", opacity: 0.5, color: vscode.foregroundDim }
                : undefined
            }
          >
            {formatCellDisplay(getValue(), props.dataTypeOid)}
          </span>
        }
      >
        <input
          ref={(el) => inputRef = el}
          type="text"
          value={editValue()}
          title="编辑单元格"
          onInput={(e) => setEditValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => saveValue()}
          style={{
            width: "100%",
            padding: "2px 4px",
            "user-select": "text",
            border: `2px solid ${vscode.accent}`,
            "border-radius": "2px",
            "font-size": "inherit",
            "font-family": "inherit",
            "box-sizing": "border-box",
            outline: "none",
            "text-align": getAlign(),
            margin: "-4px -6px",
            "min-width": "calc(100% + 12px)"
          }}
        />
      </Show>
      <Show when={showJsonEditor()}>
        <Portal mount={document.body}>
          <JSONB_Editor
            initialValue={(() => {
              const v = getValue();
              if (v === null || v === undefined) return null;
              if (typeof v === "string") return v;
              try { return JSON.stringify(v); } catch { return String(v); }
            })()}
            isReadOnly={!props.isEditable}
            onSave={(v) => {
              props.onSave?.(v);
              setShowJsonEditor(false);
            }}
            onClose={() => setShowJsonEditor(false)}
          />
        </Portal>
      </Show>
    </td>
  );
}
