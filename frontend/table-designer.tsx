/**
 * 表设计器 - 路由入口
 * 统一使用 TableDesignerUnified 处理新建表和编辑表两种模式
 */

import { TableDesignerUnified } from "./table-designer-unified";

export interface TableDesignerProps {
  connectionId: string;
  connectionInfo: string;
  schema: string;
  table?: string;
  mode: "create" | "edit";
  onSuccess?: (connectionId: string, schema: string, savedTable?: string) => void;
}

export default function TableDesigner(props: TableDesignerProps) {
  return (
    <TableDesignerUnified
      connectionId={props.connectionId}
      connectionInfo={props.connectionInfo}
      schema={props.schema}
      table={props.table}
      mode={props.mode}
      onSuccess={props.onSuccess}
    />
  );
}
