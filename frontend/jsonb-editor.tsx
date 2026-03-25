/**
 * JSONB 编辑器组件
 * 包含 RawMode、TreeView、FormView 和 JSONB_Editor 主组件
 *
 * 修复：input 无法编辑（无光标、失焦）问题
 * - Form 视图：用 createStore<FormEntry[]> + 细粒度更新，避免 <For> 重建 input
 * - Tree 视图：叶子节点 onInput 只更新本地 signal，Enter 时才提交到 rootNode
 * - Raw 视图：textarea 不受控（不绑定 value prop），初始化时用 ref 设置内容
 */
import { createSignal, createEffect, For, Show, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import {
  toJsonNode, fromJsonNode, serializeCompact, serializePretty, parseJsonSafe,
  updateAtPath, deleteAtPath, buildJsonPath, parseFormValue, jsonNodesEqual,
  isExpandable, getInitialExpanded, getValueColor,
  type JsonNode, type JsonValue, type JsonObject
} from "./jsonb-editor-model";
import { vscode } from "./theme";
import { writeClipboardText } from "./clipboard";

// ─── RawMode ─────────────────────────────────────────────────────────────────

interface RawModeProps {
  initialText: string;
  error: string | null;
  isReadOnly: boolean;
  onChange: (text: string) => void;
  onFormat: () => void;
}

function RawMode(props: RawModeProps) {
  let textareaRef: HTMLTextAreaElement | undefined;

  // 不受控：只在挂载时设置初始值，之后由用户自由编辑
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "8px", height: "100%" }}>
      <textarea
        ref={(el) => {
          textareaRef = el;
          // 初始化时设置内容，不绑定 value prop（避免受控重渲染）
          el.value = props.initialText;
        }}
        readOnly={props.isReadOnly}
        onInput={(e) => props.onChange(e.currentTarget.value)}
        style={{
          flex: "1",
          "min-height": "300px",
          background: vscode.inputBg,
          color: vscode.inputFg,
          border: `1px solid ${props.error ? vscode.error : vscode.inputBorder}`,
          "border-radius": "4px",
          padding: "8px",
          "font-family": "monospace",
          "font-size": "13px",
          resize: "vertical",
          outline: "none",
        }}
      />
      <Show when={props.error}>
        <div style={{ color: vscode.error, "font-size": "12px" }}>{props.error}</div>
      </Show>
      <Show when={!props.isReadOnly}>
        <button
          onClick={() => {
            // 格式化时需要读取当前 textarea 内容
            if (textareaRef) props.onChange(textareaRef.value);
            props.onFormat();
          }}
          style={{
            "align-self": "flex-start",
            background: vscode.buttonSecondary,
            color: vscode.foreground,
            border: "none",
            "border-radius": "4px",
            padding: "4px 12px",
            cursor: "pointer",
            "font-size": "12px",
          }}
        >
          格式化
        </button>
      </Show>
    </div>
  );
}

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  items: { label: string; action: () => void }[];
}

// ─── TreeNode ─────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: JsonNode;
  path: (string | number)[];
  depth: number;
  isReadOnly: boolean;
  columnName?: string;
  // 编辑状态提升到 TreeView 层，避免 <For> 重渲染时丢失
  editingPath: string | null;
  editVal: string;
  onStartEdit: (path: string, initialVal: string) => void;
  onCommitEdit: (path: (string | number)[]) => void;
  onCancelEdit: () => void;
  onEditValChange: (v: string) => void;
  onUpdate: (path: (string | number)[], newValue: JsonValue) => void;
  onDelete: (path: (string | number)[]) => void;
  onAddChild: (path: (string | number)[], type: "object" | "array") => void;
  onContextMenu: (e: MouseEvent, items: { label: string; action: () => void }[]) => void;
}

