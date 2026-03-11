/**
 * 只读 DDL 查看器
 */

import { vscode } from "./theme";

export interface DdlViewerProps {
  schema: string;
  table: string;
  ddl: string;
}

export default function DdlViewer(props: DdlViewerProps) {
  return (
    <div style={{ padding: "24px", overflow: "auto", height: "100%", display: "flex", "flex-direction": "column" }}>
      <h2 style={{ "font-size": "18px", margin: "0 0 8px 0", color: vscode.foreground }}>
        DDL: {props.schema}.{props.table}
      </h2>
      <div style={{ color: vscode.foregroundDim, "font-size": "13px", "margin-bottom": "16px" }}>只读 · 可选中复制</div>
      <pre
        style={{
          flex: 1,
          margin: 0,
          padding: "16px",
          "background-color": vscode.inputBg,
          color: vscode.foreground,
          border: `1px solid ${vscode.border}`,
          "border-radius": "8px",
          overflow: "auto",
          "font-size": "13px",
          "font-family": "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          "white-space": "pre-wrap",
          "word-break": "break-all",
          "user-select": "text",
        }}
      >
        {props.ddl || "-- 无内容"}
      </pre>
    </div>
  );
}
