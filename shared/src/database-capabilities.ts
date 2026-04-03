/**
 * 各方言默认能力（保守约定：新方言在未接线前应对未列出的能力视为 false）。
 * 与后端 `db/capabilities` 返回值应对齐；前端在缓存未命中时用作回退。
 */
import type { DatabaseCapabilities, DbKind } from "./types";

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
    };
  }
  if (kind === "mysql") {
    return {
      dialect: "mysql",
      streamingQuery: true,
      cancelQuery: true,
      explainAnalyzeJson: true,
      explainText: true,
      sessionMonitor: true,
      pgExtensionCatalog: false,
    };
  }
  const _exhaustive: never = kind;
  return _exhaustive;
}
