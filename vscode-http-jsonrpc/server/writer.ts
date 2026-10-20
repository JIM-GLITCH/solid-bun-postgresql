import { Hono } from 'hono';
import { AbstractMessageWriter, Message, MessageWriter } from 'vscode-jsonrpc';


export class HttpServerMessageWriter extends AbstractMessageWriter implements MessageWriter {
  protected errorCount = 0;
  protected readonly app: Hono
  /** 当前所有活跃 SSE 客户端的推送函数（每建立一个连接加入一个，断开时移除） */
  protected readonly pushes = new Set<(msg: unknown) => void>();
  /** 与 pushes 一一对应的心跳清理函数 */
  protected readonly heartbeats = new Set<() => void>();
  constructor(app: Hono) {
    super()
    this.app = app
    this.app.get("/sse", async (c) => {
      const self = this
      // 本连接的清理函数（start 内创建、cancel 内调用，二者同级，故提升到此处）
      let connectionCleanup: (() => void) | undefined;
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const push = (msg: unknown) => {
            const content = JSON.stringify(msg);
            controller.enqueue(encoder.encode(`data: ${content}\n\n`));
          };
          self.pushes.add(push);
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
          // 连接断开：移除本连接的 push 与心跳，避免推送堆积到已死控制器、心跳定时器泄漏
          connectionCleanup = () => {
            clearInterval(heartbeatInterval);
            self.pushes.delete(push);
            self.heartbeats.delete(connectionCleanup!);
          };
          self.heartbeats.add(connectionCleanup);
        },
        cancel() {
          // 仅清理本连接的推送与心跳（cancel 与 start 同级，共享 connectionCleanup）
          try { connectionCleanup?.(); } catch { /* noop */ }
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
    // 向所有活跃连接广播；单个连接失败即移除，避免错误累积
    for (const push of [...this.pushes]) {
      try {
        push(msg);
      } catch (e) {
        this.pushes.delete(push);
        this.errorCount++;
        this.fireError(e, msg, this.errorCount);
      }
    }
  }
  dispose(): void {
    for (const cleanup of this.heartbeats) {
      try {
        cleanup();
      } catch {
        /* noop */
      }
    }
    this.heartbeats.clear();
    this.pushes.clear();
  }
}
