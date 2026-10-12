/**
 * 仅用 node-mssql 执行查询并取列元数据（arrayRowMode），供网格结果与 browse / enrich 使用。
 *
 * 另放置「流式句柄的 teardown 原语」：它只依赖 handle 自身，放在此文件可让连接层
 * （`db/sessions.ts`）与业务 handler 都引用它，而**不产生模块环**。
 * （`sqlserver-mssql-stream` 引用本文件的类型，故此处只用 `import type` 反向引用，运行时无环。）
 */
import sql from "mssql";
import type { SqlServerStreamingQueryHandle } from "./sqlserver-mssql-stream";

/** 释放进行中的流式请求与事务（连接断开、重建、或开始新流式查询前调用） */
export async function teardownSqlServerRowStream(handle: SqlServerStreamingQueryHandle | undefined): Promise<void> {
  if (!handle) return;
  try {
    handle.mssqlRequest?.cancel();
  } catch {
    /* ignore */
  }
  if (!handle.transactionEnded) {
    try {
      await handle.transaction.rollback();
    } catch {
      /* ignore */
    }
    handle.transactionEnded = true;
  }
  const err = new Error("查询流已中断");
  for (const w of handle.waiters) {
    try {
      w.reject(err);
    } catch {
      /* ignore */
    }
  }
  handle.waiters = [];
}

/** mssql recordset（arrayRowMode）下 `result.columns` 中单列描述，与 lib/tedious/request createColumns 一致 */
export type MssqlArrayRecordsetColumn = {
  index: number;
  name: string;
  length?: number;
  type: unknown;
  scale?: number;
  precision?: number;
  nullable?: boolean;
  identity?: boolean;
  readOnly?: boolean;
  udt?: { name?: string; database?: string; schema?: string; assembly?: string };
};

/** 与方言无关的列元数据（仅来自 mssql，不含 tedious 类型） */
export type SqlServerColumnMeta = {
  colName: string;
  /** TDS 路径偶发带表名；纯 mssql recordset 通常无，靠 browse 补 */
  tableName?: string | string[] | undefined;
  flags: number;
  /** 可与 sql.TYPES.* 比较的 type（或 ISqlType 时取 .type） */
  mssqlType: unknown;
  precision?: number;
  scale?: number;
  dataLength?: number;
  udt?: { name?: string; database?: string; schema?: string; assembly?: string };
};

/** ISqlType `{ type: sql.TYPES.Int }` → 内层 type，便于 mssqlColumnDataTypeLabel 比较 */
export function normalizeMssqlJsType(t: unknown): unknown {
  if (t != null && typeof t === "object" && "type" in t) {
    return (t as { type: unknown }).type;
  }
  return t;
}

export function mssqlRecordsetColumnsToSqlServerMeta(cols: MssqlArrayRecordsetColumn[]): SqlServerColumnMeta[] {
  return cols.map((c) => {
    let flags = 0;
    if (c.nullable) flags |= 0x01;
    if (c.identity) flags |= 0x10;
    if (c.readOnly && !c.identity) flags |= 0x20;
    return {
      colName: String(c.name ?? ""),
      flags,
      mssqlType: normalizeMssqlJsType(c.type),
      dataLength: c.length,
      precision: c.precision,
      scale: c.scale,
      udt: c.udt,
    };
  });
}

/**
 * 执行单批次查询，返回第一个结果集的行（行数组）与列元数据。
 */
export async function runSqlServerQueryWithColumnMetadata(
  pool: sql.ConnectionPool,
  sqlText: string,
  opts?: { trackRequest?: (req: sql.Request | null) => void }
): Promise<{ rows: unknown[][]; columnMeta: SqlServerColumnMeta[] }> {
  const batch = `SET ROWCOUNT 0;\n${sqlText}`;
  const req = pool.request();
  opts?.trackRequest?.(req);
  try {
    req.arrayRowMode = true;
    const result = (await req.query(batch)) as {
      recordset: unknown[][];
      columns?: MssqlArrayRecordsetColumn[];
    };
    const rs = result.recordset ?? [];
    const rows = rs.map((r) => [...(r as unknown[])]);
    const columnMeta = mssqlRecordsetColumnsToSqlServerMeta(result.columns ?? []);
    return { rows, columnMeta };
  } finally {
    opts?.trackRequest?.(null);
  }
}
