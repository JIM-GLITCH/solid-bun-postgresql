/**
 * 后端 stdio 模式：通过 stdin 接收 JSON 行请求，stdout 输出 JSON 行响应/事件
 * 供 Tauri sidecar 以 pipe 方式通信使用（非命令行调用）
 */

import type { ApiMethod, ApiRequestPayload } from "../shared/src";
import {
  handleApiRequest,
  getSession,
  subscribeSessionEvents,
  type SSEMessage,
} from "../backend/api-core";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function writeOut(obj: object) {
  const line = JSON.stringify(obj) + "\n";
  process.stdout.write(encoder.encode(line));
}

const eventUnsubscribes = new Map<string, () => void>();

function subscribeEvents(sessionId: string) {
  if (eventUnsubscribes.has(sessionId)) return;
  const session = getSession(sessionId);
  if (!session) {
    writeOut({ type: "event", sessionId, error: "未找到数据库连接" });
    return;
  }
  const unsub = subscribeSessionEvents(sessionId, (msg: SSEMessage) => {
    writeOut({ type: "event", sessionId, data: msg });
  });
  eventUnsubscribes.set(sessionId, unsub);
}

function unsubscribeEvents(sessionId: string) {
  const unsub = eventUnsubscribes.get(sessionId);
  if (unsub) {
    unsub();
    eventUnsubscribes.delete(sessionId);
  }
}

async function handleLine(line: string) {
  let msg: { id: number; method: string; payload?: unknown };
  try {
    msg = JSON.parse(line) as { id: number; method: string; payload?: unknown };
  } catch {
    writeOut({ type: "error", message: "Invalid JSON" });
    return;
  }

  const { id, method, payload } = msg;
  if (typeof id !== "number" || typeof method !== "string") {
    writeOut({ id: id ?? -1, error: "Missing id or method" });
    return;
  }

  if (method === "subscribe-events") {
    const sessionId = (payload as { sessionId?: string })?.sessionId;
    if (!sessionId) {
      writeOut({ id, error: "subscribe-events requires sessionId" });
      return;
    }
    subscribeEvents(sessionId);
    writeOut({ id, result: { ok: true } });
    return;
  }

  if (method === "unsubscribe-events") {
    const sessionId = (payload as { sessionId?: string })?.sessionId;
    if (sessionId) unsubscribeEvents(sessionId);
    writeOut({ id, result: { ok: true } });
    return;
  }

  try {
    const result = await handleApiRequest(
      method as ApiMethod,
      (payload ?? {}) as ApiRequestPayload[ApiMethod] & { sessionId: string }
    );
    writeOut({ id, result });
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    writeOut({ id, error });
  }
}

async function main() {
  let buf = "";
  const stdin = process.stdin;
  stdin.setEncoding("utf8");
  stdin.on("data", (chunk: string | Buffer) => {
    const s = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    buf += s;
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) handleLine(line).catch((e) => writeOut({ type: "error", message: String(e) }));
    }
  });
  stdin.on("end", () => process.exit(0));
}

main();
