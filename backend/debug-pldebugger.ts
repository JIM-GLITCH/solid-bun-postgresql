/**
 * pldebugger 调试器后端逻辑
 * 依赖 PostgreSQL pldebugger 扩展 (CREATE EXTENSION pldbgapi;)
 */

import type { Pool, Client } from "pg";

/** 释放连接：Client 用 end()，PoolClient 用 release() */
function releaseClient(c: Client | { release?: () => void; end?: (cb?: () => void) => void }): void {
  if (typeof (c as any).release === "function") (c as any).release();
  else if (typeof (c as any).end === "function") (c as any).end().catch(() => {});
}

export interface DebugSession {
  sessionId: number;
  proxyClient: Client;
  targetClient?: Client;  // 执行 SELECT func() 的连接，调试期间需保持
}

const debugSessionMap = new Map<string, DebugSession>();

function sessionKey(connectionId: string, debugSessionId: string) {
  return `${connectionId}:${debugSessionId}`;
}

/** 检查 pldebugger 是否可用 */
export async function checkPldebuggerAvailable(pool: Pool): Promise<{ available: boolean; error?: string }> {
  try {
    const r = await pool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pldbgapi'`
    );
    return { available: (r.rows?.length ?? 0) > 0 };
  } catch (e: any) {
    return { available: false, error: e.message };
  }
}

/** 获取可调试的 plpgsql 函数列表 */
export async function getDebuggableFunctions(
  pool: Pool,
  schema?: string
): Promise<Array<{ oid: number; schema: string; name: string; args: string }>> {
  const schemaFilter = schema
    ? `AND n.nspname = $1`
    : `AND n.nspname NOT LIKE 'pg_%' AND n.nspname != 'information_schema'`;
  const params = schema ? [schema] : [];
  const r = await pool.query(
    `SELECT p.oid, n.nspname AS schema, p.proname AS name,
            pg_get_function_identity_arguments(p.oid) AS args
     FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid
     JOIN pg_language l ON p.prolang = l.oid
     WHERE l.lanname = 'plpgsql' ${schemaFilter}
     ORDER BY n.nspname, p.proname`,
    params
  );
  return r.rows.map((row: any) => ({
    oid: row.oid,
    schema: row.schema,
    name: row.name,
    args: row.args || "",
  }));
}

/** 根据 oid 获取函数调用 SQL */
async function getFunctionCallSql(client: { query: Pool["query"] }, funcOid: number, args: string[]): Promise<string> {
  const r = await client.query(
    `SELECT n.nspname, p.proname FROM pg_proc p
     JOIN pg_namespace n ON p.pronamespace = n.oid WHERE p.oid = $1`,
    [funcOid]
  );
  if (r.rows.length === 0) throw new Error(`函数 OID ${funcOid} 不存在`);
  const { nspname, proname } = r.rows[0];
  const qualified = `"${nspname}"."${proname}"`;
  const argList = args.length > 0 ? args.join(", ") : "";
  return `SELECT ${qualified}(${argList})`;
}

/**
 * 直接调试：使用 pldbg_create_listener（pgAdmin v3 流程，无需 NOTICE/port/attach）
 * 1. proxyConn: pldbg_create_listener() → session_id
 * 2. proxyConn: pldbg_set_breakpoint(session_id, func_oid, -1) 入口断点
 * 3. targetConn: 执行函数
 * 4. proxyConn: pldbg_wait_for_breakpoint(session_id)
 */
