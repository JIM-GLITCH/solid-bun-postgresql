/**
 * ReliableMessageConnection —— 在不可靠的 MessageConnection 之上实现可靠消息投递。
 *
 * 核心机制：
 * - 所有业务消息（request / notification / response）经 writer 发出时，
 *   包裹为 { seq, msg } 信封，通过底层 outer 的 reliable/deliver 通知发送。
 * - 对端收到后推送至 reader，同时发 reliable/ack 累积确认。
 * - 重连时通过 reliable/sync + reliable/sync-response 重放未确认消息。
 *
 * 使用方式：
 * ```ts
 * const reliable = new ReliableMessageConnection(outer, () => onGap?.());
 * outer.listen();
 * reliable.listen();
 * reliable.onRequest("method", handler);
 *
 * // 重连
 * reliable.rebind(newOuterConnection);
 * ```
 */

import {
  createMessageConnection,
  type MessageConnection,
  type Message,
  type RequestMessage,
} from "vscode-jsonrpc";
import {
  RELIABLE_DELIVER,
  RELIABLE_ACK,
  RELIABLE_SYNC,
  RELIABLE_SYNC_RESPONSE,
  type ReliableEnvelope,
} from "../../../shared/src";
import { WebStreamMessageReader } from "./webstream-message-reader";
import { WebStreamMessageWriter } from "./webstream-message-writer";

// ─── 常量 ──────────────────────────────────────────────────────────────

const ACK_INTERVAL = 10; // 每 N 条消息发送一次 ack
const MAX_BUFFER_SIZE = 1000; // 发送缓冲区上限
const MAX_SEEN_REQUESTS = 500; // 已处理请求 ID 集合上限


// ─── ReliableMessageConnection ──────────────────────────────────────────

/**
 * 可靠消息连接，实现 MessageConnection 的全部接口。
 *
 * 构造函数接收一个底层 MessageConnection（outer），在此之上建立
 * seq/ack/sync 可靠传输协议，对上层业务代码表现为一个标准的
 * MessageConnection。
 */
export class ReliableMessageConnection implements MessageConnection {
  // ── MessageConnection 事件（代理至 inner connection） ─────────────

  onUnhandledNotification!: MessageConnection["onUnhandledNotification"];
  onUnhandledProgress!: MessageConnection["onUnhandledProgress"];
  onError!: MessageConnection["onError"];
  onClose!: MessageConnection["onClose"];
  onDispose!: MessageConnection["onDispose"];

  // ── MessageConnection 方法（代理至 inner connection） ─────────────

  sendRequest!: MessageConnection["sendRequest"];
  onRequest!: MessageConnection["onRequest"];
  sendNotification!: MessageConnection["sendNotification"];
  onNotification!: MessageConnection["onNotification"];
  onProgress!: MessageConnection["onProgress"];
  sendProgress!: MessageConnection["sendProgress"];
  trace!: MessageConnection["trace"];
  hasPendingResponse!: MessageConnection["hasPendingResponse"];
  end!: MessageConnection["end"];
  inspect!: MessageConnection["inspect"];

  // ── 可靠层特有 ───────────────────────────────────────────────────

  /** 当检测到消息 gap（丢失无法通过重放恢复）时的回调 */
  onGap: (() => void) | undefined;

  // ── 内部状态 ─────────────────────────────────────────────────────

  private outer: MessageConnection;
  private inner: MessageConnection;

  /** 发送端序列号 */
  private sendSeq = 0;

  /** 接收端序列号：对端已发送的最大 seq */
  private recvSeq = 0;

  /** 发送缓冲区：未确认的消息用于重放 */
  private outboundBuffer: ReliableEnvelope[] = [];

  /** 已处理请求 id 集合，用于去重 */
  private seenRequestIds = new Set<string | number>();
  writerForInnerMessageReader: WritableStreamDefaultWriter<Message>;
  readableForInnerMessageWriter: ReadableStream<Message>;

  // ── 构造 & 析构 ──────────────────────────────────────────────────

