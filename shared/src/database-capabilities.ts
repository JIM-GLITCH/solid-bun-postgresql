/**
 * 各方言默认能力（保守约定：新方言在未接线前应对未列出的能力视为 false）。
 * 与后端 `db/capabilities` 返回值应对齐；前端在缓存未命中时用作回退。
 */
import { type DatabaseCapabilities, type DbKind, isMysqlFamily } from "./types";

export function defaultDatabaseCapabilities(kind: DbKind): DatabaseCapabilities {
  if (kind === "postgres") {
    return {
      dialect: "postgres",
      streamingQuery: true,
      cancelQuery: true,
      explainAnalyzeJson: true,
      explainText: true,
      sessionMonitor: true,
      pgExtensionCatalog: true,
      tableDesigner: true,
      resultCellEdit: true,
      visualQueryBuilder: true,
      fakeDataImport: true,
    };
  }
  if (isMysqlFamily(kind)) {
    return {
      dialect: kind,
      streamingQuery: true,
      cancelQuery: true,
      explainAnalyzeJson: true,
      explainText: true,
      sessionMonitor: true,
      pgExtensionCatalog: false,
      tableDesigner: true,
      resultCellEdit: true,
      visualQueryBuilder: true,
      fakeDataImport: true,
    };
  }
  if (kind === "sqlserver") {
    return {
      dialect: "sqlserver",
      streamingQuery: false,
      cancelQuery: false,
      explainAnalyzeJson: false,
      explainText: false,
      sessionMonitor: false,
      pgExtensionCatalog: false,
      tableDesigner: true,
      resultCellEdit: true,
      visualQueryBuilder: true,
      fakeDataImport: true,
    };
  }
  const _exhaustive: never = kind;
  return _exhaustive;
}
