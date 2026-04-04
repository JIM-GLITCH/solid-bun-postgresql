/**
 * SQL Server：node-mssql Request.stream + arrayRowMode + pause/resume 反压，
 * 在单条事务连接上执行前置批处理后再流式 SELECT，供 db/query-stream / query-stream-more。
 */
import sql from "mssql";
import {
  mssqlRecordsetColumnsToSqlServerMeta,
  type MssqlArrayRecordsetColumn,
  type SqlServerColumnMeta,
} from "./sqlserver-mssql-query";

type RowWaiter = {
  resolve: () => void;
  reject: (e: Error) => void;
  minRows: number;
};

function notifyWaiters(h: SqlServerStreamingQueryHandle) {
  h.waiters = h.waiters.filter((w) => {
    if (h.error) {
      w.reject(h.error);
      return false;
    }
    if (h.buffer.length >= w.minRows || h.streamDone) {
      w.resolve();
      return false;
    }
    return true;
  });
}

export type SqlServerStreamingQueryHandle = {
  transaction: import("mssql").Transaction;
  mssqlRequest: import("mssql").Request | null;
  buffer: unknown[][];
  columnMeta: SqlServerColumnMeta[];
  streamDone: boolean;
  transactionEnded: boolean;
  error: Error | null;
  waiters: RowWaiter[];
  browseSourceSql: string;
  highWaterMark: number;
};

export async function waitSqlServerStreamDrain(
  h: SqlServerStreamingQueryHandle,
  minRows: number
): Promise<void> {
  if (h.error) throw h.error;
  if (h.buffer.length >= minRows || h.streamDone) return;
  await new Promise<void>((resolve, reject) => {
    h.waiters.push({ resolve, reject, minRows });
  });
}

async function endTransaction(handle: SqlServerStreamingQueryHandle): Promise<void> {
  if (handle.transactionEnded) return;
  try {
    if (handle.error) {
      await handle.transaction.rollback();
    } else {
      await handle.transaction.commit();
    }
  } catch {
    await handle.transaction.rollback().catch(() => {});
  }
  handle.transactionEnded = true;
}

export async function drainSqlServerStreamBatch(
  h: SqlServerStreamingQueryHandle,
  batchSize: number
): Promise<{ rows: unknown[][]; hasMore: boolean }> {
  if (h.error) throw h.error;
  const bs = Math.max(1, batchSize);
  await waitSqlServerStreamDrain(h, bs);
  const take = Math.min(bs, h.buffer.length);
  const rows = h.buffer.splice(0, take);
  const req = h.mssqlRequest;
  if (req && h.buffer.length < h.highWaterMark) {
    try {
      req.resume();
    } catch {
      /* ignore */
    }
  }
  const hasMore = h.buffer.length > 0 || !h.streamDone;
  return { rows, hasMore };
}

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

const BATCH_PREFIX = "SET ROWCOUNT 0;\n";

export async function startSqlServerStreamingQuery(
  pool: sql.ConnectionPool,
  options: {
    preambleBatches: string[];
    selectSql: string;
    browseSourceSql: string;
    batchSize?: number;
  }
): Promise<SqlServerStreamingQueryHandle> {
  const bs = Math.max(1, options.batchSize ?? 100);
  const highWaterMark = Math.max(bs * 2, 256);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  const h: SqlServerStreamingQueryHandle = {
    transaction,
    mssqlRequest: null,
    buffer: [],
    columnMeta: [],
    streamDone: false,
    transactionEnded: false,
    error: null,
    waiters: [],
    browseSourceSql: options.browseSourceSql,
    highWaterMark,
  };

  try {
    for (const b of options.preambleBatches) {
      const trimmed = b.trim();
      if (!trimmed) continue;
      await new sql.Request(transaction).query(BATCH_PREFIX + trimmed);
    }

    const selectBatch = BATCH_PREFIX + options.selectSql.trim();
    const streamReq = new sql.Request(transaction);
    streamReq.stream = true;
    streamReq.arrayRowMode = true;
    h.mssqlRequest = streamReq;

    const metaReady = new Promise<void>((resolve, reject) => {
      let settled = false;
      const ok = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        reject(e);
      };

      streamReq.on("recordset", (cols: MssqlArrayRecordsetColumn[]) => {
        if (h.columnMeta.length > 0 || h.buffer.length > 0) {
          h.buffer = [];
          h.columnMeta = [];
        }
        h.columnMeta = mssqlRecordsetColumnsToSqlServerMeta(cols ?? []);
        ok();
      });

      streamReq.on("row", (row: unknown) => {
        h.buffer.push(row as unknown[]);
        notifyWaiters(h);
        if (h.buffer.length >= h.highWaterMark) {
          try {
            streamReq.pause();
          } catch {
            /* ignore */
          }
        }
      });

      streamReq.on("error", (err: unknown) => {
        const e = err instanceof Error ? err : new Error(String(err));
        if (!h.error) h.error = e;
        notifyWaiters(h);
      });

      void streamReq.query(selectBatch).then(
        async () => {
          // INSERT/UPDATE/DELETE 等无列元数据时 tedious 不会发 recordset，须在此结束 metaReady，否则会永远卡在 await metaReady
          ok();
          h.streamDone = true;
          await endTransaction(h);
          notifyWaiters(h);
        },
        async (err: unknown) => {
          const e = err instanceof Error ? err : new Error(String(err));
          if (!h.error) h.error = e;
          h.streamDone = true;
          await endTransaction(h);
          notifyWaiters(h);
          if (!settled) fail(e);
        }
      );
    });

    await metaReady;
  } catch (e) {
    await teardownSqlServerRowStream(h);
    throw e;
  }

  return h;
}
