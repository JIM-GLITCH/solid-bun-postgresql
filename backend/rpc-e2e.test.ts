/**
 * RPC 全链路 E2E 测试（参照 react-datatable packages/test/e2e.spec.ts）
 *
 * 用内存 postMessage 传输对承载真实 jsonrpc 会话：
 *   RpcSessionClient → ReliableMessageConnection → PostMessageClientTransport
 *   → PostMessageServerTransport → RpcMultiSessionServer → DbServer → TestDriver
 *
 * 覆盖：握手建连、db/connect（connectionId 沿用客户端传入）、db/query +
 * CONNECTION_EVENT 通知推送、db/disconnect、会话销毁时自动释放 DB 连接。
 */

// RIL 兜底：Node 下必须导入，否则 vscode-jsonrpc 消息队列静默失效
import "vscode-jsonrpc/node";

import { describe, it, expect, afterAll } from "vitest";
import {
  CONNECTION_EVENT_NOTIFICATION,
  DB_CONNECT,
  DB_DISCONNECT,
  DB_QUERY,
  defaultDatabaseCapabilities,
  type ApiRequestPayload,
  type ConnectDbRequest,
  type DatabaseCapabilities,
  type DbKind,
  type SSEMessage,
} from "../shared/src";
import { RpcMultiSessionServer } from "./rpc/rpc-session";
import { RpcSessionClient } from "./rpc/rpc-session/rpc-session-client";
import { DbServer } from "./db-server";
import type { DbConnectOutcome, DbDriver, DriverContext } from "./driver";
import type { SessionConnection } from "./session-connection";
import {
  PostMessageServerTransport,
  type PostMessageClientMsg,
} from "./transport/post-message-server-transport";
import { PostMessageClientTransport } from "../frontend/transport/post-message-client-transport";

// ─── 内存 TestDriver ─────────────────────────────────────────────────────────

type TestSession = SessionConnection & { testCtx: DriverContext };

class TestDriver implements DbDriver<TestSession> {
  readonly kind: DbKind = "postgres";
  readonly kinds: readonly DbKind[] = ["postgres"];
  /** 记录 disconnect 调用，供断言（含会话销毁触发的自动释放） */
  disconnected: string[] = [];

  async connect(
    params: ConnectDbRequest,
    ctx: DriverContext,
  ): Promise<DbConnectOutcome<TestSession>> {
    const session = {
      dbKind: "postgres",
      connectionId: params.connectionId,
      testCtx: ctx,
    } as unknown as TestSession;
    return {
      session,
      result: { success: true, connectionId: params.connectionId, dbType: "postgres" },
    };
  }

  async disconnect(_session: TestSession, params: { connectionId: string }): Promise<unknown> {
    this.disconnected.push(params.connectionId);
    return { success: true };
  }

  capabilities(_kind: DbKind): DatabaseCapabilities {
    return defaultDatabaseCapabilities("postgres");
  }

  async query(session: TestSession, params: ApiRequestPayload["db/query"]): Promise<unknown> {
    // 模拟查询期间的事件推送（对齐 sendSSEMessage 桥接语义）
    session.testCtx.push(params.connectionId, {
      type: "INFO",
      message: `query: ${params.query}`,
      timestamp: Date.now(),
    } as SSEMessage);
    return { rows: [{ ok: true, sql: params.query }], fields: [] };
  }
}

// ─── 组装：内存传输对 + RpcMultiSessionServer + DbServer ─────────────────────

function createStack() {
  const driver = new TestDriver();
  let clientTransport!: PostMessageClientTransport;

  const serverTransport = new PostMessageServerTransport((msg) => {
    // 模拟异步信道：避免服务端应答在客户端写侧尚未就绪时同栈回灌
    setTimeout(() => clientTransport.receiveServerMessage(msg), 0);
  });
  clientTransport = new PostMessageClientTransport({
    post: (m: PostMessageClientMsg) => serverTransport.handleClientMessage(m),
  });

  const rpc = new RpcMultiSessionServer(serverTransport);
  const dbServer = new DbServer(rpc);
  dbServer.registerDriver(driver);

  const client = new RpcSessionClient(clientTransport);

  return { driver, serverTransport, clientTransport, rpc, dbServer, client };
}