  /**
   * @param outer 底层的 vscode-jsonrpc MessageConnection
   * @param onGap 消息丢失无法恢复时的回调（可选）
   */
  constructor(outerConnection: MessageConnection, _onGap?: () => void) {

    this.outer = outerConnection
    // 创建可靠层内侧 reader / writer
    const { readable: readableForInnerMessageReader, writable: writableForInnerMessageReader } = new TransformStream()
    const innerMessageReader = new WebStreamMessageReader(readableForInnerMessageReader)
    const { readable: readableForInnerMessageWriter, writable: writableForInnerMessageWriter } = new TransformStream()
    const innerMessageWriter = new WebStreamMessageWriter(writableForInnerMessageWriter)

    this.inner = createMessageConnection(innerMessageReader, innerMessageWriter)
    this.writerForInnerMessageReader = writableForInnerMessageReader.getWriter()
    this.readableForInnerMessageWriter = readableForInnerMessageWriter

    // 将 inner 的方法和事件代理到 ReliableMessageConnection 实例上
    this.bindInnerMethods();
    this.connectInnerAndOuter();
  }

  listen(): void {
    this.inner.listen();
    this.outer.listen();
  }

  /** 释放所有资源 */
  dispose(): void {
    this.inner.dispose();
    this.outer?.dispose();
    this.outboundBuffer.length = 0;
  }

  // ── 可靠层公开 API ───────────────────────────────────────────────

  /**
   * 重新绑定到底层连接（用于重连场景）。
   * 会销毁旧的 outer 连接，注册新 outer 的事件监听，并发送 sync 请求同步状态。
   */
  rebind(newOuter: MessageConnection): void {
    this.outer?.dispose();
    this.outer = newOuter;
    this.connectInnerAndOuter();
    this.sendSync();
  }

  // ── 代理 inner MessageConnection 方法 ─────────────────────────────

  /**
   * 将 inner MessageConnection 的全部方法和事件代理到当前实例上。
   * 业务代码调用 sendRequest / onRequest / onNotification 等方法时，
   * 实际被转发至 inner connection，后者通过 ReliableMessageWriter/Reader
   * 完成可靠信封的包装与解包装。
   */
  private bindInnerMethods(): void {
    const inner = this.inner;

    // 方法需要 bind 到 inner，保证 this 上下文正确
    this.sendRequest = inner.sendRequest.bind(inner);
    this.onRequest = inner.onRequest.bind(inner);
    this.sendNotification = inner.sendNotification.bind(inner);
    this.onNotification = inner.onNotification.bind(inner);
    this.onProgress = inner.onProgress.bind(inner);
    this.sendProgress = inner.sendProgress.bind(inner);
    this.trace = inner.trace.bind(inner);
    this.hasPendingResponse = inner.hasPendingResponse.bind(inner);
    this.end = inner.end.bind(inner);
    this.inspect = inner.inspect.bind(inner);

    // Event 为可调用对象，直接赋值即可
    this.onUnhandledNotification = inner.onUnhandledNotification;
    this.onUnhandledProgress = inner.onUnhandledProgress;
    this.onError = inner.onError;
    this.onClose = inner.onClose;
    this.onDispose = inner.onDispose;
  }

  // ── Outer 连接事件监听 ────────────────────────────────────────────

  /**
   * 在底层 outer 连接上注册可靠的协议消息监听：
   * reliable/deliver、reliable/ack、reliable/sync、reliable/sync-response
   */
  private connectInnerAndOuter(): void {
    this.outer.onNotification(RELIABLE_DELIVER.method, (params: ReliableEnvelope) =>
      this.onReceive(params),
    );
    this.outer.onNotification(RELIABLE_ACK.method, (params: { upTo: number }) =>
      this.onAck(params.upTo),
    );
    this.outer.onNotification(RELIABLE_SYNC.method, (params: { lastRecvSeq: number }) =>
      this.onSyncRequest(params.lastRecvSeq),
    );
    this.outer.onNotification(
      RELIABLE_SYNC_RESPONSE.method,
      (params: { replay: ReliableEnvelope[]; gap?: boolean }) =>
        this.onSyncResponse(params),
    );
    const self = this
    this.readableForInnerMessageWriter.pipeTo(new WritableStream({
      write(msg: Message) {
        self.deliver(msg)
      }
    }))
  }

  // ── 发送方向：业务 → 可靠封装 → outer ──────────────────────────────

  /**
   * 被 inner Writer 调用：将业务消息包入可靠信封、缓冲、通过 outer 发送。
   */
  private deliver(msg: Message): void {
    const seq = ++this.sendSeq;
    const envelope: ReliableEnvelope = { seq, msg };

    // 缓冲，用于重连时的 sync 重放
    this.outboundBuffer.push(envelope);
    if (this.outboundBuffer.length > MAX_BUFFER_SIZE) {
      this.outboundBuffer.shift();
    }

    // 通过外层连接以 notification 形式发送
    this.outer.sendNotification(RELIABLE_DELIVER.method, envelope);
  }