export async function startDirectDebug(
  connectionId: string,
  getExtraClient: () => Promise<Client>,
  funcOid: number,
  args: string[] = []
): Promise<{
  debugSessionId: string;
  breakpoint?: { funcOid: number; lineNumber: number };
  source?: string;
  stack?: any[];
  variables?: any[];
}> {
  let proxyClient: Client | null = null;
  let targetClient: Client | null = null;

  try {
    proxyClient = await getExtraClient();

    // 1. 创建调试会话（直接返回 session_id，无需 NOTICE/port）
    let createRes: any;
    try {
      createRes = await proxyClient.query("SELECT pldbg_create_listener()");
    } catch (e: any) {
      throw new Error(
        `pldbg_create_listener 失败: ${e.message}（需要 pldebugger v3+，可降级使用 pldbg_oid_debug 流程）`
      );
    }
    const row = createRes.rows[0];
    const sessionId = row?.pldbg_create_listener ?? row?.session_id ?? (row && Object.values(row)[0]);
    if (sessionId == null) {
      throw new Error("pldbg_create_listener 返回空");
    }

    // 2. 设置入口断点（-1 表示入口）
    try {
      await proxyClient.query("SELECT pldbg_set_breakpoint($1, $2, -1)", [sessionId, funcOid]);
    } catch (e: any) {
      throw new Error(`设置入口断点失败: ${e.message}`);
    }

    // 3. 执行函数（另一连接）
    const callSql = await getFunctionCallSql(proxyClient, funcOid, args);
    targetClient = await getExtraClient();
    targetClient.query(callSql).catch(() => {});

    // 4. 等待目标命中断点
    const waitRes = await proxyClient!.query("SELECT * FROM pldbg_wait_for_breakpoint($1)", [sessionId]);
    const bpRow = waitRes.rows[0];
    const funcOidCur = bpRow?.func ? parseInt(String(bpRow.func), 10) : funcOid;
    const lineNumber = bpRow?.linenumber ?? 1;

    const debugSessionId = String(sessionId);
    debugSessionMap.set(sessionKey(connectionId, debugSessionId), {
      sessionId,
      proxyClient: proxyClient!,
      targetClient: targetClient!,
    });
    targetClient = null;

    const state = await fetchDebugState(proxyClient!, sessionId, funcOidCur);
    return {
      debugSessionId,
      breakpoint: { funcOid: funcOidCur, lineNumber },
      source: state.source,
      stack: state.stack,
      variables: state.variables,
    };
  } catch (e: any) {
    if (proxyClient) releaseClient(proxyClient);
    if (targetClient) releaseClient(targetClient);
    throw e;
  }
}

async function fetchDebugState(
  proxyClient: Client,
  sessionId: number,
  funcOid: number
): Promise<{ source?: string; stack?: any[]; variables?: any[] }> {
  let source: string | undefined;
  let stack: any[] = [];
  let variables: any[] = [];

  try {
    const srcRes = await proxyClient.query("SELECT pldbg_get_source($1, $2) AS src", [sessionId, funcOid]);
    source = srcRes.rows[0]?.src;
  } catch {}

  try {
    const stackRes = await proxyClient.query("SELECT * FROM pldbg_get_stack($1)", [sessionId]);
    stack = stackRes.rows || [];
  } catch {}

  try {
    const varRes = await proxyClient.query("SELECT * FROM pldbg_get_variables($1)", [sessionId]);
    variables = varRes.rows || [];
  } catch {}

  return { source, stack, variables };
}

async function runStepCommand(
  proxyClient: Client,
  sessionId: number,
  cmd: "pldbg_continue" | "pldbg_step_into" | "pldbg_step_over"
): Promise<{ funcOid: number; lineNumber: number } | null> {
  const res = await proxyClient.query(`SELECT * FROM ${cmd}($1)`, [sessionId]);
  const row = res.rows[0];
  if (!row) return null;
  const funcOid = row.func != null ? parseInt(String(row.func), 10) : 0;
  const lineNumber = row.linenumber ?? 0;
  return { funcOid, lineNumber };
}

/** 继续执行 */
export async function debugContinue(
  connectionId: string,
  debugSessionId: string
): Promise<{
  stopped: boolean;
  breakpoint?: { funcOid: number; lineNumber: number };
  source?: string;
  stack?: any[];
  variables?: any[];
  done?: boolean;
}> {
  const key = sessionKey(connectionId, debugSessionId);
  const session = debugSessionMap.get(key);
  if (!session) throw new Error("调试会话不存在");

  const result = await runStepCommand(session.proxyClient, session.sessionId, "pldbg_continue");
  if (!result) {
    return { stopped: false, done: true };
  }

  const state = await fetchDebugState(session.proxyClient, session.sessionId, result.funcOid);
  return {
    stopped: true,
    breakpoint: result,
    source: state.source,
    stack: state.stack,
    variables: state.variables,
  };
}

