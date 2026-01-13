import { createSignal, createEffect, Show } from "solid-js";

interface EditableCellProps {
  value: any;
  isEditable: boolean;
  isModified?: boolean;  // 是否被修改过
  onSave?: (newValue: string) => void;
  align?: "left" | "right" | "center";
}

export default function EditableCell(props: EditableCellProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");
  let inputRef: HTMLInputElement | undefined;

  // 监听编辑状态变化，自动聚焦
  createEffect(() => {
    if (isEditing()) {
      inputRef?.focus();
    }
  });

  function startEditing() {
    if (!props.isEditable) return;
    setEditValue(String(props.value ?? ""));
    setIsEditing(true);
  }

  function saveValue() {
    if (!isEditing()) return;
    setIsEditing(false);
    props.onSave?.(editValue());
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

  const align = props.align || "left";

  return (
    <td
      onDblClick={startEditing}
      style={{
        cursor: props.isEditable ? "pointer" : "default",
        padding: "8px 12px",
        "text-align": align,
        "border": "1px solid #e5e7eb",
        "white-space": "nowrap",
        overflow: "hidden",
        "text-overflow": "ellipsis",
        "background-color": props.isModified ? "#fef3c7" : "transparent"  // 编辑过的单元格显示橙色背景
      }}
    >
      <Show
        when={isEditing()}
        fallback={
          <span title={props.isEditable ? "双击编辑" : ""}>
            {props.value}
          </span>
        }
      >
        <input
          ref={(el) => inputRef = el}
          type="text"
          value={editValue()}
          onInput={(e) => setEditValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onBlur={saveValue}
          style={{
            width: "100%",
            padding: "2px 4px",
            border: "2px solid #2563eb",
            "border-radius": "2px",
            "font-size": "inherit",
            "font-family": "inherit",
            "box-sizing": "border-box",
            outline: "none",
            "text-align": align,
            margin: "-4px -6px",  // 抵消 padding 差异，保持宽度不变
            "min-width": "calc(100% + 12px)"
          }}
        />
      </Show>
    </td>
  );
}
