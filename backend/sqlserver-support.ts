/**
 * SQL Server：EXPLAIN、分区元数据、会话监控（与 sqlserver-db-handlers 解耦的纯查询逻辑）
 */
import sql from "mssql";

/** node-mssql/tedious 对 XML 列的占位列名（SHOWPLAN 等） */
const MSSQL_XML_COLUMN_ID = "XML_F52E2B61-18A1-11d1-B105-00805F49916B";

function cellToUtf8String(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) return v.toString("utf8");
  if (v instanceof Uint8Array) return Buffer.from(v).toString("utf8");
  return String(v);
}

function looksLikeShowplanXml(s: string): boolean {
  const t = s.trimStart();
  if (!t) return false;
  return (
    t.includes("ShowPlanXML") ||
    t.includes("<ShowPlan") ||
    (t.includes("schemas.microsoft.com/sqlserver") && t.includes("showplan")) ||
    (t.includes("<?xml") && t.includes("showplan")) ||
    (t.startsWith("<") && (t.includes("StmtSimple") || t.includes("StmtCursor") || t.includes("RelOp"))) ||
    (t.includes("QueryPlan") && t.includes("xmlns")) ||
    (t.includes("PhysicalOp") && t.includes("EstimatedTotalSubtreeCost"))
  );
}

/** 遍历 mssql 返回对象（含嵌套），防止计划 XML 落在非 recordsets 路径 */
function deepFindShowplanXml(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): string {
  if (depth > 14) return "";
  if (value == null) return "";
  if (typeof value === "string") return looksLikeShowplanXml(value) ? value : "";
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    const s = value.toString("utf8");
    return looksLikeShowplanXml(s) ? s : "";
  }
  if (value instanceof Uint8Array) {
    const s = Buffer.from(value).toString("utf8");
    return looksLikeShowplanXml(s) ? s : "";
  }
  if (Array.isArray(value)) {
    for (const x of value) {
      const h = deepFindShowplanXml(x, seen, depth + 1);
      if (h) return h;
    }
    return "";
  }
  if (typeof value === "object") {
    const o = value as object;
    if (seen.has(o)) return "";
    seen.add(o);
    for (const v of Object.values(o)) {
      const h = deepFindShowplanXml(v, seen, depth + 1);
      if (h) return h;
    }
  }
  return "";
}

function firstXmlPlanFromRecordsets(recordsets: unknown): string {
  const sets = recordsets as unknown[][];
  if (!Array.isArray(sets)) return "";
  for (const rs of sets) {
    if (!Array.isArray(rs) || rs.length === 0) continue;
    for (const row of rs) {
      if (row == null) continue;
      if (Array.isArray(row)) {
        for (const v of row) {
          const s = cellToUtf8String(v);
          if (looksLikeShowplanXml(s)) return s;
        }
        continue;
      }
      if (typeof row === "object") {
        const rec = row as Record<string, unknown>;
        const xmlCol =
          rec[MSSQL_XML_COLUMN_ID] ??
          Object.entries(rec).find(([k]) => k.toLowerCase() === MSSQL_XML_COLUMN_ID.toLowerCase())?.[1];
        if (xmlCol != null) {
          const s = cellToUtf8String(xmlCol);
          if (looksLikeShowplanXml(s)) return s;
        }
        for (const v of Object.values(rec)) {
          const s = cellToUtf8String(v);
          if (looksLikeShowplanXml(s)) return s;
        }
      }
    }
  }
  const concatenated = concatAllCellsFromRecordsets(recordsets);
  if (looksLikeShowplanXml(concatenated)) return concatenated;
  return "";
}

/** 列名大小写或分片行导致逐格匹配失败时，按行顺序拼接单元格再识别 */
function concatAllCellsFromRecordsets(recordsets: unknown): string {
  const sets = recordsets as unknown[][];
  if (!Array.isArray(sets)) return "";
  const parts: string[] = [];
  for (const rs of sets) {
    if (!Array.isArray(rs)) continue;
    for (const row of rs) {
      if (row == null) continue;
      if (Array.isArray(row)) {
        for (const v of row) parts.push(cellToUtf8String(v));
      } else if (typeof row === "object") {
        for (const v of Object.values(row as Record<string, unknown>)) parts.push(cellToUtf8String(v));
      }
    }
  }
  return parts.join("");
}

function recordsetsFromMssqlResult(result: { recordsets?: unknown; recordset?: unknown }): unknown[][] {
  const raw = result.recordsets;
  if (raw != null && typeof (raw as { length?: number }).length === "number" && (raw as { length: number }).length > 0) {
    const arr = Array.isArray(raw) ? (raw as unknown[][]) : Array.from(raw as Iterable<unknown[]>);
    if (arr.length > 0) return arr as unknown[][];
  }
  const single = result.recordset as unknown[] | undefined;
  if (Array.isArray(single) && single.length > 0) return [single];
  return [];
}