  // ── 接收方向：outer → 可靠解封装 → 业务 ──────────────────────────

  /**
   * outer 收到 reliable/deliver → 去重、记录 seq、喂给 inner reader、发 ack。
   */
  private onReceive(envelope: ReliableEnvelope): void {
    const { seq, msg } = envelope;

    // 去重：仅对请求消息（带 method）按 id 去重，避免重连重放导致重复执行。
    // 响应消息与请求共用同一 id（JSON-RPC 语义），若一并去重会把响应误判为重复而丢弃。
    const { id } = msg as RequestMessage;
    const isRequest = (msg as RequestMessage).method !== undefined;
    if (id !== undefined && id !== null && isRequest) {
      if (this.seenRequestIds.has(id)) return;
      this.seenRequestIds.add(id);
      // 集合过大时淘汰一半旧条目
      if (this.seenRequestIds.size > MAX_SEEN_REQUESTS) {
        const entries = [...this.seenRequestIds];
        this.seenRequestIds = new Set(
          entries.slice(Math.floor(entries.length / 2)),
        );
      }
    }

    // 更新接收端序列号（可能乱序，取最大值）
    this.recvSeq = Math.max(this.recvSeq, seq);

    // 喂给内侧 reader → 触发业务 handler
    this.writerForInnerMessageReader.write(msg);

    // 每 ACK_INTERVAL 条消息发送一次累积确认
    if (seq % ACK_INTERVAL === 0) {
      this.sendAck();
    }
  }

  /**
   * 向对端发送累计确认，告知已收到的最大 seq。
   */
  private sendAck(): void {
    this.outer.sendNotification(RELIABLE_ACK.method, { upTo: this.recvSeq });
  }

  // ── Ack 处理 ───────────────────────────────────────────────────────

  /**
   * 收到对端的确认：从发送缓冲区中丢弃已被确认的消息。
   */
  private onAck(upTo: number): void {
    this.outboundBuffer = this.outboundBuffer.filter((e) => e.seq > upTo);
  }

  // ── Sync 协议（重连同步） ───────────────────────────────────────────

  /**
   * 收到对端的 sync 请求：从发送缓冲区中取出 lastRecvSeq 之后的消息，
   * 通过 reliable/sync-response 回放。
   */
  private onSyncRequest(lastRecvSeq: number): void {
    const bufferStart = this.outboundBuffer[0]?.seq ?? this.sendSeq + 1;
    const replay = this.outboundBuffer.filter((e) => e.seq > lastRecvSeq);
    // 如果对端最后收到的 seq 小于缓冲起始 seq，说明中间有消息丢失且不在缓冲中
    const gap = lastRecvSeq < bufferStart - 1;

    this.outer.sendNotification(RELIABLE_SYNC_RESPONSE.method, {
      replay,
      gap: gap || undefined,
    });
  }

  /**
   * 收到 sync 响应：处理对端回放的消息，如果有 gap 则通知上层。
   */
  private onSyncResponse(params: {
    replay: ReliableEnvelope[];
    gap?: boolean;
  }): void {
    if (params.gap) {
      this.onGap?.();
    }
    for (const envelope of params.replay) {
      this.onReceive(envelope);
    }
    this.sendAck();
  }

  /**
   * 向对端发送 sync 请求，携带本地已接收的最大 seq。
   */
  private sendSync(): void {
    this.outer.sendNotification(RELIABLE_SYNC.method, {
      lastRecvSeq: this.recvSeq,
    });
  }
}

// ── 兼容旧版 API ──────────────────────────────────────────────────────

/**
 * 在底层 MessageConnection 之上创建可靠传输连接。
 *
 * @deprecated 请直接使用 `new ReliableMessageConnection(outer, onGap)`
 */
export function createReliableMessageConnection(
  outer: MessageConnection,
  onGap?: () => void,
): ReliableMessageConnection {
  return new ReliableMessageConnection(outer, onGap);
}

/**
 * 重新绑定可靠连接到底层连接（用于重连场景）。
 *
 * @deprecated 请直接调用 `connection.rebind(newOuter)`
 */
export function rebindReliableConnection(
  connection: MessageConnection | ReliableMessageConnection,
  newOuter: MessageConnection,
): void {
  if (connection instanceof ReliableMessageConnection) {
    connection.rebind(newOuter);
    return;
  }
  throw new Error(
    "Not a ReliableMessageConnection instance. Use `new ReliableMessageConnection(outer)` to create one.",
  );
}
