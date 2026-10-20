import { describe, expect, test } from "bun:test";
import { handleDbDisconnectBeacon } from "./api-handlers-http";

const URL_BASE = "http://127.0.0.1:3101/api/db/disconnect";

function makeReq(origin: string | null, referer: string | null, body = "{}"): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("origin", origin);
  if (referer) headers.set("referer", referer);
  return new Request(URL_BASE, { method: "POST", headers, body });
}

describe("handleDbDisconnectBeacon 同源校验", () => {
  test("拒绝跨站 Origin（防止冒充断开他人会话）", async () => {
    const res = await handleDbDisconnectBeacon(makeReq("https://evil.example", null));
    expect(res.status).toBe(403);
  });

  test("拒绝跨站 Referer", async () => {
    const res = await handleDbDisconnectBeacon(makeReq(null, "https://evil.example/page"));
    expect(res.status).toBe(403);
  });

  test("放行同源 Origin", async () => {
    // 同源但 body 缺少 connectionId → 400（不触及数据库）
    const res = await handleDbDisconnectBeacon(makeReq("http://127.0.0.1:3101", null));
    expect(res.status).toBe(400);
  });

  test("放行同源 Referer", async () => {
    const res = await handleDbDisconnectBeacon(makeReq(null, "http://127.0.0.1:3101/some/page"));
    expect(res.status).toBe(400);
  });

  test("无 Origin/Referer 时放行（部分原生客户端场景）", async () => {
    const res = await handleDbDisconnectBeacon(makeReq(null, null));
    expect(res.status).toBe(400);
  });
});
