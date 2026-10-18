/**
 * PostgreSQL 下所有 db/* 请求的实现（从 api-core 拆分，便于按 dbType 扩展其他库）。
 */
import type { ConnectDbRequest, DbKind, DatabaseCapabilities, SSEMessage } from "../shared/src";
import { calculateColumnEditable } from "./column-editable";
import type { Client, FieldDef } from "pg";
import type { SessionConnection } from "./session-connection";
import type { BorrowedClient, DbConnector } from "./db/contract";
import { connectSession } from "./db/sessions";
// import { Context, Effect } from "effect";
// import { z } from "zod";

/** 与 column-editable 内部一致的查询客户端形状（该类型未导出，此处复刻） */
type QueryClient = Client | import("pg").Pool;

/*
 * Effect 重构方案框架（暂未启用）
 * 
 * 以下代码展示了如何使用 Effect v4 重构 postgres-db-handlers
 * 由于 Effect v4 API 变化较大，需要逐步迁移
 * 
 * 重构要点：
 * 1. 使用 Context.Service 定义独立的 Context Tags
 * 2. 创建组合 Effect（CurrentConnector, CurrentSession 等）减少重复
 * 3. 将 sendSSEMessage 等工具函数改造为 Effect，自动获取 cid
 * 4. 使用 zod 进行 payload 验证
 * 5. 所有 handler 改为 Effect.gen 形式
 * 
 * 参考示例：
 
import { Context, Effect } from "effect";
import { z } from "zod";

// ========== Effect Context Tags ==========
export class GetConnId extends Context.Service<GetConnId, () => string>()("GetConnId") {}
export class ConnectorFor extends Context.Service<ConnectorFor, (cid: string) => DbConnector>()("ConnectorFor") {}
// ... 其他 Tags

// ========== 组合 Effect ==========
export const CurrentConnector = Effect.gen(function* () {
  const getConnId = yield* GetConnId;
  const connectorFor = yield* ConnectorFor;
  return connectorFor(getConnId());
});

// ========== 工具 Effect ==========
export const sendSSEMessage = (msg: SSEMessage) =>
  Effect.gen(function* () {
    const getConnId = yield* GetConnId;
    const sendSSE = yield* SendSSEMessage;
    sendSSE(getConnId(), msg);
  });

export const sendInfo = (message: string) =>
  sendSSEMessage({ type: "INFO", message, timestamp: Date.now() });

// ========== Handler 示例 ==========
const handleSaveChangesEffect = (payload: unknown) =>
  Effect.gen(function* () {
    const { sql } = yield* parsePayloadWithZod(SaveChangesPayloadSchema)(payload);
    const connector = yield* CurrentConnector;
    const result = yield* Effect.tryPromise(() => connector.query(sql));
    yield* sendInfo(`保存成功: ${result.rowCount ?? 0} 行受影响`);
    return { success: true, rowCount: result.rowCount };
  });
*/

// 保留旧的接口用于兼容
export interface PostgresDbHandlerContext {
  getConnId: () => string;
  /** 取当前会话的连接器（业务层唯一入口，替代直接访问 session 句柄） */
  connectorFor: (cid: string) => DbConnector;
  getS: (cid: string) => SessionConnection;
  getSWithDb: (cid: string) => SessionConnection;
  getStatements: (sql: string) => string[];
  recreateUserUsedClient: (cid: string) => Promise<void>;
  attachPostgresClientHandlers: (cid: string, client: Client) => void;
  startUserClientKeepalive: (cid: string) => void;
  stopUserClientKeepalive: (session: SessionConnection) => void;
  sendSSEMessage: (cid: string, msg: SSEMessage) => void;
  disconnectConnection: (cid: string) => Promise<void>;
  assertSessionDbType: (session: SessionConnection, dbType: DbKind | undefined) => void;
  capabilitiesForKind: (kind: DbKind) => DatabaseCapabilities;
  isPgUserClientDeadError: (e: unknown) => boolean;
  /** 同进程内递归调用其它 db/*（仅 Postgres 实现），避免经 handleApiRequest 再次分发造成循环 */
  forward: (method: string, payload: unknown) => Promise<unknown>;
}

