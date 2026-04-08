/**
 * HTTP 传输实现：Web 环境使用 fetch + EventSource
 */

import type { IApiTransport, ApiMethod, ApiRequestPayload, SSEMessage } from "../../shared/src";
import { formatUnknownError } from "../format-unknown-error";
import { SubscriptionRequiredError } from "../subscription/subscription-error";
import { raiseSubscriptionRequired } from "../subscription/subscription-prompt";

const API_BASE = "";

export type HttpTransportOptions = {
  /** 随请求发送 Authorization: Bearer（订阅校验在业务后端） */
  getBearerToken?: () => string | null;
};

export class HttpTransport implements IApiTransport {
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

  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
    const q = new URLSearchParams();
    q.set("connectionSessionId", connectionId);
    q.set("client", "web");
    const t = this.opts.getBearerToken?.() ?? null;
    if (t) q.set("access_token", t);
    const url = `${API_BASE}/api/events?${q.toString()}`;
    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onmessage = (event) => {
      try {
        const message: SSEMessage = JSON.parse(event.data);
        callback(message);
      } catch (e) {
        console.error("解析 SSE 消息失败:", e);
      }
    };

    return () => {
      eventSource.close();
    };
  }

}
