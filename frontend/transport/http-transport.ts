/**
 * HTTP 传输实现：Web 环境使用 fetch + EventSource
 */

import type { IApiTransport, ApiMethod, ApiRequestPayload, SSEMessage } from "../../shared/src";

const API_BASE = "";

export class HttpTransport implements IApiTransport {
  async request<M extends ApiMethod>(
    method: M,
    payload: ApiRequestPayload[M] & { sessionId: string }
  ): Promise<unknown> {
    const path = `/api/${method}`;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `请求失败: ${method}`);
    }

    if (data.error && !res.ok) {
      throw new Error(data.error);
    }

    return data;
  }

  subscribeEvents(sessionId: string, callback: (msg: SSEMessage) => void): () => void {
    const url = `${API_BASE}/api/events?sessionId=${sessionId}`;
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
