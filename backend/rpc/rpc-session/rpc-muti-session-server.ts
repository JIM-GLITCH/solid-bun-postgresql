import "vscode-jsonrpc/node";
import { createMessageConnection } from "vscode-jsonrpc";
import type {
  Message,
  MessageConnection,
  RequestType,
  NotificationType,
} from "vscode-jsonrpc";
import { ReliableMessageConnection } from "./reliable-jsonrpc";
import type { SessionIOEnds, TransportServer } from "./transport";
import { WebStreamMessageReader } from "./webstream-message-reader";
import { WebStreamMessageWriter } from "./webstream-message-writer";

export class RpcMultiSessionServer {
  protected transport: TransportServer;
  private sessions = new Map<
    string,
    { reliable: ReliableMessageConnection; outer: MessageConnection }
  >();
  /** MessageConnection → sessionId 反向索引，供 handler 获取服务端分配的 sessionId */
  private connectionSessions = new WeakMap<MessageConnection, string>();
  private requestHandlers = new Map<
    string,
    (params: unknown, connection: MessageConnection) => unknown
  >();
  private notificationHandlers = new Map<
    string,
    (params: unknown, connection: MessageConnection) => void
  >();
  private sessionDisposeListeners = new Set<
    (sessionId: string, connection: MessageConnection) => void
  >();

  constructor(transport: TransportServer) {
    this.transport = transport;
    this.transport.on("shakehand", () => crypto.randomUUID());
    this.transport.on("buildconnection", (sid) => this.createSession(sid));
    this.transport.on("disconnect", (sid) => this.disposeSession(sid));
  }

  private createSession(sessionId: string): SessionIOEnds {
    const up = new TransformStream<Message, Message>();
    const down = new TransformStream<Message, Message>();

    const reader = new WebStreamMessageReader(up.readable);
    const writer = new WebStreamMessageWriter(down.writable);

    const outer = createMessageConnection(reader, writer);
    const reliable = new ReliableMessageConnection(outer);

    for (const [method, handler] of this.requestHandlers) {
      reliable.onRequest(method, (p) => handler(p, reliable));
    }
    for (const [method, handler] of this.notificationHandlers) {
      reliable.onNotification(method, (p) => handler(p, reliable));
    }

    this.sessions.set(sessionId, { reliable, outer });
    this.connectionSessions.set(reliable, sessionId);
    reliable.listen();

    return {
      connectionReaderWriter: up.writable.getWriter(),
      connectionWriterReader: down.readable.getReader(),
    };
  }

  disposeSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    this.connectionSessions.delete(s.reliable);
    for (const listener of this.sessionDisposeListeners) {
      try {
        listener(sessionId, s.reliable);
      } catch {
        /* 监听器异常不影响会话销毁 */
      }
    }
    s.reliable.dispose();
    s.outer.dispose();
  }

  /** 获取服务端为当前 MessageConnection 分配的 sessionId */
  getSessionId(connection: MessageConnection): string | undefined {
    return this.connectionSessions.get(connection);
  }

  /** 会话销毁回调（供业务层清理挂在该会话上的资源，如数据库连接） */
  onSessionDispose(
    listener: (sessionId: string, connection: MessageConnection) => void,
  ): () => void {
    this.sessionDisposeListeners.add(listener);
    return () => this.sessionDisposeListeners.delete(listener);
  }

  onRequest<P, R, E>(
    type: RequestType<P, R, E>,
    handler: (params: P, connection: MessageConnection) => R | Promise<R>,
  ) {
    this.requestHandlers.set(type.method, handler as any);
  }

  onNotification<P>(
    type: NotificationType<P>,
    handler: (params: P, connection: MessageConnection) => void,
  ) {
    this.notificationHandlers.set(type.method, handler as any);
  }
}
