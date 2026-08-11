import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type { Message } from "vscode-jsonrpc";
import type {
  SessionIOEnds,
  TransportServer,
} from "../rpc/rpc-session/transport";

const RECONNECT_TTL_MS = 30_000;

interface SessionCtx {
  connectionReaderWriter: WritableStreamDefaultWriter<Message>;
  connectionWriterReader: ReadableStreamDefaultReader<Message>;
  reconnectTimer?: ReturnType<typeof setTimeout>;
}

type ShakehandHandler = () => string;
type BuildConnectionHandler = (sessionId: string) => SessionIOEnds;
type MessageHandler = (sessionId: string, message: Message) => void;
type DisconnectHandler = (sessionId: string) => void;

export interface HttpServerTransportOptions {
  /** 是否启用 CORS（开发模式 Vite 同源部署时无需开启） */
  cors?: boolean;
}

export function createHttpServerTransport(
  opts: HttpServerTransportOptions = {},
): TransportServer {
  const app = new Hono();
  if (opts.cors) {
    app.use(
      "*",
      cors({
        origin: "*",
        allowMethods: ["POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "Accept", "rpc-session-id"],
        exposeHeaders: ["rpc-session-id"],
      }),
    );
  }

  const handlers: {
    shakehand: ShakehandHandler[];
    buildconnection: BuildConnectionHandler[];
    message: MessageHandler[];
    disconnect: DisconnectHandler[];
  } = {
    shakehand: [],
    buildconnection: [],
    message: [],
    disconnect: [],
  };

  const sessions = new Map<string, SessionCtx>();

  (function mountRoutes() {
    app.post("/rpc/shakehand", async (c) => {
      const sessionId =
        handlers.shakehand[0]?.() ?? crypto.randomUUID();
      return c.text(sessionId);
    });

    app.post("/rpc/buildconnection/:sessionId", async (c) => {
      const sessionId = c.req.param().sessionId;
      let ctx = sessions.get(sessionId);

      if (!ctx) {
        const ends = handlers.buildconnection[0]?.(sessionId);
        if (!ends) {
          c.status(500);
          return c.json({ error: "no buildconnection handler registered" });
        }
        ctx = {
          connectionReaderWriter: ends.connectionReaderWriter,
          connectionWriterReader: ends.connectionWriterReader,
        };
        sessions.set(sessionId, ctx);
      }

      if (ctx.reconnectTimer) {
        clearTimeout(ctx.reconnectTimer);
        ctx.reconnectTimer = undefined;
      }

      return streamSSE(c, async (stream) => {
        const readable = new ReadableStream({
          async pull(controller) {
            const { done, value } = await ctx!.connectionWriterReader.read();
            done ? controller.close() : controller.enqueue(value);
          },
        });
        // 必须 await：Hono 在回调结束后会立即 close 流（Node 下会断开 SSE）
        await readable
          .pipeTo(
            new WritableStream({
              write(msg) {
                return stream.writeSSE({ data: JSON.stringify(msg) });
              },
            }),
          )
          .catch(() => {
            ctx!.reconnectTimer = setTimeout(() => {
              if (sessions.get(sessionId) === ctx) {
                sessions.delete(sessionId);
                handlers.disconnect.forEach((cb) => cb(sessionId));
              }
            }, RECONNECT_TTL_MS);
          });
      });
    });

    app.post("/rpc/call/:sessionId", async (c) => {
      const sessionId = c.req.param().sessionId;
      const ctx = sessions.get(sessionId);
      if (!ctx) {
        c.status(404);
        return c.json({ error: "session not found" });
      }

      const msg = await c.req.json<Message>();
      ctx.connectionReaderWriter.write(msg);
      handlers.message.forEach((cb) => cb(sessionId, msg));
      return c.json({ ok: true });
    });
  })();

  return {
    on(
      event: "shakehand" | "buildconnection" | "message" | "disconnect",
      handler:
        | ShakehandHandler
        | BuildConnectionHandler
        | MessageHandler
        | DisconnectHandler,
    ) {
      if (event === "shakehand")
        handlers.shakehand.push(handler as ShakehandHandler);
      if (event === "buildconnection")
        handlers.buildconnection.push(handler as BuildConnectionHandler);
      if (event === "message")
        handlers.message.push(handler as MessageHandler);
      if (event === "disconnect")
        handlers.disconnect.push(handler as DisconnectHandler);
    },

    getApp() {
      return app;
    },
  };
}