/**
 * 占住池里一条连接但不 `BEGIN TRAN`。显式事务下 SHOWPLAN 往往拿不到 XML，故不用 sql.Transaction。
 * SHOWPLAN_* 仍须：SET 单独一批、用户 SQL 单独一批、SET OFF 单独一批，且同一会话。
 */
function sqlServerPinPoolConnection(pool: sql.ConnectionPool): {
  readonly parent: sql.ConnectionPool;
  dispose: () => void;
} {
  let acquired: unknown = null;
  let activeRequest: unknown = null;

  const parent = {
    get config() {
      return pool.config;
    },
    get connected() {
      return pool.connected;
    },
    get collation() {
      return (pool as sql.ConnectionPool & { collation?: string }).collation;
    },
    acquire(request: unknown, callback: (err: Error | null | undefined, connection?: unknown, config?: unknown) => void) {
      if (!acquired) {
        pool.acquire(pool as sql.ConnectionPool, (err: Error | null | undefined, c?: unknown, cfg?: unknown) => {
          if (err) return callback(err);
          acquired = c;
          activeRequest = request;
          callback(null, c, cfg ?? pool.config);
        });
        return parent;
      }
      if (activeRequest) {
        const e = new Error("Can't acquire connection for the request. There is another request in progress.");
        (e as NodeJS.ErrnoException).code = "EREQINPROG";
        setImmediate(() => callback(e));
        return parent;
      }
      activeRequest = request;
      setImmediate(() => callback(null, acquired, pool.config));
      return parent;
    },
    release(connection: unknown) {
      if (connection === acquired) activeRequest = null;
      return parent;
    },
  } as unknown as sql.ConnectionPool;

  return {
    parent,
    dispose() {
      if (acquired != null) {
        try {
          pool.release(acquired as never);
        } catch {
          /* ignore */
        }
        acquired = null;
      }
    },
  };
}

async function sqlServerWithShowplanSession<T>(
  pool: sql.ConnectionPool,
  mode: "SHOWPLAN_XML" | "SHOWPLAN_ALL",
  runWithShowplanOn: (connParent: sql.ConnectionPool) => Promise<T>
): Promise<T> {
  const pin = sqlServerPinPoolConnection(pool);
  const req = () => new sql.Request(pin.parent);
  try {
    await req().query(`SET ${mode} ON;`);
    const out = await runWithShowplanOn(pin.parent);
    await req().query(`SET ${mode} OFF;`);
    return out;
  } catch (e) {
    try {
      await req().query(`SET ${mode} OFF;`);
    } catch {
      /* 避免连接回到池里仍开着 SHOWPLAN */
    }
    throw e;
  } finally {
    pin.dispose();
  }
}

/** 不执行查询的估算计划（SHOWPLAN_XML） */
export async function sqlServerFetchEstimatedPlanXml(pool: sql.ConnectionPool, userSql: string): Promise<string> {
  const q = userSql.trim();
  if (!q) return "";
  return sqlServerWithShowplanSession(pool, "SHOWPLAN_XML", async (connParent) => {
    const result = await new sql.Request(connParent).query(q);
    const fromRs = firstXmlPlanFromRecordsets(recordsetsFromMssqlResult(result));
    if (fromRs.trim()) return fromRs;
    const deep = deepFindShowplanXml(result);
    return deep.trim() ? deep : "";
  });
}