const disposables: Array<{ dispose(): void }> = [];

afterAll(() => {
  // 释放所有会话/传输，防止套件挂起
  for (const d of disposables) {
    try {
      d.dispose();
    } catch {
      /* ignore */
    }
  }
});

describe("E2E: RpcSessionClient ←→ 内存传输 ←→ RpcMultiSessionServer + DbServer", () => {
  it("connect / query(+推送) / disconnect 全链路", async () => {
    const { driver, dbServer, client } = createStack();
    disposables.push(client);

    await client.listen();

    const events: Array<{ connectionId: string; event: SSEMessage }> = [];
    client.onNotification(CONNECTION_EVENT_NOTIFICATION, (params) => {
      events.push(params);
    });

    // connect：connectionId 沿用客户端传入（solid 的 ${storedId}-${sessionId} 规则）
    const connectResult = await client.sendRequest(DB_CONNECT, {
      connectionId: "stored-1-session-a",
      dbType: "postgres",
      host: "localhost",
      username: "test",
    } as never);
    expect(connectResult).toMatchObject({
      success: true,
      connectionId: "stored-1-session-a",
      dbType: "postgres",
    });
    expect(dbServer.connectionCount).toBe(1);

    // query：驱动返回结果，且查询期间的事件经 CONNECTION_EVENT 通知送达
    const queryResult = await client.sendRequest(DB_QUERY, {
      connectionId: "stored-1-session-a",
      dbType: "postgres",
      query: "SELECT 1",
    } as never);
    expect(queryResult).toMatchObject({ rows: [{ ok: true, sql: "SELECT 1" }] });
    await new Promise((r) => setTimeout(r, 10));
    expect(events.length).toBe(1);
    expect(events[0].connectionId).toBe("stored-1-session-a");
    expect(events[0].event).toMatchObject({ type: "INFO", message: "query: SELECT 1" });

    // disconnect：连接记录移除，驱动 disconnect 被调用
    await client.sendRequest(DB_DISCONNECT, {
      connectionId: "stored-1-session-a",
      dbType: "postgres",
    } as never);
    expect(dbServer.connectionCount).toBe(0);
    expect(driver.disconnected).toEqual(["stored-1-session-a"]);
  });

  it("会话销毁时自动释放名下 DB 连接（替代旧 SSE 断开释放语义）", async () => {
    const { driver, serverTransport, dbServer, client } = createStack();
    disposables.push(client);

    await client.listen();
    await client.sendRequest(DB_CONNECT, {
      connectionId: "stored-2-session-b",
      dbType: "postgres",
      host: "localhost",
      username: "test",
    } as never);
    expect(dbServer.connectionCount).toBe(1);

    // 宿主销毁传输（如 webview 关闭）→ disconnect 钩子 → 会话销毁 → 驱动释放连接
    serverTransport.dispose();
    await new Promise((r) => setTimeout(r, 20));
    expect(dbServer.connectionCount).toBe(0);
    expect(driver.disconnected).toContain("stored-2-session-b");
  });

  it("独立 session 互不干扰", async () => {
    const stack1 = createStack();
    const stack2 = createStack();
    disposables.push(stack1.client, stack2.client);

    await Promise.all([stack1.client.listen(), stack2.client.listen()]);

    await stack1.client.sendRequest(DB_CONNECT, {
      connectionId: "cid-1",
      dbType: "postgres",
    } as never);
    await stack2.client.sendRequest(DB_CONNECT, {
      connectionId: "cid-2",
      dbType: "postgres",
    } as never);

    const [r1, r2] = await Promise.all([
      stack1.client.sendRequest(DB_QUERY, { connectionId: "cid-1", query: "SELECT 1" } as never),
      stack2.client.sendRequest(DB_QUERY, { connectionId: "cid-2", query: "SELECT 2" } as never),
    ]);
    expect(r1).toMatchObject({ rows: [{ sql: "SELECT 1" }] });
    expect(r2).toMatchObject({ rows: [{ sql: "SELECT 2" }] });
  });
});