function TreeNode(props: TreeNodeProps) {
  const [expanded, setExpanded] = createSignal(getInitialExpanded(props.node, props.depth));

  if (props.depth > 50) {
    return <span style={{ color: vscode.foregroundDim }}>...</span>;
  }

  const node = () => props.node;
  const isLeaf = () => !isExpandable(node());
  const pathKey = () => props.path.join("\0");
  const isEditing = () => props.editingPath === pathKey();

  function startEdit() {
    if (props.isReadOnly || !isLeaf()) return;
    const n = node();
    const val = (n.type === "null") ? "null" : String((n as any).value ?? "");
    props.onStartEdit(pathKey(), val);
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
    const n = node();
    const isLeafNode = isLeaf();
    const items: { label: string; action: () => void }[] = [
      {
        label: "复制路径",
        action: () => {
          const path = buildJsonPath(props.columnName ?? "data", props.path, isLeafNode);
          writeClipboardText(path);
        },
      },
      {
        label: "复制值",
        action: () => {
          writeClipboardText(JSON.stringify(fromJsonNode(n)));
        },
      },
    ];
    props.onContextMenu(e, items);
  }

  const indentPx = () => `${props.depth * 16}px`;

  return (
    <div>
      <div
        style={{
          display: "flex",
          "align-items": "center",
          gap: "4px",
          padding: "2px 4px",
          "padding-left": indentPx(),
          "border-radius": "3px",
          cursor: "default",
        }}
        onContextMenu={handleContextMenu}
      >
        {/* expand/collapse toggle */}
        <Show when={isExpandable(node())}>
          <span
            style={{ cursor: "pointer", "user-select": "none", width: "14px", "font-size": "10px" }}
            onClick={() => setExpanded(!expanded())}
          >
            {expanded() ? "▼" : "▶"}
          </span>
        </Show>
        <Show when={!isExpandable(node())}>
          <span style={{ width: "14px" }} />
        </Show>

        {/* leaf value / edit input */}
        <Show when={isLeaf()}>
          <Show
            when={isEditing()}
            fallback={
              <span
                style={{
                  color: getValueColor(node().type) || vscode.foreground,
                  cursor: props.isReadOnly ? "default" : "text",
                  "font-family": "monospace",
                }}
                onClick={startEdit}
              >
                {node().type === "string"
                  ? `"${(node() as any).value}"`
                  : String((node() as any).value)}
              </span>
            }
          >
            <input
              ref={(el) => setTimeout(() => { el?.focus(); el?.select(); }, 0)}
              value={props.editVal}
              onInput={(e) => props.onEditValChange(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); props.onCommitEdit(props.path); }
                if (e.key === "Escape") { e.preventDefault(); props.onCancelEdit(); }
              }}
              style={{
                background: vscode.inputBg,
                color: vscode.inputFg,
                border: `1px solid ${vscode.accent}`,
                "border-radius": "3px",
                padding: "1px 4px",
                "font-family": "monospace",
                "font-size": "13px",
                outline: "none",
                "min-width": "80px",
              }}
            />
          </Show>
          {/* type badge */}
          <span
            style={{
              "font-size": "10px",
              background: vscode.listSelectInactive,
              color: vscode.foregroundDim,
              "border-radius": "3px",
              padding: "0 4px",
              "margin-left": "4px",
            }}
          >
            {node().type}
          </span>
        </Show>

        <Show when={!isLeaf()}>
          <span style={{ color: vscode.foregroundDim, "font-size": "12px" }}>
            {node().type === "object"
              ? `{${(node() as JsonObject).entries.length}}`
              : `[${(node() as any).items.length}]`}
          </span>
        </Show>

        {/* action buttons */}
        <Show when={!props.isReadOnly}>
          <Show when={node().type === "object"}>
            <button onClick={() => props.onAddChild(props.path, "object")} title="+ 字段" style={btnStyle()}>
              + 字段
            </button>
          </Show>
          <Show when={node().type === "array"}>
            <button onClick={() => props.onAddChild(props.path, "array")} title="+ 元素" style={btnStyle()}>
              + 元素
            </button>
          </Show>
          <Show when={props.path.length > 0}>
            <button onClick={() => props.onDelete(props.path)} title="删除" style={{ ...btnStyle(), color: vscode.error }}>
              ×
            </button>
          </Show>
        </Show>
      </div>

      {/* children */}
      <Show when={isExpandable(node()) && expanded()}>
        <Show when={node().type === "object"}>
          <For each={(node() as JsonObject).entries}>
            {(entry) => (
              <div style={{ display: "flex", "align-items": "flex-start" }}>
                <span
                  style={{
                    "padding-left": `${(props.depth + 1) * 16}px`,
                    color: vscode.foreground,
                    "font-family": "monospace",
                    "font-size": "13px",
                    "padding-top": "2px",
                    "white-space": "nowrap",
                  }}
                >
                  "{entry.key}":&nbsp;
                </span>
                <div style={{ flex: "1" }}>
                  <TreeNode
                    node={entry.value}
                    path={[...props.path, entry.key]}
                    depth={props.depth + 1}
                    isReadOnly={props.isReadOnly}
                    columnName={props.columnName}
                    editingPath={props.editingPath}
                    editVal={props.editVal}
                    onStartEdit={props.onStartEdit}
                    onCommitEdit={props.onCommitEdit}
                    onCancelEdit={props.onCancelEdit}
                    onEditValChange={props.onEditValChange}
                    onUpdate={props.onUpdate}
                    onDelete={props.onDelete}
                    onAddChild={props.onAddChild}
                    onContextMenu={props.onContextMenu}
                  />
                </div>
              </div>
            )}
          </For>
        </Show>
        <Show when={node().type === "array"}>
          <For each={(node() as any).items}>
            {(item: JsonNode, idx) => (
              <div style={{ display: "flex", "align-items": "flex-start" }}>
                <span
                  style={{
                    "padding-left": `${(props.depth + 1) * 16}px`,
                    color: vscode.foregroundDim,
                    "font-family": "monospace",
                    "font-size": "13px",
                    "padding-top": "2px",
                    "white-space": "nowrap",
                  }}
                >
                  [{idx()}]:&nbsp;
                </span>
                <div style={{ flex: "1" }}>
                  <TreeNode
                    node={item}
                    path={[...props.path, idx()]}
                    depth={props.depth + 1}
                    isReadOnly={props.isReadOnly}
                    columnName={props.columnName}
                    editingPath={props.editingPath}
                    editVal={props.editVal}
                    onStartEdit={props.onStartEdit}
                    onCommitEdit={props.onCommitEdit}
                    onCancelEdit={props.onCancelEdit}
                    onEditValChange={props.onEditValChange}
                    onUpdate={props.onUpdate}
                    onDelete={props.onDelete}
                    onAddChild={props.onAddChild}
                    onContextMenu={props.onContextMenu}
                  />
                </div>
              </div>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}

function btnStyle() {
  return {
    background: "transparent",
    border: "none",
    color: vscode.foregroundDim,
    cursor: "pointer",
    "font-size": "11px",
    padding: "0 4px",
    "border-radius": "3px",
  };
}

// ─── TreeView ─────────────────────────────────────────────────────────────────

interface TreeViewProps {
  node: JsonNode;
  isReadOnly: boolean;
  columnName?: string;
  onUpdate: (path: (string | number)[], newValue: JsonValue) => void;
  onDelete: (path: (string | number)[]) => void;
  onAddChild: (path: (string | number)[], type: "object" | "array") => void;
}

function TreeView(props: TreeViewProps) {
  const [ctxMenu, setCtxMenu] = createSignal<ContextMenuState>({
    visible: false, x: 0, y: 0, items: [],
  });
  // 编辑状态提升到此层，避免 <For> 重渲染时销毁 input
  const [editingPath, setEditingPath] = createSignal<string | null>(null);
  const [editVal, setEditVal] = createSignal("");

  function handleStartEdit(pathKey: string, initialVal: string) {
    setEditingPath(pathKey);
    setEditVal(initialVal);
  }

  function handleCommitEdit(path: (string | number)[]) {
    const parsed = parseFormValue(editVal());
    props.onUpdate(path, parsed);
    setEditingPath(null);
    setEditVal("");
  }

  function handleCancelEdit() {
    setEditingPath(null);
    setEditVal("");
  }

  function showContextMenu(e: MouseEvent, items: { label: string; action: () => void }[]) {
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, items });
  }

  function hideContextMenu() {
    setCtxMenu((s) => ({ ...s, visible: false }));
  }

  return (
    <div
      style={{ position: "relative", overflow: "auto", height: "100%" }}
      onClick={hideContextMenu}
    >
      <TreeNode
        node={props.node}
        path={[]}
        depth={0}
        isReadOnly={props.isReadOnly}
        columnName={props.columnName}
        editingPath={editingPath()}
        editVal={editVal()}
        onStartEdit={handleStartEdit}
        onCommitEdit={handleCommitEdit}
        onCancelEdit={handleCancelEdit}
        onEditValChange={setEditVal}
        onUpdate={props.onUpdate}
        onDelete={props.onDelete}
        onAddChild={props.onAddChild}
        onContextMenu={showContextMenu}
      />
      <Show when={ctxMenu().visible}>
        <div
          style={{
            position: "fixed",
            top: `${ctxMenu().y}px`,
            left: `${ctxMenu().x}px`,
            background: vscode.sidebarBg,
            border: `1px solid ${vscode.border}`,
            "border-radius": "4px",
            "z-index": "9999",
            "min-width": "140px",
            "box-shadow": "0 4px 12px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <For each={ctxMenu().items}>
            {(item) => (
              <div
                style={{
                  padding: "6px 12px",
                  cursor: "pointer",
                  color: vscode.foreground,
                  "font-size": "13px",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = vscode.listHover)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                onClick={() => { item.action(); hideContextMenu(); }}
              >
                {item.label}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

// ─── FormView ─────────────────────────────────────────────────────────────────
//
// 关键修复：用独立的 createStore<FormEntry[]> 存储表单数据，
// 用 setFormEntries(i, "key", val) / setFormEntries(i, "value", val) 细粒度更新，
// <For> 里的 input 不会因为 rootNode 替换而被重建，光标不会丢失。

interface FormEntry {
  key: string;
  value: string;
}

interface FormViewProps {
  rootNode: JsonNode;
  isReadOnly: boolean;
  onCommit: (entries: FormEntry[]) => void;
}

function FormView(props: FormViewProps) {
  // 独立 store，完全自治，不依赖外部 rootNode 变化
  const [formEntries, setFormEntries] = createStore<FormEntry[]>([]);

  // 初始化：只在首次挂载时从 rootNode 同步
  const node = props.rootNode;
  if (node.type === "object") {
    setFormEntries(node.entries.map((e) => ({
      key: e.key,
      value: e.value.type === "string"
        ? (e.value as any).value
        : e.value.type === "null"
        ? "null"
        : String((e.value as any).value ?? ""),
    })));
  }

  function deleteKey(index: number) {
    setFormEntries((prev) => prev.filter((_, i) => i !== index));
    // 同步通知父组件
    const updated = formEntries.filter((_, i) => i !== index);
    props.onCommit(updated.map(e => ({ key: e.key, value: e.value })));
  }

  function addKey() {
    setFormEntries((prev) => [...prev, { key: "", value: "" }]);
  }

  const nodeType = () => props.rootNode.type;

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <Show
        when={nodeType() === "object"}
        fallback={
          <div
            style={{
              color: vscode.foregroundDim,
              padding: "16px",
              "text-align": "center",
              "font-size": "13px",
            }}
          >
            表单视图仅支持 JSON 对象类型。请切换到 Tree 或 Raw 模式编辑数组。
          </div>
        }
      >
        <div style={{ display: "flex", "flex-direction": "column", gap: "6px", padding: "4px 0" }}>
          <For each={formEntries}>
            {(entry, i) => (
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <input
                  value={entry.key}
                  readOnly={props.isReadOnly}
                  onInput={(e) => setFormEntries(i(), "key", e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      props.onCommit(formEntries.map(e => ({ key: e.key, value: e.value })));
                    }
                  }}
                  onBlur={() => props.onCommit(formEntries.map(e => ({ key: e.key, value: e.value })))}
                  placeholder="键名"
                  style={formInputStyle()}
                />
                <span style={{ color: vscode.foregroundDim }}>:</span>
                <input
                  value={entry.value}
                  readOnly={props.isReadOnly}
                  onInput={(e) => setFormEntries(i(), "value", e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      props.onCommit(formEntries.map(e => ({ key: e.key, value: e.value })));
                    }
                  }}
                  onBlur={() => props.onCommit(formEntries.map(e => ({ key: e.key, value: e.value })))}
                  placeholder="值"
                  style={formInputStyle()}
                />
                <Show when={!props.isReadOnly}>
                  <button
                    onClick={() => deleteKey(i())}
                    style={{ ...btnStyle(), color: vscode.error, "font-size": "14px" }}
                  >
                    ×
                  </button>
                </Show>
              </div>
            )}
          </For>
          <Show when={!props.isReadOnly}>
            <button
              onClick={addKey}
              style={{
                "align-self": "flex-start",
                background: vscode.buttonSecondary,
                color: vscode.foreground,
                border: "none",
                "border-radius": "4px",
                padding: "4px 12px",
                cursor: "pointer",
                "font-size": "12px",
                "margin-top": "4px",
              }}
            >
              + 添加字段
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}

function formInputStyle() {
  return {
    flex: "1",
    background: vscode.inputBg,
    color: vscode.inputFg,
    border: `1px solid ${vscode.inputBorder}`,
    "border-radius": "4px",
    padding: "4px 8px",
    "font-size": "13px",
    outline: "none",
    "font-family": "monospace",
  };
}

// ─── JSONB_Editor 主组件 ──────────────────────────────────────────────────────

export interface JsonbEditorProps {
  initialValue: string | null;
  isReadOnly: boolean;
  onSave: (value: string | null) => void;
  onClose: () => void;
}

export function JSONB_Editor(props: JsonbEditorProps) {
  // Parse initial value
  const parseResult = parseJsonSafe(props.initialValue);
  const initialNode: JsonNode = parseResult.ok
    ? parseResult.node
    : { type: "object", entries: [] };
  const initialParseError = parseResult.ok ? null : parseResult.error;

  const [mode, setMode] = createSignal<"tree" | "form" | "raw">(
    initialParseError ? "raw" : "tree"
  );
  const [rootNode, setRootNode] = createSignal<JsonNode>(initialNode);

  // Raw 模式：本地文本 signal，不立即解析
  const [rawText, setRawText] = createSignal(
    initialParseError
      ? (props.initialValue ?? "")
      : serializePretty(initialNode)
  );
  const [rawError, setRawError] = createSignal<string | null>(initialParseError);

  // Escape 键关闭 modal — 只在焦点不在 input/textarea 时关闭
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      props.onClose();
    }
  }
  document.addEventListener("keydown", handleKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  function switchMode(target: "tree" | "form" | "raw") {
    const current = mode();
    if (current === target) return;

    if (current === "raw") {
      // 离开 raw 模式前验证
      const result = parseJsonSafe(rawText());
      if (!result.ok) {
        setRawError(result.error);
        return; // 阻止切换
      }
      setRootNode(result.node);
      setRawError(null);
    }

    if (target === "raw") {
      setRawText(serializePretty(rootNode()));
      setRawError(null);
    }

    setMode(target);
  }

  function handleRawChange(text: string) {
    setRawText(text);
    const result = parseJsonSafe(text);
    setRawError(result.ok ? null : result.error);
  }

  function handleRawFormat() {
    const result = parseJsonSafe(rawText());
    if (result.ok) {
      setRawText(serializePretty(result.node));
      setRawError(null);
    } else {
      setRawError(result.error);
    }
  }

  function handleUpdate(path: (string | number)[], newValue: JsonValue) {
    setRootNode(updateAtPath(rootNode(), path, newValue));
  }

  function handleDelete(path: (string | number)[]) {
    setRootNode(deleteAtPath(rootNode(), path));
  }

  function handleAddChild(path: (string | number)[], _type: "object" | "array") {
    function addChildAt(node: JsonNode, remaining: (string | number)[]): JsonNode {
      if (remaining.length === 0) {
        if (node.type === "object") {
          return {
            type: "object",
            entries: [...node.entries, { key: "newKey", value: { type: "null", value: null } }],
          };
        }
        if (node.type === "array") {
          return { type: "array", items: [...node.items, { type: "null", value: null }] };
        }
        return node;
      }
      const [head, ...tail] = remaining;
      if (node.type === "object" && typeof head === "string") {
        return {
          type: "object",
          entries: node.entries.map((e) =>
            e.key === head ? { key: e.key, value: addChildAt(e.value, tail) } : e
          ),
        };
      }
      if (node.type === "array" && typeof head === "number") {
        return {
          type: "array",
          items: node.items.map((item, i) => (i === head ? addChildAt(item, tail) : item)),
        };
      }
      return node;
    }
    setRootNode(addChildAt(rootNode(), path));
  }

  // Form 视图提交：将 FormEntry[] 转换回 rootNode
  function handleFormCommit(entries: FormEntry[]) {
    const node = rootNode();
    if (node.type !== "object") return;
    setRootNode({
      type: "object",
      entries: entries.map((e) => ({
        key: e.key,
        value: toJsonNode(parseFormValue(e.value)),
      })),
    });
  }

  function handleFormDeleteKey(index: number) {
    const node = rootNode();
    if (node.type !== "object") return;
    setRootNode({
      type: "object",
      entries: node.entries.filter((_, i) => i !== index),
    });
  }

  function handleFormAddKey() {
    const node = rootNode();
    if (node.type !== "object") return;
    setRootNode({
      type: "object",
      entries: [...node.entries, { key: "", value: { type: "string", value: "" } }],
    });
  }

  function handleConfirm() {
    if (mode() === "raw") {
      const result = parseJsonSafe(rawText());
      if (!result.ok) {
        setRawError(result.error);
        return;
      }
      const originalResult = parseJsonSafe(props.initialValue);
      if (originalResult.ok && jsonNodesEqual(result.node, originalResult.node)) {
        props.onClose();
        return;
      }
      props.onSave(serializeCompact(result.node));
    } else {
      const originalResult = parseJsonSafe(props.initialValue);
      if (originalResult.ok && jsonNodesEqual(rootNode(), originalResult.node)) {
        props.onClose();
        return;
      }
      props.onSave(serializeCompact(rootNode()));
    }
  }

  const confirmDisabled = () => mode() === "raw" && rawError() !== null;

  const tabStyle = (active: boolean) => ({
    padding: "6px 16px",
    cursor: "pointer",
    background: active ? vscode.tabActiveBg : vscode.tabBarBg,
    color: active ? vscode.foreground : vscode.foregroundDim,
    border: "none",
    "border-bottom": active ? `2px solid ${vscode.accent}` : "2px solid transparent",
    "font-size": "13px",
    "border-radius": "4px 4px 0 0",
  });

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: "fixed",
          inset: "0",
          background: "rgba(0,0,0,0.5)",
          "z-index": "1000",
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
      >
        {/* Modal */}
        <div
          ref={(el) => setTimeout(() => el?.focus(), 0)}
          tabIndex={-1}
          style={{
            width: "700px",
            "max-height": "80vh",
            background: vscode.editorBg,
            border: `1px solid ${vscode.border}`,
            "border-radius": "6px",
            display: "flex",
            "flex-direction": "column",
            "box-shadow": "0 8px 32px rgba(0,0,0,0.6)",
            outline: "none",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            style={{
              padding: "12px 16px",
              "border-bottom": `1px solid ${vscode.border}`,
              color: vscode.foreground,
              "font-size": "14px",
              "font-weight": "600",
            }}
          >
            {props.isReadOnly ? "查看 JSON" : "编辑 JSON"}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", "border-bottom": `1px solid ${vscode.border}` }}>
            <button style={tabStyle(mode() === "tree")} onClick={() => switchMode("tree")}>Tree</button>
            <button style={tabStyle(mode() === "form")} onClick={() => switchMode("form")}>Form</button>
            <button style={tabStyle(mode() === "raw")} onClick={() => switchMode("raw")}>Raw</button>
          </div>

          {/* Raw 模式错误提示 */}
          <Show when={mode() === "raw" && rawError()}>
            <div
              style={{
                color: vscode.error,
                "font-size": "12px",
                padding: "4px 16px",
                background: "rgba(244,135,113,0.08)",
              }}
            >
              {rawError()}
            </div>
          </Show>

          {/* Content */}
          <div style={{ flex: "1", overflow: "auto", padding: "12px 16px", "min-height": "0" }}>
            <Show when={mode() === "tree"}>
              <TreeView
                node={rootNode()}
                isReadOnly={props.isReadOnly}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
                onAddChild={handleAddChild}
              />
            </Show>
            <Show when={mode() === "form"}>
              <FormView
                rootNode={rootNode()}
                isReadOnly={props.isReadOnly}
                onCommit={handleFormCommit}
              />
            </Show>
            <Show when={mode() === "raw"}>
              <RawMode
                initialText={rawText()}
                error={rawError()}
                isReadOnly={props.isReadOnly}
                onChange={handleRawChange}
                onFormat={handleRawFormat}
              />
            </Show>
          </div>

          {/* Footer */}
          <div
            style={{
              padding: "10px 16px",
              "border-top": `1px solid ${vscode.border}`,
              display: "flex",
              "justify-content": "flex-end",
              gap: "8px",
            }}
          >
            <Show
              when={!props.isReadOnly}
              fallback={
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
                  关闭
                </button>
              }
            >
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
                取消
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmDisabled()}
                style={{
                  background: confirmDisabled() ? vscode.buttonSecondary : vscode.buttonBg,
                  color: confirmDisabled() ? vscode.foregroundDim : vscode.foreground,
                  border: "none",
                  "border-radius": "4px",
                  padding: "6px 16px",
                  cursor: confirmDisabled() ? "not-allowed" : "pointer",
                  "font-size": "13px",
                }}
              >
                确认
              </button>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}