export async function handlePostgresDbRequest(
  method: string,
  payload: unknown,
  ctx: PostgresDbHandlerContext
): Promise<unknown> {
  const {
    connectorFor,
    getConnId,
    getS,
    getStatements,
    recreateUserUsedClient,
    attachPostgresClientHandlers,
    startUserClientKeepalive,
    stopUserClientKeepalive,
    sendSSEMessage,
    disconnectConnection,
    assertSessionDbType,
    capabilitiesForKind,
    isPgUserClientDeadError,
    forward,
  } = ctx;

  switch (method) {
    case "db/connect": {
      const params = payload as ConnectDbRequest;
      if (params.dbType !== "postgres") throw new Error("当前仅支持 PostgreSQL（dbType=postgres）");
      // 建连/旧连接清理/keepalive 统一由连接层负责
      return connectSession(params);
    }

    case "db/disconnect": {
      const { connectionId: cid, dbType } = payload as { connectionId: string; dbType: DbKind };
      assertSessionDbType(getS(cid), dbType);
      await disconnectConnection(cid);
      return { success: true };
    }

    case "db/capabilities": {
      const { connectionId, dbType } = payload as { connectionId: string; dbType: DbKind };
      const session = getS(connectionId);
      assertSessionDbType(session, dbType);
      return { capabilities: capabilitiesForKind(session.dbKind) };
    }

    case "db/query-stream": {
      const cid = getConnId();
      const { query, statements: payloadStatements, batchSize = 100 } = payload as {
        connectionId: string;
        query?: string;
        statements?: string[];
        batchSize?: number;
      };
      const statements = payloadStatements?.length ? payloadStatements : getStatements(query ?? "");
      if (statements.length === 0) {
        return { rows: [], columns: [], hasMore: false };
      }
      // 游标、执行中 pid、死连接重试均由连接层负责（连接器内部持有跨批次状态）
      return connectorFor(cid).stream({ statements, batchSize });
    }

    case "db/query-stream-more": {
      const cid = getConnId();
      const { batchSize = 100 } = payload as { connectionId: string; batchSize?: number };
      return connectorFor(cid).streamMore({ batchSize });
    }

    case "db/save-changes": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const connector = connectorFor(cid);
      const result = await connector.query(sql);
      sendSSEMessage(cid, {
        type: "INFO",
        message: `保存成功: ${result.rowCount ?? 0} 行受影响`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: result.rowCount };
    }

    case "db/import-rows": {
      const cid = getConnId();
      const {
        schema,
        table,
        columns: colNames,
        rows,
        conflictColumns,
        onConflict,
        onError = "rollback",
      } = payload as {
        connectionId: string;
        schema: string;
        table: string;
        columns: string[];
        rows: any[][];
        conflictColumns?: string[];
        onConflict?: "nothing" | "update";
        onError?: "rollback" | "discard";
      };
      if (!colNames?.length || !Array.isArray(rows)) {
        throw new Error("缺少 columns 或 rows");
      }
      const connector = connectorFor(cid);
      const quote = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
      const qualified = `${quote(schema)}.${quote(table)}`;
      const cols = colNames.map(quote).join(", ");
      const BATCH = 100;
      const runOne = async (chunk: any[][], client: BorrowedClient): Promise<number> => {
        const placeholders: string[] = [];
        const values: any[] = [];
        let paramIndex = 1;
        for (const row of chunk) {
          placeholders.push("(" + colNames.map(() => `$${paramIndex++}`).join(", ") + ")");
          for (let c = 0; c < colNames.length; c++) {
            values.push(row[c] ?? null);
          }
        }
        let sql = `INSERT INTO ${qualified} (${cols}) VALUES ${placeholders.join(", ")}`;
        if (conflictColumns?.length && onConflict) {
          const conflictCols = conflictColumns.map((c) => quote(c)).join(", ");
          if (onConflict === "nothing") {
            sql += ` ON CONFLICT (${conflictCols}) DO NOTHING`;
          } else {
            const setClause = colNames.map((c) => `${quote(c)} = EXCLUDED.${quote(c)}`).join(", ");
            sql += ` ON CONFLICT (${conflictCols}) DO UPDATE SET ${setClause}`;
          }
        }
        const result = await client.query(sql, values);
        return result.rowCount ?? chunk.length;
      };

      let total = 0;
      if (onError === "rollback") {
        // 连接归还由 withPoolClient 保证（替代原 try/finally + release）
        await connector.withPoolClient(async (client) => {
          await client.query("BEGIN");
          try {
            for (let i = 0; i < rows.length; i += BATCH) {
              const chunk = rows.slice(i, i + BATCH);
              total += await runOne(chunk, client);
            }
            await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          }
        });
      } else {
        await connector.withPoolClient(async (client) => {
          for (let i = 0; i < rows.length; i += BATCH) {
            const chunk = rows.slice(i, i + BATCH);
            try {
              total += await runOne(chunk, client);
            } catch {
              for (const row of chunk) {
                try {
                  await runOne([row], client);
                  total += 1;
                } catch {
                  // 丢弃该行，继续
                }
              }
            }
          }
        });
      }
      sendSSEMessage(cid, {
        type: "INFO",
        message: `导入成功: ${total} 行`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: total };
    }

    case "db/cancel-query": {
      const cid = getConnId();
      const connector = connectorFor(cid);
      const res = await connector.cancelCurrentQuery();
      if (!res.cancelled && res.message === "没有正在执行的查询") {
        return { success: false, error: "没有正在执行的查询" };
      }
      return { success: true, cancelled: res.cancelled, message: res.message };
    }

    case "db/explain": {
      const cid = getConnId();
      const { query } = payload as { connectionId: string; query: string };
      const connector = connectorFor(cid);
      const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${query.trim()}`;
      try {
        sendSSEMessage(cid, { type: "QUERY", message: "执行 EXPLAIN ANALYZE...", timestamp: Date.now() });
        const result = await connector.query(explainSql);
        const row = result.rows[0];
        const jsonVal = row ? (row as any)["QUERY PLAN"] ?? (row as any).query_plan ?? (Array.isArray(row) ? row[0] : Object.values(row)[0]) : null;
        const plan = typeof jsonVal === "string" ? JSON.parse(jsonVal) : jsonVal;
        sendSSEMessage(cid, { type: "INFO", message: "执行计划获取完成", timestamp: Date.now() });
        return { plan };
      } catch (e: any) {
        sendSSEMessage(cid, { type: "ERROR", message: `EXPLAIN 错误: ${e.message}`, timestamp: Date.now() });
        throw e;
      }
    }

    case "db/schemas": {
      const cid = getConnId();
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name`
      );
      return { schemas: result.rows.map((r) => r.schema_name) };
    }

    case "db/tables": {
      const cid = getConnId();
      const { schema } = payload as { connectionId: string; schema: string };
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`,
        [schema]
      );
      let functions: Array<{ oid: number; schema: string; name: string; args: string }> = [];
      try {
        const funcResult = await connector.query(
          `SELECT p.oid, n.nspname AS schema, p.proname AS name, pg_get_function_identity_arguments(p.oid) AS args
           FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid JOIN pg_language l ON p.prolang = l.oid
           WHERE l.lanname = 'plpgsql' AND n.nspname = $1 ORDER BY p.proname`,
          [schema]
        );
        functions = funcResult.rows.map((r: any) => ({ oid: r.oid, schema: r.schema, name: r.name, args: r.args || "" }));
      } catch {
        // 忽略函数查询错误
      }
      return {
        tables: result.rows.filter((r) => r.table_type === "BASE TABLE").map((r) => r.table_name),
        views: result.rows.filter((r) => r.table_type === "VIEW").map((r) => r.table_name),
        functions,
      };
    }

    case "db/columns": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT c.column_name, c.data_type, c.udt_name, c.is_nullable, c.column_default,
         c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.identity_generation,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS pg_format_type
         FROM information_schema.columns c
         LEFT JOIN pg_catalog.pg_namespace ns ON ns.nspname = c.table_schema
         LEFT JOIN pg_catalog.pg_class cls
           ON cls.relnamespace = ns.oid AND cls.relname = c.table_name
           AND cls.relkind IN ('r', 'v', 'm', 'f', 'p')
         LEFT JOIN pg_catalog.pg_attribute a
           ON a.attrelid = cls.oid AND a.attname = c.column_name AND a.attnum > 0 AND NOT a.attisdropped
         WHERE c.table_schema = $1 AND c.table_name = $2
         ORDER BY c.ordinal_position`,
        [schema, table]
      );
      return { columns: result.rows };
    }

    case "db/indexes": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT
           i.relname AS index_name,
           am.amname AS index_type,
           ix.indisunique AS is_unique,
           ix.indisprimary AS is_primary,
           array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns
         FROM pg_index ix
         JOIN pg_class c ON c.oid = ix.indrelid
         JOIN pg_class i ON i.oid = ix.indexrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_am am ON am.oid = i.relam
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(ix.indkey)
         WHERE n.nspname = $1 AND c.relname = $2
         GROUP BY i.relname, am.amname, ix.indisunique, ix.indisprimary
         ORDER BY i.relname`,
        [schema, table]
      );
      const toColsIdx = (v: any): string[] => {
        if (Array.isArray(v)) return v;
        if (v == null) return [];
        const s = String(v).trim();
        if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1).split(",").map((x) => x.trim());
        return [s];
      };
      return {
        indexes: result.rows.map((r: any) => ({
          ...r,
          columns: toColsIdx(r.columns),
        })),
      };
    }

    case "db/primary-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position`,
        [schema, table]
      );
      return { columns: result.rows.map((r: any) => r.column_name) };
    }

    case "db/unique-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT tc.constraint_name, tc.constraint_type,
         array_agg(kcu.column_name ORDER BY kcu.ordinal_position) AS columns
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1 AND tc.table_name = $2 AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
         GROUP BY tc.constraint_name, tc.constraint_type`,
        [schema, table]
      );
      const toCols = (v: any): string[] => {
        if (Array.isArray(v)) return v;
        if (v == null) return [];
        const s = String(v).trim();
        if (s.startsWith("{") && s.endsWith("}")) return s.slice(1, -1).split(",").map((x) => x.trim());
        return [s];
      };
      return {
        constraints: result.rows.map((r: any) => ({
          name: r.constraint_name,
          type: r.constraint_type,
          columns: toCols(r.columns),
        })),
      };
    }

    case "db/data-types": {
      const cid = getConnId();
      const connector = connectorFor(cid);
      // 仅可出现在 CREATE TABLE 列上的类别：b 标量、e 枚举、r 范围、m multirange。
      // 排除 typtype=p（伪类型：anycompatible、any、void、internal 等，不能作存储列类型）。
      // 用 format_type 输出 SQL 常用名（smallint/integer/bigint），而非仅 typname（int2/int4/int8）。
      const result = await connector.query(
        `SELECT DISTINCT pg_catalog.format_type(t.oid, NULL) AS name
         FROM pg_type t
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE n.nspname = 'pg_catalog'
           AND t.typtype IN ('b', 'e', 'r', 'm')
           AND t.typisdefined
           AND t.typname !~ '^_'
         ORDER BY 1`
      );
      return { types: result.rows.map((r: { name: string }) => String(r.name ?? "").trim()).filter(Boolean) };
    }

    case "db/execute-ddl": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const connector = connectorFor(cid);
      try {
        sendSSEMessage(cid, { type: "QUERY", message: `执行 DDL: ${sql.slice(0, 80)}...`, timestamp: Date.now() });
        await connector.query(sql);
        sendSSEMessage(cid, { type: "INFO", message: "DDL 执行成功", timestamp: Date.now() });
        return { success: true };
      } catch (e: any) {
        sendSSEMessage(cid, { type: "ERROR", message: `DDL 错误: ${e.message}`, timestamp: Date.now(), detail: e.detail || e.hint });
        throw e;
      }
    }

    case "db/foreign-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const outgoingResult = await connector.query(
        `SELECT tc.constraint_name,
         kcu.column_name AS source_column,
         ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column,
         rc.delete_rule, rc.update_rule
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      );
      const incomingResult = await connector.query(
        `SELECT tc.constraint_name, tc.table_schema AS source_schema, tc.table_name AS source_table,
         kcu.column_name AS source_column, ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_schema = $1 AND ccu.table_name = $2`,
        [schema, table]
      );
      return { outgoing: outgoingResult.rows, incoming: incomingResult.rows };
    }

    case "db/table-ddl": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const pool = connector;

      // 判断是表还是视图
      const tblRes = await pool.query(
        `SELECT table_type FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
        [schema, table]
      );
      if (tblRes.rows.length === 0) throw new Error(`表或视图 ${schema}.${table} 不存在`);
      const isView = tblRes.rows[0].table_type === "VIEW";

      if (isView) {
        const defRes = await pool.query(
          `SELECT pg_get_viewdef($1::regclass, true) AS def`,
          [`"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`]
        );
        const def = defRes.rows[0]?.def ?? "";
        return { ddl: `CREATE OR REPLACE VIEW "${schema}"."${table}" AS\n${def}` };
      }

      // 表：获取列、约束、索引
      const colsRes = await pool.query(
        `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale,
         is_nullable, column_default, udt_name, identity_generation
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table]
      );
      const pkRes = await pool.query(
        `SELECT kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = $1 AND tc.table_name = $2 ORDER BY kcu.ordinal_position`,
        [schema, table]
      );
      const pkCols = pkRes.rows.map((r: any) => r.column_name);
      const idxRes = await pool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2`,
        [schema, table]
      );
      const fkRes = await pool.query(
        `SELECT tc.constraint_name, kcu.column_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table, ccu.column_name AS ref_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      );
      const checkRes = await pool.query(
        `SELECT cc.constraint_name, cc.check_clause FROM information_schema.check_constraints cc
         JOIN information_schema.constraint_table_usage ctu ON cc.constraint_name = ctu.constraint_name
         WHERE ctu.table_schema = $1 AND ctu.table_name = $2`,
        [schema, table]
      );

      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const colDefs = colsRes.rows.map((c: any) => {
        let type = c.udt_name || c.data_type;
        if (c.character_maximum_length) type += `(${c.character_maximum_length})`;
        else if (c.numeric_precision != null) type += `(${c.numeric_precision}${c.numeric_scale != null ? "," + c.numeric_scale : ""})`;
        let def = quote(c.column_name) + " " + type;
        if (c.is_nullable === "NO") def += " NOT NULL";
        if (c.column_default) def += " DEFAULT " + c.column_default;
        return def;
      });
      if (pkCols.length) {
        colDefs.push("  PRIMARY KEY (" + pkCols.map(quote).join(", ") + ")");
      }
      let ddl = `CREATE TABLE ${quote(schema)}.${quote(table)} (\n  ` + colDefs.join(",\n  ");
      const fkStmts = fkRes.rows.map((f: any) =>
        `ALTER TABLE ${quote(schema)}.${quote(table)} ADD CONSTRAINT ${quote(f.constraint_name)} FOREIGN KEY (${quote(f.column_name)}) REFERENCES ${quote(f.ref_schema)}.${quote(f.ref_table)}(${quote(f.ref_column)})`
      );
      const checkStmts = checkRes.rows.map((c: any) =>
        `ALTER TABLE ${quote(schema)}.${quote(table)} ADD CONSTRAINT ${quote(c.constraint_name)} CHECK (${c.check_clause})`
      );
      const idxStmts = idxRes.rows
        .filter((r: any) => !r.indexname.endsWith("_pkey"))
        .map((r: any) => r.indexdef);
      ddl += "\n);\n\n" + [...fkStmts, ...checkStmts, ...idxStmts].filter(Boolean).join(";\n\n") + (fkStmts.length || checkStmts.length || idxStmts.length ? ";" : "");
      return { ddl: ddl.trim() };
    }

    case "db/function-ddl": {
      const cid = getConnId();
      const { schema, function: funcName, oid } = payload as { connectionId: string; schema: string; function: string; oid?: number };
      const connector = connectorFor(cid);
      const pool = connector;

      let targetOid: number;
      if (oid != null) {
        targetOid = oid;
      } else {
        const lookupRes = await pool.query(
          `SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = $1 AND p.proname = $2 LIMIT 1`,
          [schema, funcName]
        );
        if (lookupRes.rows.length === 0) throw new Error(`函数 ${schema}.${funcName} 不存在`);
        targetOid = lookupRes.rows[0].oid;
      }

      const defRes = await pool.query(`SELECT pg_get_functiondef($1::oid) AS ddl`, [targetOid]);
      const ddl = defRes.rows[0]?.ddl ?? "";
      if (!ddl) throw new Error(`无法获取函数源码`);
      return { ddl };
    }

    case "db/schema-dump": {
      const cid = getConnId();
      const { schema, includeData = false } = payload as { connectionId: string; schema: string; includeData?: boolean };
      const connector = connectorFor(cid);
      const pool = connector;
      const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;

      sendSSEMessage(cid, { type: "QUERY", message: `导出 schema ${schema}${includeData ? "（含数据）" : ""}...`, timestamp: Date.now() });

      const tablesRes = await pool.query(
        `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
        [schema]
      );
      const viewsRes = await pool.query(
        `SELECT viewname FROM pg_views WHERE schemaname = $1 ORDER BY viewname`,
        [schema]
      );
      const funcsRes = await pool.query(
        `SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = $1 ORDER BY p.proname`,
        [schema]
      );

      const fkRes = await pool.query(
        `SELECT tc.table_schema, tc.table_name, ccu.table_schema AS ref_schema, ccu.table_name AS ref_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1`,
        [schema]
      );
      const fkMap = new Map<string, string[]>();
      for (const r of fkRes.rows as any[]) {
        if (r.ref_schema !== schema) continue;
        const key = `${r.table_schema}.${r.table_name}`;
        if (!fkMap.has(key)) fkMap.set(key, []);
        fkMap.get(key)!.push(`${r.ref_schema}.${r.ref_table}`);
      }
      const sortedTables: string[] = [];
      const visited = new Set<string>();
      const visit = (t: string) => {
        if (visited.has(t)) return;
        visited.add(t);
        for (const ref of fkMap.get(t) ?? []) {
          if (ref.startsWith(schema + ".")) visit(ref);
        }
        sortedTables.push(t.split(".")[1]);
      };
      for (const r of tablesRes.rows as any[]) {
        visit(`${schema}.${r.tablename}`);
      }

      const parts: string[] = [`-- Schema: ${schema}\n`, `CREATE SCHEMA IF NOT EXISTS ${quote(schema)};\n`];

      for (const t of sortedTables) {
        const { ddl } = await forward("db/table-ddl", { connectionId: cid, dbType: connectorFor(cid).dbKind, schema, table: t } as any) as { ddl: string };
        parts.push("\n" + ddl + (ddl.trim().endsWith(";") ? "\n" : ";\n"));
        if (includeData) {
          const colsRes = await pool.query(
            `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
            [schema, t]
          );
          const cols = (colsRes.rows as any[]).map((r) => r.column_name);
          if (cols.length) {
            const colList = cols.map(quote).join(", ");
            const dataRes = await pool.query({ text: `SELECT * FROM ${quote(schema)}.${quote(t)}`, rowMode: "array" });
            if (dataRes.rows.length > 0) {
              const escapeVal = (v: unknown): string => {
                if (v === null) return "NULL";
                if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
                if (typeof v === "number" && !Number.isNaN(v)) return String(v);
                const s = String(v);
                return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
              };
              const batchSize = 100;
              for (let i = 0; i < dataRes.rows.length; i += batchSize) {
                const batch = dataRes.rows.slice(i, i + batchSize);
                const values = batch.map((row) => "(" + row.map(escapeVal).join(", ") + ")").join(",\n  ");
                parts.push(`\nINSERT INTO ${quote(schema)}.${quote(t)} (${colList}) VALUES\n  ${values};\n`);
              }
            }
          }
        }
      }
      for (const r of viewsRes.rows as any[]) {
        const v = (r as any).viewname;
        const { ddl } = await forward("db/table-ddl", { connectionId: cid, dbType: connectorFor(cid).dbKind, schema, table: v } as any) as { ddl: string };
        parts.push("\n" + ddl + (ddl.trim().endsWith(";") ? "\n" : ";\n"));
      }
      for (const r of funcsRes.rows as any[]) {
        const { ddl } = await forward("db/function-ddl", { connectionId: cid, dbType: connectorFor(cid).dbKind, schema, function: (r as any).proname, oid: (r as any).oid } as any) as { ddl: string };
        parts.push("\n" + ddl + (ddl.trim().endsWith(";") ? "\n" : ";\n"));
      }

      sendSSEMessage(cid, { type: "INFO", message: `Schema ${schema} 导出完成`, timestamp: Date.now() });
      return { dump: parts.join("") };
    }

    case "db/database-dump": {
      const cid = getConnId();
      const { includeData = false } = payload as { connectionId: string; includeData?: boolean };
      const connector = connectorFor(cid);
      const pool = connector;

      sendSSEMessage(cid, { type: "QUERY", message: `导出全库${includeData ? "（含数据）" : ""}...`, timestamp: Date.now() });

      const schemasRes = await pool.query(
        `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema' ORDER BY nspname`
      );
      const parts: string[] = ["-- Database Dump\n"];
      for (const r of schemasRes.rows as any[]) {
        const s = r.nspname;
        const { dump } = await forward("db/schema-dump", { connectionId: cid, dbType: connectorFor(cid).dbKind, schema: s, includeData } as any) as { dump: string };
        parts.push(dump);
      }
      sendSSEMessage(cid, { type: "INFO", message: "全库导出完成", timestamp: Date.now() });
      return { dump: parts.join("\n") };
    }

    case "db/query": {
      const cid = getConnId();
      const { query } = payload as { connectionId: string; query: string };
      // 死连接重试与执行中 pid 登记均由连接层负责（queryAsUser 内部实现）
      const connector = connectorFor(cid);
      sendSSEMessage(cid, { type: "QUERY", message: `执行查询: ${query.slice(0, 100)}...`, timestamp: Date.now() });
      try {
        const result = await connector.queryAsUser({ text: query, rowMode: "array" });
        sendSSEMessage(cid, {
          type: "INFO",
          message: `${result.command || ""} 完成: ${result.rowCount ?? 0} 行`,
          timestamp: Date.now(),
        });
        const columnsInfo = await calculateColumnEditable(
          connector as unknown as QueryClient,
          (result.fields ?? []) as FieldDef[]
        );
        return { result: result.rows, columns: columnsInfo };
      } catch (e: any) {
        sendSSEMessage(cid, { type: "ERROR", message: `查询错误: ${e.message}`, timestamp: Date.now(), detail: e.detail || e.hint });
        throw e;
      }
    }

    case "db/table-comment": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = $1 AND c.relname = $2`,
        [schema, table]
      );
      return { comment: result.rows[0]?.comment ?? null };
    }

    case "db/check-constraints": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const connector = connectorFor(cid);
      const result = await connector.query(
        `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS expression
         FROM pg_constraint con
         JOIN pg_class c ON c.oid = con.conrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE con.contype = 'c'
           AND n.nspname = $1
           AND c.relname = $2
           AND con.conname NOT LIKE '%_not_null'`,
        [schema, table]
      );
      return { constraints: result.rows };
    }

    case "db/partition-info": {
      try {
        const cid = getConnId();
        const { schema, table } = payload as { connectionId: string; schema: string; table: string };
        const connector = connectorFor(cid);
        const pool = connector;

        const rel = await pool.query(
          `SELECT c.oid, c.relkind::text AS relkind FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = $1 AND c.relname = $2`,
          [schema, table]
        );
        if (rel.rows.length === 0) throw new Error(`关系不存在: ${schema}.${table}`);
        const oid = rel.rows[0].oid as number;
        const relkind = String(rel.rows[0].relkind);

        if (relkind === "p") {
          const pt = await pool.query(
            `SELECT CASE pt.partstrat
                WHEN 'r' THEN 'range'
                WHEN 'l' THEN 'list'
                WHEN 'h' THEN 'hash'
                ELSE pt.partstrat::text
              END AS strategy,
              pg_get_partkeydef(pt.partrelid) AS partition_key
             FROM pg_partitioned_table pt WHERE pt.partrelid = $1`,
            [oid]
          );
          const parts = await pool.query(
            `SELECT n.nspname AS schema, c.relname AS name,
                    pg_get_expr(c.relpartbound, c.oid) AS partition_bound
             FROM pg_inherits i
             JOIN pg_class c ON c.oid = i.inhrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE i.inhparent = $1
             ORDER BY n.nspname, c.relname`,
            [oid]
          );
          return {
            role: "parent",
            strategy: pt.rows[0]?.strategy ?? null,
            partitionKey: pt.rows[0]?.partition_key ?? null,
            partitions: parts.rows.map((r: { schema: string; name: string; partition_bound: string | null }) => ({
              schema: r.schema,
              name: r.name,
              qualified: `${r.schema}.${r.name}`,
              bound: r.partition_bound || "",
            })),
          };
        }

        const inh = await pool.query(
          `SELECT i.inhparent, n.nspname AS parent_schema, p.relname AS parent_name
           FROM pg_inherits i
           JOIN pg_class p ON p.oid = i.inhparent
           JOIN pg_namespace n ON n.oid = p.relnamespace
           WHERE i.inhrelid = $1
           LIMIT 1`,
          [oid]
        );
        if (inh.rows.length > 0) {
          const r = inh.rows[0] as { inhparent: number; parent_schema: string; parent_name: string };
          const boundRes = await pool.query(
            `SELECT pg_get_expr(c.relpartbound, c.oid) AS partition_bound FROM pg_class c WHERE c.oid = $1`,
            [oid]
          );
          const pp = await pool.query(
            `SELECT CASE pt.partstrat
                WHEN 'r' THEN 'range'
                WHEN 'l' THEN 'list'
                WHEN 'h' THEN 'hash'
                ELSE pt.partstrat::text
              END AS strategy,
              pg_get_partkeydef(pt.partrelid) AS partition_key
             FROM pg_partitioned_table pt WHERE pt.partrelid = $1`,
            [r.inhparent]
          );
          return {
            role: "partition",
            parentQualified: `${r.parent_schema}.${r.parent_name}`,
            parentSchema: r.parent_schema,
            parentName: r.parent_name,
            thisBound: boundRes.rows[0]?.partition_bound ?? "",
            strategy: pp.rows[0]?.strategy ?? null,
            partitionKey: pp.rows[0]?.partition_key ?? null,
          };
        }

        return { role: "none" };
      } catch (e: any) {
        throw new Error(`partition-info: ${e?.message ?? String(e)}`);
      }
    }

    case "db/explain-text": {
      try {
        const cid = getConnId();
        const { query } = payload as { connectionId: string; query: string };
        const connector = connectorFor(cid);
        const q = query.trim();
        if (!q) throw new Error("SQL 为空");
        const explainSql = `EXPLAIN (VERBOSE, COSTS ON, FORMAT TEXT) ${q}`;
        const result = await connector.query(explainSql);
        const lines: string[] = result.rows.map((row) => {
          const v =
            (row as Record<string, unknown>)["QUERY PLAN"] ??
            (row as Record<string, unknown>)["query_plan"] ??
            Object.values(row)[0];
          return typeof v === "string" ? v : String(v ?? "");
        });
        return { lines };
      } catch (e: any) {
        throw new Error(`explain-text: ${e?.message ?? String(e)}`);
      }
    }

    case "db/session-monitor": {
      try {
        const cid = getConnId();
        const { limit = 20 } = payload as { connectionId: string; limit?: number };
        const lim = Number.isFinite(limit) ? Math.min(Math.max(Number(limit), 5), 200) : 20;
        const connector = connectorFor(cid);
        return connector.withPoolClient(async (client) => {
          // 监控查询必须“快失败”，避免 UI 卡住；不用事务，避免某一步失败后进入 aborted 状态
          await client.query("SET statement_timeout = '2500ms'");
          await client.query("SET lock_timeout = '800ms'");

          try {
            const connRes = await client.query(
            `SELECT
               COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE state = 'active')::int AS active,
               COUNT(*) FILTER (WHERE state = 'idle')::int AS idle,
               COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL)::int AS waiting
             FROM pg_stat_activity
             WHERE datname = current_database()`
          );

          const lockRes = await client.query(
            `SELECT
               a.pid AS waiting_pid,
               a.usename AS waiting_user,
               LEFT(COALESCE(a.query, ''), 240) AS waiting_query,
               b.pid AS blocking_pid,
               b.usename AS blocking_user,
               LEFT(COALESCE(b.query, ''), 240) AS blocking_query,
               a.wait_event_type,
               a.wait_event
             FROM pg_stat_activity a
             JOIN pg_locks la ON la.pid = a.pid AND NOT la.granted
             JOIN pg_locks lb ON lb.locktype = la.locktype
                            AND (lb.database = la.database OR (lb.database IS NULL AND la.database IS NULL))
                            AND (lb.relation = la.relation OR (lb.relation IS NULL AND la.relation IS NULL))
                            AND (lb.page = la.page OR (lb.page IS NULL AND la.page IS NULL))
                            AND (lb.tuple = la.tuple OR (lb.tuple IS NULL AND la.tuple IS NULL))
                            AND (lb.virtualxid = la.virtualxid OR (lb.virtualxid IS NULL AND la.virtualxid IS NULL))
                            AND (lb.transactionid = la.transactionid OR (lb.transactionid IS NULL AND la.transactionid IS NULL))
                            AND (lb.classid = la.classid OR (lb.classid IS NULL AND la.classid IS NULL))
                            AND (lb.objid = la.objid OR (lb.objid IS NULL AND la.objid IS NULL))
                            AND (lb.objsubid = la.objsubid OR (lb.objsubid IS NULL AND la.objsubid IS NULL))
                             AND lb.pid <> la.pid
             JOIN pg_stat_activity b ON b.pid = lb.pid
             WHERE a.datname = current_database()
             ORDER BY a.query_start NULLS LAST
             LIMIT $1`,
            [lim]
          );

          let slowQueries: Array<Record<string, unknown>> = [];
          let slowQuerySource: "pg_stat_statements" | "pg_stat_activity" = "pg_stat_statements";
          try {
            const slowRes = await client.query(
              `SELECT
                 LEFT(query, 240) AS query,
                 calls,
                 ROUND(total_exec_time::numeric, 3)::float8 AS total_exec_time,
                 ROUND(mean_exec_time::numeric, 3)::float8 AS mean_exec_time,
                 rows::bigint AS rows
               FROM pg_stat_statements
               WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
               ORDER BY total_exec_time DESC
               LIMIT $1`,
              [lim]
            );
            slowQueries = slowRes.rows as Array<Record<string, unknown>>;
          } catch {
            slowQuerySource = "pg_stat_activity";
            const fallbackRes = await client.query(
              `SELECT
                 LEFT(COALESCE(query, ''), 240) AS query,
                 EXTRACT(EPOCH FROM (now() - query_start)) * 1000 AS total_exec_time,
                 state,
                 wait_event_type,
                 wait_event
               FROM pg_stat_activity
               WHERE datname = current_database()
                 AND state = 'active'
                 AND query IS NOT NULL
               ORDER BY query_start ASC NULLS LAST
               LIMIT $1`,
              [lim]
            );
            slowQueries = fallbackRes.rows as Array<Record<string, unknown>>;
          }

          return {
            connectionStats: connRes.rows[0] ?? { total: 0, active: 0, idle: 0, waiting: 0 },
            lockWaits: lockRes.rows,
            slowQueries,
            slowQuerySource,
            collectedAt: Date.now(),
          };
        } catch (e) {
          throw e;
        } finally {
          try { await client.query("RESET statement_timeout"); } catch {}
          try { await client.query("RESET lock_timeout"); } catch {}
        }
        });
      } catch (e: any) {
        throw new Error(`session-monitor: ${e?.message ?? String(e)}`);
      }
    }

    case "db/installed-extensions": {
      try {
        const cid = getConnId();
        const connector = connectorFor(cid);
        const result = await connector.query(
          `SELECT
             e.extname AS name,
             e.extversion AS installed_version,
             n.nspname AS schema,
             e.extrelocatable AS relocatable,
             ae.default_version AS default_version,
             COALESCE(pg_catalog.obj_description(e.oid, 'pg_extension'), ae.comment) AS description
           FROM pg_extension e
           JOIN pg_namespace n ON n.oid = e.extnamespace
           LEFT JOIN pg_catalog.pg_available_extensions ae ON ae.name = e.extname
           ORDER BY e.extname`
        );
        const extensions = (result.rows as Array<Record<string, unknown>>).map((row) => ({
          name: String(row.name ?? ""),
          installedVersion: String(row.installed_version ?? ""),
          schema: String(row.schema ?? ""),
          relocatable: Boolean(row.relocatable),
          defaultVersion: row.default_version != null ? String(row.default_version) : null,
          description: row.description != null ? String(row.description) : null,
        }));
        return { extensions };
      } catch (e: any) {
        throw new Error(`installed-extensions: ${e?.message ?? String(e)}`);
      }
    }

    case "db/session-control": {
      try {
        const cid = getConnId();
        const { pid, action } = payload as { connectionId: string; pid: number; action: "cancel" | "terminate" };
        if (!Number.isInteger(pid) || pid <= 0) throw new Error("pid 非法");
        const connector = connectorFor(cid);
        const self = await connector.query("SELECT pg_backend_pid() AS self_pid");
        const selfPid = Number(self.rows[0]?.self_pid ?? 0);
        if (pid === selfPid) {
          throw new Error("不允许操作当前监控会话自身 pid");
        }
        const fn = action === "terminate" ? "pg_terminate_backend" : "pg_cancel_backend";
        const rs = await connector.query(
          `SELECT ${fn}($1) AS ok`,
          [pid]
        );
        const ok = !!rs.rows[0]?.ok;
        return { success: ok, pid, action };
      } catch (e: any) {
        throw new Error(`session-control: ${e?.message ?? String(e)}`);
      }
    }    default:
      throw new Error(`未知 API 方法: ${method}`);
  }
}

// ========== Effect 版本的 Handlers ==========
// 注意：这是 Effect v4 的重构示例，由于 v4 API 变化较大，这里暂时注释掉
// 完整迁移需要参考 Effect v4 文档逐步完成
/*
const handleConnectEffect = (payload: unknown) =>
  Effect.gen(function* () {
    const params = payload as ConnectDbRequest;
    if (params.dbType !== "postgres") {
      return yield* Effect.die(new Error("当前仅支持 PostgreSQL（dbType=postgres）"));
    }
    return yield* Effect.tryPromise(() => connectSession(params));
  });

// 其他 handlers 暂时保留原实现包装
const handleDisconnectEffect = (payload: unknown, ctx: PostgresDbHandlerContext) =>
  Effect.gen(function* () {
    return yield* Effect.tryPromise(() => handlePostgresDbRequest("db/disconnect", payload, ctx));
  });

// ... 其他 handlers 类似
*/

// ========== Effect 版本的主路由函数 ==========
// 暂时注释，待 handlers 完成后启用
/*
export const handlePostgresDbRequestEffect = (
  method: string,
  payload: unknown,
  ctx: PostgresDbHandlerContext
): Effect.Effect<unknown, Error,
  | GetConnId
  | ConnectorFor
  | GetS
  | GetSWithDb
  | GetStatements
  | RecreateUserUsedClient
  | AttachPostgresClientHandlers
  | StartUserClientKeepalive
  | StopUserClientKeepalive
  | SendSSEMessage
  | DisconnectConnection
  | AssertSessionDbType
  | CapabilitiesForKind
  | IsPgUserClientDeadError
  | Forward
> => {
  switch (method) {
    case "db/connect":
      return handleConnectEffect(payload);
    // ... 其他 cases
    default:
      return Effect.fail(new Error(`未知 API 方法: ${method}`));
  }
};
*/

// ========== Context 提供器辅助函数 ==========
// 暂时注释，待主路由函数完成后启用
/*
export const providePostgresDbHandlerContext = (
  ctx: PostgresDbHandlerContext
) => (effect: Effect.Effect<unknown, Error, any>) =>
  effect.pipe(
    Effect.provideService(GetConnId, ctx.getConnId),
    Effect.provideService(ConnectorFor, ctx.connectorFor),
    Effect.provideService(GetS, ctx.getS),
    Effect.provideService(GetSWithDb, ctx.getSWithDb),
    Effect.provideService(GetStatements, ctx.getStatements),
    Effect.provideService(RecreateUserUsedClient, ctx.recreateUserUsedClient),
    Effect.provideService(AttachPostgresClientHandlers, ctx.attachPostgresClientHandlers),
    Effect.provideService(StartUserClientKeepalive, ctx.startUserClientKeepalive),
    Effect.provideService(StopUserClientKeepalive, ctx.stopUserClientKeepalive),
    Effect.provideService(SendSSEMessage, ctx.sendSSEMessage),
    Effect.provideService(DisconnectConnection, ctx.disconnectConnection),
    Effect.provideService(AssertSessionDbType, ctx.assertSessionDbType),
    Effect.provideService(CapabilitiesForKind, ctx.capabilitiesForKind),
    Effect.provideService(IsPgUserClientDeadError, ctx.isPgUserClientDeadError),
    Effect.provideService(Forward, ctx.forward)
  );
*/

