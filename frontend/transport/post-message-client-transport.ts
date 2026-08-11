/**
 * postMessage 式客户端传输：供 VsCodeTransport / ElectrobunTransport 承载 jsonrpc 会话。
 * 与 http-client-transport 对称：上行经 `channel.post`，下行经 `receiveServerMessage` 喂入。
 */

import type { Message } from "vscode-jsonrpc";
import type {
  SessionIOEnds,
  TransportClient,
} from "../../backend/rpc/rpc-session/transport";

/** 与后端 PostMessageClientMsg 对应（前端不引后端实现，仅复用类型语义） */
export type PostMessageClientMsg =
  | { type: "rpc-shakehand" }
  | { type: "rpc-buildconnection" }
  | { type: "rpc-msg"; msg: Message };

export interface PostMessageChannel {
  /** 客户端 → 宿主；返回宿主应答（shakehand 时为 `{ sessionId }`） */
  post(msg: PostMessageClientMsg): Promise<unknown>;
}

type BuildConnectionHandler = (sessionId: string) => SessionIOEnds;
type MessageHandler = (sessionId: string, message: Message) => void;
type DisconnectHandler = (sessionId: string) => void;

export class PostMessageClientTransport implements TransportClient {
  private handlers: {
    buildconnection: BuildConnectionHandler[];
    message: MessageHandler[];
    disconnect: DisconnectHandler[];
  } = { buildconnection: [], message: [], disconnect: [] };

  private sessionId: string | undefined;
  private sessionCtx:
    | {
        connectionReaderWriter: WritableStreamDefaultWriter<Message>;
        connectionWriterReader: ReadableStreamDefaultReader<Message>;
      }
    | undefined;
  private disposed = false;

  constructor(private readonly channel: PostMessageChannel) {}

  on(
    event: "buildconnection" | "message" | "disconnect",
    handler: BuildConnectionHandler | MessageHandler | DisconnectHandler,
  ): void {
    if (event === "buildconnection")
      this.handlers.buildconnection.push(handler as BuildConnectionHandler);
    if (event === "message") this.handlers.message.push(handler as MessageHandler);
    if (event === "disconnect") this.handlers.disconnect.push(handler as DisconnectHandler);
  }

  async listen(): Promise<void> {
    this.disposed = false;

    const ack = (await this.channel.post({ type: "rpc-shakehand" })) as {
      sessionId?: string;
    };
    const sessionId = ack?.sessionId;
    if (!sessionId) throw new Error("shakehand failed: no sessionId");
    this.sessionId = sessionId;

    const ends = this.handlers.buildconnection[0]?.(sessionId);
    if (!ends) throw new Error("no buildconnection handler registered");
    this.sessionCtx = {
      connectionReaderWriter: ends.connectionReaderWriter,
      connectionWriterReader: ends.connectionWriterReader,
    };

    await this.channel.post({ type: "rpc-buildconnection" });

    // 上行泵：jsonrpc 出站消息逐条发给宿主
    void (async () => {
      const ctx = this.sessionCtx;
      if (!ctx) return;
      try {
        for (;;) {
          const { done, value } = await ctx.connectionWriterReader.read();
          if (done || this.disposed) break;
          await this.channel.post({ type: "rpc-msg", msg: value });
        }
      } catch (e) {
        if (!this.disposed) console.warn("[client transport] post loop error:", e);
      }
    })();
  }

  /** 宿主推来服务端下行消息时调用 */
  receiveServerMessage(msg: Message): void {
    const ctx = this.sessionCtx;
    if (!ctx || this.disposed) return;
    ctx.connectionReaderWriter.write(msg);
    this.handlers.message.forEach((cb) => cb(this.sessionId ?? "", msg));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sessionCtx = undefined;
    this.handlers.disconnect.forEach((cb) => cb(this.sessionId ?? ""));
  }
}
