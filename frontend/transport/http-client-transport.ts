import { fetchEventSource } from "@microsoft/fetch-event-source";
import type { Message } from "vscode-jsonrpc";
import type {
  SessionIOEnds,
  TransportClient,
} from "../../backend/rpc/rpc-session/transport";

type BuildConnectionHandler = (sessionId: string) => SessionIOEnds;
type MessageHandler = (sessionId: string, message: Message) => void;
type DisconnectHandler = (sessionId: string) => void;

export function createHttpClientTransport(baseUrl: string): TransportClient {
  const handlers: {
    buildconnection: BuildConnectionHandler[];
    message: MessageHandler[];
    disconnect: DisconnectHandler[];
  } = {
    buildconnection: [],
    message: [],
    disconnect: [],
  };

  let sessionCtx:
    | {
        sessionId: string;
        connectionReaderWriter: WritableStreamDefaultWriter<Message>;
        connectionWriterReader: ReadableStreamDefaultReader<Message>;
      }
    | undefined;

  let sseAbort: AbortController | undefined;
  let disposed = false;

  async function openSse(sessionId: string) {
    sseAbort?.abort();
    sseAbort = new AbortController();

    await fetchEventSource(`${baseUrl}/rpc/buildconnection/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: sseAbort.signal,

      onmessage(ev) {
        if (!sessionCtx) return;
        const msg = JSON.parse(ev.data) as Message;
        sessionCtx.connectionReaderWriter.write(msg);
        handlers.message.forEach((cb) => cb(sessionId, msg));
      },

      async onopen(res) {
        if (
          res.ok &&
          res.headers.get("content-type")?.includes("text/event-stream")
        ) {
          return;
        }
        throw new Error(`SSE open failed: ${res.status}`);
      },

      onerror(err) {
        if (disposed) throw err;
        console.warn("[client transport] SSE error, will reconnect:", err);
      },

      onclose() {
        if (disposed) return;
        console.warn("[client transport] SSE closed, will reconnect");
      },
    });
  }

  return {
    on(
      event: "buildconnection" | "message" | "disconnect",
      handler: BuildConnectionHandler | MessageHandler | DisconnectHandler,
    ) {
      if (event === "buildconnection")
        handlers.buildconnection.push(handler as BuildConnectionHandler);
      if (event === "message")
        handlers.message.push(handler as MessageHandler);
      if (event === "disconnect")
        handlers.disconnect.push(handler as DisconnectHandler);
    },

    async listen() {
      disposed = false;

      const shakehandRes = await fetch(`${baseUrl}/rpc/shakehand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!shakehandRes.ok)
        throw new Error(`shakehand failed: ${shakehandRes.status}`);
      const serverSessionId = (await shakehandRes.text()).trim();

      const ends = handlers.buildconnection[0]?.(serverSessionId);
      if (!ends) throw new Error("no buildconnection handler registered");

      sessionCtx = {
        sessionId: serverSessionId,
        connectionWriterReader: ends.connectionWriterReader,
        connectionReaderWriter: ends.connectionReaderWriter,
      };

      (async () => {
        while (sessionCtx && !disposed) {
          try {
            const { done, value } = await sessionCtx.connectionWriterReader.read();
            if (done) break;
            await fetch(`${baseUrl}/rpc/call/${serverSessionId}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(value),
            });
          } catch (e) {
            if (disposed) break;
            console.warn(
              "[client transport] POST /call error, retrying:",
              e,
            );
            await new Promise((r) => setTimeout(r, 500));
          }
        }
      })().catch((e) => {
        if (!disposed)
          console.error("[client transport] connectionWriterReader loop error:", e);
      });

      await openSse(serverSessionId);
    },

    dispose() {
      disposed = true;
      sseAbort?.abort();
      sseAbort = undefined;
      sessionCtx = undefined;
    },
  };
}
