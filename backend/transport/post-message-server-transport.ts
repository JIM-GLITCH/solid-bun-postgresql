/**
 * postMessage 式服务端传输：供 vscode / electrobun 宿主在进程内承载 jsonrpc 会话。
 * 与 http-server-transport 对称，但不依赖 HTTP：宿主把客户端消息喂给
 * `handleClientMessage`，服务端下行消息经 `sendToClient` 推回客户端。
 */

import type { Message } from "vscode-jsonrpc";
import type {
  SessionIOEnds,
  TransportServer,
} from "../rpc/rpc-session/transport";

/** 客户端 → 服务端的消息形态（shakehand / buildconnection / 业务消息） */
export type PostMessageClientMsg =
  | { type: "rpc-shakehand" }
  | { type: "rpc-buildconnection" }
  | { type: "rpc-msg"; msg: Message };

export interface PostMessageServerTransportOptions {
  /** 请求消息转发进 jsonrpc 层前的改写钩子（如为 subscription/assert 注入 accessToken） */
  transformRequest?: (msg: Message) => Message | Promise<Message>;
}

type ShakehandHandler = () => string;
type BuildConnectionHandler = (sessionId: string) => SessionIOEnds;
type MessageHandler = (sessionId: string, message: Message) => void;
type DisconnectHandler = (sessionId: string) => void;

export class PostMessageServerTransport implements TransportServer {
  private handlers: {
    shakehand: ShakehandHandler[];
    buildconnection: BuildConnectionHandler[];
    message: MessageHandler[];
    disconnect: DisconnectHandler[];
  } = { shakehand: [], buildconnection: [], message: [], disconnect: [] };

  private sessionId: string | undefined;
  private sessionCtx:
    | {
        connectionReaderWriter: WritableStreamDefaultWriter<Message>;
        connectionWriterReader: ReadableStreamDefaultReader<Message>;
      }
    | undefined;
  private disposed = false;

  constructor(
    private readonly sendToClient: (msg: Message) => void,
    private readonly opts: PostMessageServerTransportOptions = {},
  ) {}

  on(
    event: "shakehand" | "buildconnection" | "message" | "disconnect",
    handler:
      | ShakehandHandler
      | BuildConnectionHandler
      | MessageHandler
      | DisconnectHandler,
  ): void {
    if (event === "shakehand") this.handlers.shakehand.push(handler as ShakehandHandler);
    if (event === "buildconnection")
      this.handlers.buildconnection.push(handler as BuildConnectionHandler);
    if (event === "message") this.handlers.message.push(handler as MessageHandler);
    if (event === "disconnect") this.handlers.disconnect.push(handler as DisconnectHandler);
  }

  /** 无 HTTP app（宿主自行挂载消息路由） */
  getApp(): unknown {
    return undefined;
  }

  /** 宿主收到客户端消息后调用；返回值为握手/建连结果，宿主回传给客户端 */
  async handleClientMessage(m: PostMessageClientMsg): Promise<unknown> {
    switch (m.type) {
      case "rpc-shakehand": {
        this.sessionId = this.handlers.shakehand[0]?.() ?? crypto.randomUUID();
        return { sessionId: this.sessionId };
      }
      case "rpc-buildconnection": {
        if (!this.sessionId) throw new Error("shakehand before buildconnection");
        const ends = this.handlers.buildconnection[0]?.(this.sessionId);
        if (!ends) throw new Error("no buildconnection handler registered");
        this.sessionCtx = {
          connectionReaderWriter: ends.connectionReaderWriter,
          connectionWriterReader: ends.connectionWriterReader,
        };
        void this.pumpToClient();
        return { ok: true };
      }
      case "rpc-msg": {
        const ctx = this.sessionCtx;
        if (!ctx) throw new Error("session not built");
        const msg = (await this.opts.transformRequest?.(m.msg)) ?? m.msg;
        ctx.connectionReaderWriter.write(msg);
        this.handlers.message.forEach((cb) => cb(this.sessionId ?? "", msg));
        return { ok: true };
      }
    }
  }

  /** 关闭会话（如 webview 销毁）：触发 disconnect 钩子，DbServer 随之释放 DB 连接 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sessionCtx = undefined;
    this.handlers.disconnect.forEach((cb) => cb(this.sessionId ?? ""));
  }

  /** 服务端 → 客户端：把下行 jsonrpc 消息逐条推回宿主通道 */
  private async pumpToClient(): Promise<void> {
    const ctx = this.sessionCtx;
    if (!ctx) return;
    try {
      for (;;) {
        const { done, value } = await ctx.connectionWriterReader.read();
        if (done || this.disposed) break;
        this.sendToClient(value);
      }
    } catch {
      /* 通道断开按 disconnect 处理 */
    }
  }
}
