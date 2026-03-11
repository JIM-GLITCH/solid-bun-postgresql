/**
 * 表设计器 - 路由到新建表/编辑表
 */

import TableDesignerCreate from "./table-designer-create";
import TableDesignerEdit from "./table-designer-edit";

export interface TableDesignerProps {
  connectionId: string;
  connectionInfo: string;
  schema: string;
  table?: string;
  mode: "create" | "edit";
  onSuccess?: (connectionId: string, schema: string) => void;
}

export default function TableDesigner(props: TableDesignerProps) {
  if (props.mode === "create") {
    return (
      <TableDesignerCreate
        connectionId={props.connectionId}
        connectionInfo={props.connectionInfo}
        schema={props.schema}
        onSuccess={props.onSuccess}
      />
    );
  }
  if (props.mode === "edit" && props.table) {
    return (
      <TableDesignerEdit
        connectionId={props.connectionId}
        connectionInfo={props.connectionInfo}
        schema={props.schema}
        table={props.table}
        onSuccess={props.onSuccess}
      />
    );
  }
  return null;
}
