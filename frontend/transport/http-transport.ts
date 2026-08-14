/**
 * HTTP 传输实现：Web 环境使用 fetch + EventSource
 */

import type {
  IApiTransport,
  ApiMethod,
  ApiRequestPayload,
  SSEMessage,
  ServerPushMessage,
  TransportOnSubscribe,
} from "../../shared/src";
import { formatUnknownError } from "../format-unknown-error";
import { SubscriptionRequiredError } from "../subscription/subscription-error";
import { raiseSubscriptionRequired } from "../subscription/subscription-prompt";

const API_BASE = "";

export type HttpTransportOptions = {
  /** 随请求发送 Authorization: Bearer（订阅校验在业务后端） */
  getBearerToken?: () => string | null;
};

export class HttpTransport implements IApiTransport {
  private readonly serverPushListeners = new Set<(msg: ServerPushMessage) => void>();
  private readonly connectionStreams = new Map<string, { source: EventSource; refs: number }>();

  constructor(private readonly opts: HttpTransportOptions = {}) {}

  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown> {
    const path = `/api/${method}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-dbplayer-client": "web",
    };
    const token = this.opts.getBearerToken?.() ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        credentials: "include",
      });
    } catch (e) {
      const isNet =
        e instanceof TypeError &&
        (e.message === "Failed to fetch" || e.message.includes("fetch"));
      throw new Error(
        isNet
          ? `网络请求失败（${method}）：无法连接 API。请确认后端已启动（如 127.0.0.1:3101），且开发服务器已将 /api 代理到该地址。`
          : e instanceof Error
            ? e.message
            : String(e)
      );
    }
    const raw = await res.text();
    let data: any;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      const preview = raw.slice(0, 180).replace(/\s+/g, " ").trim();
      throw new Error(
        `接口返回非 JSON（${res.status} ${res.statusText}）：${method}${preview ? ` | ${preview}` : ""}`
      );
    }

    if (!res.ok) {
      if (res.status === 403 && data?.subscriptionRequired) {
        const msg = formatUnknownError(data?.error, "");
        const err = new SubscriptionRequiredError(msg || undefined);
        raiseSubscriptionRequired(err.message);
        throw err;
      }
      throw new Error(formatUnknownError(data?.error, `请求失败: ${method}`));
    }

    return data;
  }

  on(sub: TransportOnSubscribe): () => void {
    switch (sub.event) {
      case "push":
        this.serverPushListeners.add(sub.handler);
        return () => this.serverPushListeners.delete(sub.handler);
      case "account": {
        const wrapped = (msg: ServerPushMessage) => {
          if (msg.topic === "account") sub.handler(msg.account);
        };
        this.serverPushListeners.add(wrapped);
        return () => this.serverPushListeners.delete(wrapped);
      }
      case "connection": {
        const { connectionId } = sub;
        const wrapped = (msg: ServerPushMessage) => {
          if (msg.topic !== "connection-event" || msg.connectionId !== connectionId) return;
          sub.handler(msg.event);
        };
        this.serverPushListeners.add(wrapped);
        this.ensureConnectionStream(connectionId);
        return () => {
          this.serverPushListeners.delete(wrapped);
          this.releaseConnectionStream(connectionId);
        };
      }
    }
  }

  private emitServerPush(msg: ServerPushMessage): void {
    for (const listener of this.serverPushListeners) listener(msg);
  }

  private ensureConnectionStream(connectionId: string): void {
    const existing = this.connectionStreams.get(connectionId);
    if (existing) {
      existing.refs += 1;
      return;
    }
    const q = new URLSearchParams();
    q.set("connectionSessionId", connectionId);
    q.set("client", "web");
    const t = this.opts.getBearerToken?.() ?? null;
    if (t) q.set("access_token", t);
    const url = `${API_BASE}/api/events?${q.toString()}`;
    const source = new EventSource(url, { withCredentials: true });

    source.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);
        this.emitServerPush({ topic: "connection-event", connectionId, event: message });
      } catch (e) {
        console.error("解析 SSE 消息失败:", e);
      }
    };
    this.connectionStreams.set(connectionId, { source, refs: 1 });
  }

  private releaseConnectionStream(connectionId: string): void {
    const existing = this.connectionStreams.get(connectionId);
    if (!existing) return;
    existing.refs -= 1;
    if (existing.refs <= 0) {
      existing.source.close();
      this.connectionStreams.delete(connectionId);
    }
  }
}
