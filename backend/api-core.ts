/**
 * 后端 API 核心：纯业务逻辑，与传输方式无关
 * 供 api-handlers-http 和 api-handlers-vscode 共同调用
 */

import type { PostgresLoginParams, ApiMethod, ApiRequestPayload, ConnectPostgresRequest } from "../shared/src";
import { connectPostgres, createPostgresPool } from "./connect-postgres";
import { calculateColumnEditable } from "./column-editable";
import { listConnections, saveConnection, removeConnection, getConnectionParams } from "./connections-store";
import { Client, Pool } from "pg";
import Cursor from "pg-cursor";

export interface SSEMessage {
  type: "NOTICE" | "ERROR" | "INFO" | "WARNING" | "QUERY" | "NOTIFICATION";
  message: string;
  timestamp: number;
  detail?: string;
}

export interface SessionConnection {
  userUsedClient: Client;
  backGroundPool: Pool;
  runningQueryPid?: number;
  eventPushers: Set<(msg: SSEMessage) => void>;
  cursor?: {
    instance: Cursor;
    columns?: any[];
    isDone: boolean;
  };
}

/** 以 connectionId 为 key 存储多个连接 */
const connectionMap = new Map<string, SessionConnection>();

export function sendSSEMessage(connectionId: string, message: SSEMessage) {
  const conn = connectionMap.get(connectionId);
  if (!conn) return;

  for (const push of conn.eventPushers) {
    try {
      push(message);
    } catch (e) {
      conn.eventPushers.delete(push);
    }
  }
}

export function getSession(connectionId: string): SessionConnection | undefined {
  return connectionMap.get(connectionId);
}

/** 订阅连接的事件推送，返回取消订阅函数 */
export function subscribeSessionEvents(
  connectionId: string,
  push: (msg: SSEMessage) => void
): () => void {
  const conn = connectionMap.get(connectionId);
  if (!conn) throw new Error("未找到数据库连接，请先连接数据库");

  conn.eventPushers.add(push);
  return () => conn.eventPushers.delete(push);
}

