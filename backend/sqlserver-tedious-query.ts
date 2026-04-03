/**
 * 使用与 node-mssql 相同的底层 tedious 连接执行查询，保留 TDS 列元数据（含 tableName），供结果集可编辑列计算。
 */
import { Request as TediousRequest } from "tedious";
import type { Connection } from "tedious";
import type sql from "mssql";

/** tedious `columnMetadata` 事件中的列（与 ColMetadata 一致） */
export type SqlServerTdsColumnMeta = {
  colName: string;
  tableName?: string | string[] | undefined;
  flags: number;
  type: import("tedious").DataType;
  collation?: unknown;
  precision?: number;
  scale?: number;
  dataLength?: number;
  udtInfo?: {
    typeName: string;
    dbname?: string;
    owningSchema?: string;
    assemblyName?: string;
  };
  schema?: unknown;
};

type PoolWithAcquire = sql.ConnectionPool & {
  acquire: (who: unknown) => Promise<Connection>;
  release: (c: Connection) => void;
};

function rowToValues(
  rowCols: Array<{ value: unknown }> | Record<string, { value: unknown }>,
  colNames: string[]
): unknown[] {
  if (Array.isArray(rowCols)) return rowCols.map((c) => c.value);
  const rec = rowCols as Record<string, { value: unknown }>;
  return colNames.map((n) => rec[n]?.value);
}

/**
 * 执行单批次查询，返回**第一个**结果集的行与列元数据（与 node-mssql 的 `recordset` = recordsets[0] 对齐）。
 */
export async function runSqlServerQueryWithTdsMetadata(
  pool: sql.ConnectionPool,
  sqlText: string
): Promise<{ rows: unknown[][]; tdsColumns: SqlServerTdsColumnMeta[] }> {
  const p = pool as unknown as PoolWithAcquire;
  const connection = await p.acquire(pool);
  try {
    return await new Promise((resolve, reject) => {
      type Rs = { columns: SqlServerTdsColumnMeta[]; rows: unknown[][] };
      const recordsets: Rs[] = [];
      let current: Rs = { columns: [], rows: [] };

      const req = new TediousRequest(sqlText, (err: Error | null | undefined) => {
        if (err) {
          reject(err);
          return;
        }
        if (current.columns.length > 0 || current.rows.length > 0) {
          recordsets.push(current);
        }
        const first = recordsets[0] ?? { columns: [], rows: [] };
        resolve({ rows: first.rows, tdsColumns: first.columns });
      });

      req.on("columnMetadata", (columns: SqlServerTdsColumnMeta[] | Record<string, SqlServerTdsColumnMeta>) => {
        const arr = (Array.isArray(columns) ? columns : Object.values(columns)) as SqlServerTdsColumnMeta[];
        if (current.columns.length > 0 || current.rows.length > 0) {
          recordsets.push(current);
        }
        current = { columns: arr, rows: [] };
      });

      req.on("row", (rowCols: Array<{ value: unknown }> | Record<string, { value: unknown }>) => {
        const names = current.columns.map((c) => c.colName);
        current.rows.push(rowToValues(rowCols, names));
      });

      connection.execSql(req);
    });
  } finally {
    p.release(connection);
  }
}