/** SHOWPLAN_ALL 文本行（不执行查询） */
export async function sqlServerFetchExplainTextLines(pool: sql.ConnectionPool, userSql: string): Promise<string[]> {
  const q = userSql.trim();
  if (!q) throw new Error("SQL 为空");
  return sqlServerWithShowplanSession(pool, "SHOWPLAN_ALL", async (connParent) => {
    const result = await new sql.Request(connParent).query(q);
    const lines: string[] = [];
    const sets = recordsetsFromMssqlResult(result);
    for (const rs of sets) {
      if (!Array.isArray(rs)) continue;
      for (const row of rs) {
        if (row == null) continue;
        if (Array.isArray(row)) {
          lines.push(row.map((c) => cellToUtf8String(c)).join(" | ").trim() || "—");
          continue;
        }
        if (typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        const stmt = r.StmtText ?? r.stmt_text;
        if (stmt != null && String(stmt).trim()) {
          lines.push(String(stmt).trim());
          continue;
        }
        lines.push(
          Object.entries(r)
            .map(([k, v]) => `${k}: ${v === null || v === undefined ? "" : cellToUtf8String(v)}`)
            .join(" | ")
        );
      }
    }
    return lines.length > 0 ? lines : ["（无 SHOWPLAN 行；可能仅含 SET 语句或批处理为空）"];
  });
}

export type SqlServerPartitionInfoResult =
  | { role: "none" }
  | {
      role: "parent";
      strategy: string | null;
      partitionKey: string | null;
      partitions: Array<{ schema: string; name: string; qualified: string; bound: string }>;
    };

export async function sqlServerFetchPartitionInfo(
  pool: sql.ConnectionPool,
  schema: string,
  table: string
): Promise<SqlServerPartitionInfoResult> {
  const oidR = await pool
    .request()
    .input("sch", sql.NVarChar, schema)
    .input("tbl", sql.NVarChar, table)
    .query(`
      SELECT t.object_id AS oid
      FROM sys.tables t
      INNER JOIN sys.schemas s ON t.schema_id = s.schema_id
      WHERE s.name = @sch AND t.name = @tbl
    `);
  const oidRow = (oidR.recordset ?? [])[0] as { oid?: number } | undefined;
  const oid = oidRow?.oid;
  if (oid == null) throw new Error(`表不存在: ${schema}.${table}`);

  const partR = await pool.request().input("oid", sql.Int, oid).query(`
    SELECT
      p.partition_number,
      COALESCE(MAX(s.row_count), 0) AS row_count
    FROM sys.partitions p
    LEFT JOIN sys.dm_db_partition_stats s
      ON p.partition_id = s.partition_id AND s.index_id = p.index_id
    WHERE p.object_id = @oid AND p.index_id <= 1
    GROUP BY p.partition_number
    ORDER BY p.partition_number
  `);
  const prow = (partR.recordset ?? []) as Array<{ partition_number?: number; row_count?: number | bigint }>;
  if (prow.length <= 1) return { role: "none" };

  let strategy: string | null = null;
  let partitionKey: string | null = null;
  try {
    const metaR = await pool.request().input("oid", sql.Int, oid).query(`
      SELECT TOP 1 pf.type_desc AS type_desc,
        (
          SELECT STUFF((
            SELECT N', ' + c.name
            FROM sys.index_columns ic
            INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
            WHERE ic.object_id = @oid AND ic.index_id = ix.index_id AND ic.partition_ordinal > 0
            ORDER BY ic.partition_ordinal
            FOR XML PATH(N''), TYPE
          ).value(N'.[1]', N'nvarchar(max)'), 1, 2, N'')
        ) AS part_cols
      FROM sys.indexes ix
      INNER JOIN sys.partition_schemes ps ON ix.data_space_id = ps.data_space_id
      INNER JOIN sys.partition_functions pf ON ps.function_id = pf.function_id
      WHERE ix.object_id = @oid AND ix.index_id <= 1
    `);
    const m0 = (metaR.recordset ?? [])[0] as { type_desc?: string; part_cols?: string } | undefined;
    if (m0?.type_desc) strategy = String(m0.type_desc);
    if (m0?.part_cols) partitionKey = String(m0.part_cols);
  } catch {
    /* ignore */
  }

  const partitions = prow.map((r) => {
    const n = Number(r.partition_number ?? 0);
    const rc = r.row_count == null ? 0 : Number(r.row_count);
    return {
      schema,
      name: `partition_${n}`,
      qualified: `${schema}.${table} (#${n})`,
      bound: `partition_number=${n}; rows≈${rc}`,
    };
  });

  return {
    role: "parent",
    strategy: strategy ?? "SQL Server",
    partitionKey: partitionKey ?? null,
    partitions,
  };
}

export async function sqlServerFetchSessionMonitor(
  pool: sql.ConnectionPool,
  limit: number
): Promise<{
  connectionStats: { total: number; active: number; idle: number; waiting: number };
  lockWaits: Array<{
    waiting_pid: number;
    waiting_user: string;
    waiting_query: string;
    blocking_pid: number;
    blocking_user: string;
    blocking_query: string;
    wait_event_type?: string | null;
    wait_event?: string | null;
  }>;
  slowQueries: Array<Record<string, unknown>>;
  slowQuerySource: "mssql_requests";
  collectedAt: number;
}> {
  const lim = Math.min(Math.max(limit, 5), 200);

  const statsR = await pool.request().query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN s.status = N'running' THEN 1 ELSE 0 END) AS active,
      SUM(CASE WHEN s.status = N'sleeping' THEN 1 ELSE 0 END) AS idle,
      SUM(CASE WHEN s.status = N'running' AND wr.session_id IS NOT NULL THEN 1 ELSE 0 END) AS waiting
    FROM sys.dm_exec_sessions s
    LEFT JOIN (
      SELECT DISTINCT r.session_id
      FROM sys.dm_exec_requests r
      WHERE r.wait_type IS NOT NULL
        AND r.wait_type NOT IN (N'CXPACKET', N'CXCONSUMER', N'SOS_SCHEDULER_YIELD')
    ) wr ON wr.session_id = s.session_id
    WHERE s.is_user_process = 1
      AND (s.database_id = DB_ID() OR (s.database_id IS NULL AND DB_NAME() IS NOT NULL))
  `);
  const s0 = (statsR.recordset ?? [])[0] as Record<string, unknown> | undefined;
  const connectionStats = {
    total: Number(s0?.total ?? 0),
    active: Number(s0?.active ?? 0),
    idle: Number(s0?.idle ?? 0),
    waiting: Number(s0?.waiting ?? 0),
  };

  const blockR = await pool
    .request()
    .input("lim", sql.Int, lim)
    .query(`
      SELECT TOP (@lim)
        w.session_id AS waiting_pid,
        es.login_name AS waiting_user,
        LEFT(ISNULL(CAST(twait.text AS nvarchar(max)), N''), 240) AS waiting_query,
        w.blocking_session_id AS blocking_pid,
        esb.login_name AS blocking_user,
        LEFT(ISNULL(CAST(tblock.text AS nvarchar(max)), N''), 240) AS blocking_query,
        CONVERT(nvarchar(128), w.wait_type) AS wait_event_type,
        CONVERT(nvarchar(256), w.wait_resource) AS wait_event
      FROM sys.dm_exec_requests w
      INNER JOIN sys.dm_exec_sessions es ON w.session_id = es.session_id
      INNER JOIN sys.dm_exec_sessions esb ON w.blocking_session_id = esb.session_id
      OUTER APPLY sys.dm_exec_sql_text(w.sql_handle) AS twait
      OUTER APPLY (
        SELECT TOP 1 r2.sql_handle AS sql_handle
        FROM sys.dm_exec_requests r2
        WHERE r2.session_id = w.blocking_session_id
      ) AS bh
      OUTER APPLY sys.dm_exec_sql_text(bh.sql_handle) AS tblock
      WHERE w.blocking_session_id > 0 AND w.session_id <> @@SPID
      ORDER BY w.wait_time DESC
    `);

  const lockWaits = ((blockR.recordset ?? []) as Array<Record<string, unknown>>).map((r) => ({
    waiting_pid: Number(r.waiting_pid ?? 0),
    waiting_user: String(r.waiting_user ?? ""),
    waiting_query: String(r.waiting_query ?? ""),
    blocking_pid: Number(r.blocking_pid ?? 0),
    blocking_user: String(r.blocking_user ?? ""),
    blocking_query: String(r.blocking_query ?? ""),
    wait_event_type: r.wait_event_type != null ? String(r.wait_event_type) : null,
    wait_event: r.wait_event != null ? String(r.wait_event) : null,
  }));

  const slowR = await pool
    .request()
    .input("lim2", sql.Int, lim)
    .query(`
      SELECT TOP (@lim2)
        r.session_id AS id,
        s.login_name AS [user],
        s.host_name AS host,
        DB_NAME(r.database_id) AS db,
        r.status AS command,
        CONVERT(float, r.total_elapsed_time) / 1000.0 AS time_seconds,
        r.status AS state,
        LEFT(ISNULL(CAST(t.text AS nvarchar(max)), N''), 400) AS query,
        r.cpu_time AS cpu_ms
      FROM sys.dm_exec_requests r
      INNER JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
      OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
      WHERE r.session_id <> @@SPID AND s.is_user_process = 1
      ORDER BY r.total_elapsed_time DESC
    `);

  const slowQueries = (slowR.recordset ?? []) as Array<Record<string, unknown>>;

  return {
    connectionStats,
    lockWaits,
    slowQueries,
    slowQuerySource: "mssql_requests",
    collectedAt: Date.now(),
  };
}

export async function sqlServerGetOwnSpid(pool: sql.ConnectionPool): Promise<number> {
  const r = await pool.request().query(`SELECT @@SPID AS spid`);
  const row = (r.recordset ?? [])[0] as { spid?: number } | undefined;
  return Number(row?.spid ?? 0);
}

/** cancel：优先 KILL QUERY(session)（SQL Server 2022+），失败则回退为 KILL session */
export async function sqlServerSessionControl(
  pool: sql.ConnectionPool,
  pid: number,
  action: "cancel" | "terminate"
): Promise<boolean> {
  const sid = Math.floor(Number(pid));
  if (!Number.isFinite(sid) || sid <= 0) return false;
  if (action === "terminate") {
    try {
      await pool.request().query(`KILL ${sid}`);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await pool.request().query(`KILL QUERY ${sid}`);
    return true;
  } catch {
    try {
      await pool.request().query(`KILL ${sid}`);
      return true;
    } catch {
      return false;
    }
  }
}