/** 处理 API 请求，返回纯数据（可 JSON 序列化） */
export async function handleApiRequest<M extends ApiMethod>(
  method: M,
  payload: ApiRequestPayload[M]
): Promise<unknown> {
  const getConnId = (): string => {
    const p = payload as { connectionId?: string };
    if (!p.connectionId) throw new Error("缺少 connectionId");
    return p.connectionId;
  };
  const getS = (cid: string) => {
    const s = getSession(cid);
    if (!s) throw new Error("未找到数据库连接，请先连接数据库");
    return s;
  };

  switch (method) {
    case "connections/list": {
      return listConnections();
    }

    case "connections/save": {
      const { id, ...params } = payload as { id: string } & PostgresLoginParams;
      if (!id || !params.host || !params.database || !params.username) {
        throw new Error("缺少必填字段");
      }
      saveConnection(id, {
        host: params.host,
        port: params.port || "5432",
        database: params.database,
        username: params.username,
        password: params.password || "",
      });
      return { success: true };
    }

    case "connections/delete": {
      const { id } = payload as { id: string };
      if (!id) throw new Error("缺少 id");
      removeConnection(id);
      return { success: true };
    }

    case "connections/connect": {
      const { id } = payload as { id: string };
      const params = getConnectionParams(id);
      if (!params) return { sucess: false, error: "未找到已保存的连接" };
      const { id: cid, ...loginParams } = params;
      return handleApiRequest("connect-postgres", { connectionId: cid, ...loginParams } as any);
    }

    case "connect-postgres": {
      const params = payload as ConnectPostgresRequest;
      const { connectionId: cid, ...connectParams } = params;
      const loginParams: PostgresLoginParams = { ...connectParams, password: connectParams.password ?? "" };

      // 若已存在同 ID 连接，先断开
      const existing = connectionMap.get(cid);
      if (existing) {
        await existing.userUsedClient.end().catch(() => {});
        await existing.backGroundPool.end().catch(() => {});
        connectionMap.delete(cid);
      }

      const client = await connectPostgres(loginParams);
      const adminPool = createPostgresPool(loginParams);

      client.on("error", (err) => {
        sendSSEMessage(cid, { type: "ERROR", message: err.message || String(err), timestamp: Date.now() });
      });
      client.on("notice", (msg: any) => {
        const severity = (msg.severity || "NOTICE").toUpperCase();
        sendSSEMessage(cid, {
          type: severity as SSEMessage["type"],
          message: msg.message || String(msg),
          timestamp: Date.now(),
          detail: msg.detail || msg.hint || undefined,
        });
      });
      client.on("notification", (msg: any) => {
        sendSSEMessage(cid, {
          type: "NOTIFICATION",
          message: `[${msg.channel}] ${msg.payload || "(无内容)"}`,
          timestamp: Date.now(),
        });
      });
      client.on("end", () => {
        sendSSEMessage(cid, { type: "WARNING", message: "数据库连接已断开", timestamp: Date.now() });
      });

      connectionMap.set(cid, { userUsedClient: client, backGroundPool: adminPool, eventPushers: new Set() });
      return { sucess: true, connectionId: cid };
    }

    case "disconnect-postgres": {
      const { connectionId: cid } = payload as { connectionId: string };
      const conn = connectionMap.get(cid);
      if (conn) {
        await conn.userUsedClient.end().catch(() => {});
        await conn.backGroundPool.end().catch(() => {});
        connectionMap.delete(cid);
      }
      return { success: true };
    }

    case "postgres/query-stream": {
      const cid = getConnId();
      const { query, batchSize = 100 } = payload as { connectionId: string; query: string; batchSize?: number };
      const session = getS(cid);
      const { userUsedClient: client, backGroundPool: adminPool } = session;

      if (session.cursor) {
        await new Promise<void>((r) => session.cursor!.instance.close(() => r()));
        session.cursor = undefined;
      }

      // 使用 pg_backend_pid() 可靠获取当前连接的后端 PID，供取消查询使用
      try {
        const pidRes = await client.query("SELECT pg_backend_pid() as pid");
        session.runningQueryPid = parseInt(String(pidRes.rows[0]?.pid ?? 0), 10) || undefined;
      } catch {
        session.runningQueryPid = (client as any).processID;
      }

      const cursor = client.query(new Cursor(query, [], { rowMode: "array" }));
      const rows = await new Promise<any[]>((resolve, reject) => {
        cursor.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      });

      const fields = (cursor as any)._result?.fields;
      const columnsInfo = fields ? await calculateColumnEditable(adminPool, fields, query) : [];
      const isDone = rows.length < batchSize;

      if (isDone) {
        await new Promise<void>((r) => cursor.close(() => r()));
        session.runningQueryPid = undefined;
      } else {
        session.cursor = { instance: cursor, columns: columnsInfo, isDone: false };
      }

      return { rows, columns: columnsInfo, hasMore: !isDone };
    }

    case "postgres/query-stream-more": {
      const cid = getConnId();
      const { batchSize = 100 } = payload as { connectionId: string; batchSize?: number };
      const session = getS(cid);

      if (!session.cursor || session.cursor.isDone) return { rows: [], hasMore: false };

      const { cursor } = session;
      const rows = await new Promise<any[]>((resolve, reject) => {
        cursor.instance.read(batchSize, (err: any, r: any[]) => (err ? reject(err) : resolve(r)));
      });
      const isDone = rows.length < batchSize;

      if (isDone) {
        await new Promise<void>((r) => cursor.instance.close(() => r()));
        session.cursor = undefined;
        session.runningQueryPid = undefined;
      } else {
        cursor.isDone = false;
      }

      return { rows, hasMore: !isDone };
    }

    case "postgres/save-changes": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(sql);
      sendSSEMessage(cid, {
        type: "INFO",
        message: `保存成功: ${result.rowCount ?? 0} 行受影响`,
        timestamp: Date.now(),
      });
      return { success: true, rowCount: result.rowCount };
    }

    case "postgres/cancel-query": {
      const cid = getConnId();
      const session = getS(cid);
      const pid = session.runningQueryPid;
      if (!pid) return { success: false, error: "没有正在执行的查询" };
      const result = await session.backGroundPool.query(`SELECT pg_cancel_backend($1)`, [pid]);
      const cancelled = result.rows[0]?.pg_cancel_backend;
      return { success: true, cancelled, message: cancelled ? "查询取消请求已发送" : "查询可能已完成或无法取消" };
    }

    case "postgres/query-readonly": {
      const cid = getConnId();
      const { query, limit = 1000 } = payload as { connectionId: string; query: string; limit?: number };
      const session = getS(cid);
      const limitedQuery = query.trim().toLowerCase().includes("limit") ? query : `${query} LIMIT ${limit}`;
      const poolClient = await session.backGroundPool.connect();
      try {
        const pidRes = await poolClient.query("SELECT pg_backend_pid() as pid");
        session.runningQueryPid = parseInt(String(pidRes.rows[0]?.pid ?? 0), 10) || undefined;
        const result = await poolClient.query({ text: limitedQuery, rowMode: "array" });
        const columnsInfo = await calculateColumnEditable(session.backGroundPool, result.fields, limitedQuery);
        return { rows: result.rows, columns: columnsInfo, hasMore: false };
      } finally {
        session.runningQueryPid = undefined;
        poolClient.release();
      }
    }

    case "postgres/schemas": {
      const cid = getConnId();
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema' ORDER BY schema_name`
      );
      return { schemas: result.rows.map((r) => r.schema_name) };
    }

    case "postgres/tables": {
      const cid = getConnId();
      const { schema } = payload as { connectionId: string; schema: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_type, table_name`,
        [schema]
      );
      let functions: Array<{ oid: number; schema: string; name: string; args: string }> = [];
      try {
        const funcResult = await session.backGroundPool.query(
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

    case "postgres/columns": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`,
        [schema, table]
      );
      return { columns: result.rows };
    }

    case "postgres/indexes": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`,
        [schema, table]
      );
      return { indexes: result.rows };
    }

    case "postgres/data-types": {
      const cid = getConnId();
      const session = getS(cid);
      const result = await session.backGroundPool.query(
        `SELECT t.typname AS name
         FROM pg_type t
         JOIN pg_namespace n ON t.typnamespace = n.oid
         WHERE n.nspname = 'pg_catalog'
           AND t.typtype IN ('b', 'e', 'p')
           AND t.typname !~ '^_'
         ORDER BY t.typname`
      );
      return { types: result.rows.map((r: { name: string }) => r.name) };
    }

    case "postgres/execute-ddl": {
      const cid = getConnId();
      const { sql } = payload as { connectionId: string; sql: string };
      const session = getS(cid);
      try {
        sendSSEMessage(cid, { type: "QUERY", message: `执行 DDL: ${sql.slice(0, 80)}...`, timestamp: Date.now() });
        await session.backGroundPool.query(sql);
        sendSSEMessage(cid, { type: "INFO", message: "DDL 执行成功", timestamp: Date.now() });
        return { success: true };
      } catch (e: any) {
        sendSSEMessage(cid, { type: "ERROR", message: `DDL 错误: ${e.message}`, timestamp: Date.now(), detail: e.detail || e.hint });
        throw e;
      }
    }

    case "postgres/foreign-keys": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const outgoingResult = await session.backGroundPool.query(
        `SELECT tc.constraint_name, tc.table_schema AS source_schema, tc.table_name AS source_table,
         kcu.column_name AS source_column, ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2`,
        [schema, table]
      );
      const incomingResult = await session.backGroundPool.query(
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

    case "postgres/table-ddl": {
      const cid = getConnId();
      const { schema, table } = payload as { connectionId: string; schema: string; table: string };
      const session = getS(cid);
      const pool = session.backGroundPool;

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
         is_nullable, column_default, udt_name
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

    case "postgres/function-ddl": {
      const cid = getConnId();
      const { schema, function: funcName, oid } = payload as { connectionId: string; schema: string; function: string; oid?: number };
      const session = getS(cid);
      const pool = session.backGroundPool;

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

    case "postgres/query": {
      const cid = getConnId();
      const { query } = payload as { connectionId: string; query: string };
      const session = getS(cid);
      const client = session.userUsedClient;

      if ((client as any).processID) session.runningQueryPid = (client as any).processID;

      try {
        sendSSEMessage(cid, { type: "QUERY", message: `执行查询: ${query.slice(0, 100)}...`, timestamp: Date.now() });
        const result = await client.query({ text: query, rowMode: "array" });
        session.runningQueryPid = undefined;
        sendSSEMessage(cid, {
          type: "INFO",
          message: `${result.command || ""} 完成: ${result.rowCount ?? 0} 行`,
          timestamp: Date.now(),
        });
        const columnsInfo = await calculateColumnEditable(client, result.fields);
        return { result: result.rows, columns: columnsInfo };
      } catch (e: any) {
        session.runningQueryPid = undefined;
        sendSSEMessage(cid, { type: "ERROR", message: `查询错误: ${e.message}`, timestamp: Date.now(), detail: e.detail || e.hint });
        throw e;
      }
    }

    default:
      throw new Error(`未知 API 方法: ${method}`);
  }
}
