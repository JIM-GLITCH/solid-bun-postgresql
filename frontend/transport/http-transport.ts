/**
 * HTTP 传输实现：Web 环境使用 fetch + EventSource
 */

import type { IApiTransport, ApiMethod, ApiRequestPayload, SSEMessage } from "../../shared/src";

const API_BASE = "";

export class HttpTransport implements IApiTransport {
  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M]
  ): Promise<unknown> {
    const path = `/api/${method}`;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
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
      throw new Error(data?.error || `请求失败: ${method}`);
    }

    return data;
  }

  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
    const url = `${API_BASE}/api/events?connectionSessionId=${encodeURIComponent(connectionId)}`;
    const eventSource = new EventSource(url);

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
