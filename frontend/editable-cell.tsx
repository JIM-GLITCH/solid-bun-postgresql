import { createSignal, createEffect, Show, onCleanup } from "solid-js";
import { formatCellDisplay, formatCellToEditable } from "../shared/src";

interface EditableCellProps {
  value: any;
  isEditable: boolean;
  isModified?: boolean;
  onSave?: (newValue: string | null) => void;
  align?: "left" | "right" | "center";
}

export default function EditableCell(props: EditableCellProps) {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal("");
  const [menuPos, setMenuPos] = createSignal<{ x: number; y: number } | null>(null);
  let inputRef: HTMLInputElement | undefined;
  let menuRef: HTMLDivElement | null = null;

  createEffect(() => {
    if (isEditing()) inputRef?.focus();
  });

  function closeMenu() {
    setMenuPos(null);
  }
  createEffect(() => {
    if (!menuPos()) return;
    const h = (e: MouseEvent) => {
      if (menuRef?.contains(e.target as Node)) return;
      closeMenu();
    };
    document.addEventListener("click", h, true);
    document.addEventListener("contextmenu", h, true);
    onCleanup(() => {
      document.removeEventListener("click", h, true);
      document.removeEventListener("contextmenu", h, true);
    });
  });

  function startEditing() {
    if (!props.isEditable) return;
    setEditValue(formatCellToEditable(props.value));
    setIsEditing(true);
  }

  function saveValue(value?: string | null) {
    if (isEditing()) setIsEditing(false);
    props.onSave?.(value !== undefined ? value : editValue());
  }

  function handleContextMenu(e: MouseEvent) {
    if (!props.isEditable) return;
    e.preventDefault();
    setMenuPos({ x: e.clientX, y: e.clientY });
  }

  function handleSetNull() {
    closeMenu();
    saveValue(null);
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
      onContextMenu={handleContextMenu}
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
            {formatCellDisplay(props.value)}
          </span>
        }
      >
        <input
          ref={(el) => inputRef = el}
          type="text"
          value={editValue()}
          onInput={(e) => setEditValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => saveValue()}
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
      <Show when={menuPos()}>
        {(pos) => (
          <div
            ref={(el) => (menuRef = el)}
            role="menu"
            style={{
              position: "fixed",
              left: `${pos().x}px`,
              top: `${pos().y}px`,
              "z-index": 10000,
              background: "#fff",
              border: "1px solid #e5e7eb",
              "border-radius": "4px",
              "box-shadow": "0 2px 8px rgba(0,0,0,0.15)",
              "min-width": "120px",
              padding: "4px 0",
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                handleSetNull();
              }}
              style={{
                display: "block",
                width: "100%",
                padding: "6px 12px",
                border: "none",
                background: "none",
                "text-align": "left",
                cursor: "pointer",
                "font-size": "inherit",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#f3f4f6")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              Set null
            </button>
          </div>
        )}
      </Show>
    </td>
  );
}
