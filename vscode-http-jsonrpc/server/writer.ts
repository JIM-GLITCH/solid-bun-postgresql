import { Hono } from 'hono';
import { AbstractMessageWriter, Message, MessageWriter } from 'vscode-jsonrpc';


export class HttpServerMessageWriter extends AbstractMessageWriter implements MessageWriter {
  protected errorCount = 0;
  protected readonly app: Hono
  protected push!: (msg: unknown) => void
  hearbeatCleanup: (() => void) | undefined;
  constructor(app: Hono) {
    super()
    this.app = app
    this.app.get("/sse", async (c) => {
      const self = this
      let cleanup: (() => void) | undefined;
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          let content = "";
          const push = (msg: unknown) => {
            const content = JSON.stringify(msg);
            controller.enqueue(new TextEncoder().encode(`data: ${content}\n\n`));

          }
          self.push = push;
          // 设置心跳防止断开
          let heartbeatInterval: ReturnType<typeof setInterval>;
          const sendHeartbeat = () => {
            try {
              controller.enqueue(encoder.encode(": heartbeat\n\n"));
            } catch {
              clearInterval(heartbeatInterval);
            }
          };
          sendHeartbeat();
          heartbeatInterval = setInterval(sendHeartbeat, 10000);
          cleanup = () => {
            clearInterval(heartbeatInterval);
          };
          self.hearbeatCleanup = cleanup;
        },
        cancel() {
          cleanup?.();
        }
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    })
  }
  end(): void {

  }

  async write(msg: Message): Promise<void> {
    try {
      this.push(msg);
    } catch (e) {
      this.errorCount++;
      this.fireError(e, msg, this.errorCount);
    }
  }
  dispose(): void {
    this.hearbeatCleanup?.();
  }
}