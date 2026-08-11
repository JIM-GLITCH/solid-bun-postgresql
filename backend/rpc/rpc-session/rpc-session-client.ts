import type {
  CancellationToken,
  Message,
  MessageConnection,
  RequestType,
  NotificationType,
} from "vscode-jsonrpc";
import { createMessageConnection } from "vscode-jsonrpc";
import { ReliableMessageConnection } from "./reliable-jsonrpc";
import type { SessionIOEnds, TransportClient } from "./transport";
import { WebStreamMessageReader } from "./webstream-message-reader";
import { WebStreamMessageWriter } from "./webstream-message-writer";

export class RpcSessionClient {
  protected sessionId: string | undefined;
  connection: ReliableMessageConnection | undefined;
  outer: MessageConnection | undefined;
  protected transport: TransportClient;
  private sessionListeners = new Set<(connection: ReliableMessageConnection) => void>();

  constructor(transport: TransportClient) {
    this.transport = transport;
    this.transport.on("buildconnection", (sid) => this.createSession(sid));
    this.transport.on("disconnect", () => this.connection?.dispose());
  }

  /**
   * 会话（重）建立回调：首连与断线重连都会触发，
   * 用于在新 MessageConnection 上重新注册通知/请求处理器。
   */
  onSession(listener: (connection: ReliableMessageConnection) => void): () => void {
    this.sessionListeners.add(listener);
    return () => this.sessionListeners.delete(listener);
  }

  private createSession(sessionId: string): SessionIOEnds {
    const up = new TransformStream<Message, Message>();
    const down = new TransformStream<Message, Message>();

    const reader = new WebStreamMessageReader(down.readable);
    const writer = new WebStreamMessageWriter(up.writable);

    const outer = createMessageConnection(reader, writer);
    const reliable = new ReliableMessageConnection(outer);

    this.sessionId = sessionId;
    this.outer = outer;
    this.connection = reliable;

    reliable.listen();
    for (const listener of this.sessionListeners) {
      try {
        listener(reliable);
      } catch {
        /* 监听器异常不影响会话建立 */
      }
    }

    return {
      connectionWriterReader: up.readable.getReader(),
      connectionReaderWriter: down.writable.getWriter(),
    };
  }

  async listen(): Promise<void> {
    await this.transport.listen();
  }

  sendRequest<P, R, E>(
    type: RequestType<P, R, E>,
    params: P,
    token?: CancellationToken,
  ): Promise<R> {
    const conn = this.connection;
    if (!conn) throw new Error("Not connected. Call listen() first.");
    return token !== undefined
      ? conn.sendRequest(type.method, params as any, token as any)
      : conn.sendRequest(type.method, params as any);
  }

  sendNotification<P>(type: string | NotificationType<P>, params?: P): void {
    const conn = this.connection;
    if (!conn) throw new Error("Not connected. Call listen() first.");
    const method =
      typeof type === "string" ? type : (type as NotificationType<P>).method;
    conn.sendNotification(method, params);
  }

  onNotification<P>(
    type: string | NotificationType<P>,
    handler: (params: P) => void,
  ): void {
    const conn = this.connection;
    if (!conn) throw new Error("Not connected. Call listen() first.");
    const method =
      typeof type === "string" ? type : (type as NotificationType<P>).method;
    conn.onNotification(method, handler);
  }

  onRequest<P, R, E>(
    type: RequestType<P, R, E>,
    handler: (params: P) => R | Promise<R>,
  ): void {
    const conn = this.connection;
    if (!conn) throw new Error("Not connected. Call listen() first.");
    conn.onRequest(type.method, handler as any);
  }

  dispose(): void {
    this.connection?.dispose();
    this.connection = undefined;
    this.outer?.dispose();
    this.outer = undefined;
    this.transport.dispose();
  }
}