/** 单步进入 */
export async function debugStepInto(
  connectionId: string,
  debugSessionId: string
): Promise<{
  stopped: boolean;
  breakpoint?: { funcOid: number; lineNumber: number };
  source?: string;
  stack?: any[];
  variables?: any[];
}> {
  const key = sessionKey(connectionId, debugSessionId);
  const session = debugSessionMap.get(key);
  if (!session) throw new Error("调试会话不存在");

  const result = await runStepCommand(session.proxyClient, session.sessionId, "pldbg_step_into");
  if (!result) return { stopped: false };

  const state = await fetchDebugState(session.proxyClient, session.sessionId, result.funcOid);
  return {
    stopped: true,
    breakpoint: result,
    source: state.source,
    stack: state.stack,
    variables: state.variables,
  };
}

/** 单步越过 */
export async function debugStepOver(
  connectionId: string,
  debugSessionId: string
): Promise<{
  stopped: boolean;
  breakpoint?: { funcOid: number; lineNumber: number };
  source?: string;
  stack?: any[];
  variables?: any[];
}> {
  const key = sessionKey(connectionId, debugSessionId);
  const session = debugSessionMap.get(key);
  if (!session) throw new Error("调试会话不存在");

  const result = await runStepCommand(session.proxyClient, session.sessionId, "pldbg_step_over");
  if (!result) return { stopped: false };

  const state = await fetchDebugState(session.proxyClient, session.sessionId, result.funcOid);
  return {
    stopped: true,
    breakpoint: result,
    source: state.source,
    stack: state.stack,
    variables: state.variables,
  };
}

/** 中止调试 */
export async function debugAbort(connectionId: string, debugSessionId: string): Promise<boolean> {
  const key = sessionKey(connectionId, debugSessionId);
  const session = debugSessionMap.get(key);
  if (!session) return false;

  try {
    await session.proxyClient.query("SELECT pldbg_abort_target($1)", [session.sessionId]);
  } catch {}
  releaseClient(session.proxyClient);
  if (session.targetClient) releaseClient(session.targetClient);
  debugSessionMap.delete(key);
  return true;
}

/** 获取当前调试状态 */
export async function getDebugState(
  connectionId: string,
  debugSessionId: string
): Promise<{
  source?: string;
  stack?: any[];
  variables?: any[];
  breakpoints?: any[];
}> {
  const key = sessionKey(connectionId, debugSessionId);
  const session = debugSessionMap.get(key);
  if (!session) throw new Error("调试会话不存在");

  const bpRes = await session.proxyClient.query("SELECT * FROM pldbg_get_breakpoints($1)", [session.sessionId]);
  const breakpoints = bpRes.rows || [];

  const frame = session.proxyClient.query("SELECT * FROM pldbg_get_stack($1)", [session.sessionId]);
  const stackRes = await frame;
  const topFrame = stackRes.rows?.[0];
  const funcOid = topFrame?.func != null ? parseInt(String(topFrame.func), 10) : 0;

  const state = await fetchDebugState(session.proxyClient, session.sessionId, funcOid);
  return {
    ...state,
    breakpoints,
  };
}

/** 设置断点 */
export async function setBreakpoint(
  connectionId: string,
  debugSessionId: string,
  funcOid: number,
  lineNumber: number
): Promise<boolean> {
  const key = sessionKey(connectionId, debugSessionId);
  const session = debugSessionMap.get(key);
  if (!session) throw new Error("调试会话不存在");

  const res = await session.proxyClient.query(
    "SELECT pldbg_set_breakpoint($1, $2, $3) AS ok",
    [session.sessionId, funcOid, lineNumber]
  );
  return res.rows[0]?.ok === true;
}

/** 删除断点 */
export async function dropBreakpoint(
  connectionId: string,
  debugSessionId: string,
  funcOid: number,
  lineNumber: number
): Promise<boolean> {
  const key = sessionKey(connectionId, debugSessionId);
  const session = debugSessionMap.get(key);
  if (!session) throw new Error("调试会话不存在");

  const res = await session.proxyClient.query(
    "SELECT pldbg_drop_breakpoint($1, $2, $3) AS ok",
    [session.sessionId, funcOid, lineNumber]
  );
  return res.rows[0]?.ok === true;
}
