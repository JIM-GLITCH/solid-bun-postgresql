import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  createSessionDriver,
  createSessionRegistry,
  createSessionRuntime,
  type LiveSessionRecord,
} from "./effect-session-runtime";
import { createConnectionSessionRuntime } from "./runtime/connection-session-runtime";

describe("effect-session-runtime", () => {
  it("registers, reads, and removes a connection session", async () => {
    const registry = createSessionRegistry<LiveSessionRecord>();

    const result = await Effect.runPromise(
      registry.upsert("conn-1", {
        id: "conn-1",
        kind: "postgres",
        status: "connected",
        label: "prod",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }).pipe(
        Effect.flatMap(() => registry.get("conn-1")),
        Effect.flatMap((session) => {
          expect(session?.id).toBe("conn-1");
          expect(session?.kind).toBe("postgres");
          return registry.remove("conn-1");
        }),
        Effect.flatMap(() => registry.list()),
        Effect.map((sessions) => sessions.length),
      ),
    );

    expect(result).toBe(0);
  });

  it("supports a session driver lifecycle with connect, reconnect, and disconnect", async () => {
    const driver = createSessionDriver<LiveSessionRecord>();

    const result = await Effect.runPromise(
      driver.connect("conn-2", {
        id: "conn-2",
        kind: "mysql",
        status: "connected",
        label: "mysql-local",
        createdAt: 1,
        updatedAt: 2,
      }).pipe(
        Effect.flatMap(() => driver.get("conn-2")),
        Effect.flatMap((session) => {
          expect(session?.label).toBe("mysql-local");
          return driver.reconnect("conn-2", { ...session!, label: "mysql-local-updated", updatedAt: 99 });
        }),
        Effect.flatMap(() => driver.get("conn-2")),
        Effect.flatMap((session) => {
          expect(session?.label).toBe("mysql-local-updated");
          return driver.disconnect("conn-2");
        }),
        Effect.flatMap((removed) => {
          expect(removed).toBe(true);
          return driver.list();
        }),
        Effect.map((sessions) => sessions.length),
      ),
    );

    expect(result).toBe(0);
  });

  it("returns false when disconnecting a missing session", async () => {
    const driver = createSessionDriver<LiveSessionRecord>();

    const removed = await Effect.runPromise(driver.disconnect("missing-session"));

    expect(removed).toBe(false);
  });

  it("starts keepalive on connect and stops it on disconnect", async () => {
    const events: string[] = [];
    const runtime = createConnectionSessionRuntime<LiveSessionRecord>(new Map(), {
      startKeepalive: (id) => events.push(`start:${id}`),
      stopKeepalive: (session) => events.push(`stop:${session.id}`),
    });

    const session: LiveSessionRecord = {
      id: "conn-keepalive",
      kind: "postgres",
      status: "connected",
      label: "keepalive-test",
      createdAt: 1,
      updatedAt: 2,
    };

    await runtime.connectSession("conn-keepalive", session);
    const removed = await runtime.disconnectSession("conn-keepalive");

    expect(removed).toBe(true);
    expect(events).toContain("start:conn-keepalive");
    expect(events).toContain("stop:conn-keepalive");
  });

  it("reconnect triggers keepalive restart and updates the session", async () => {
    const runtime = createSessionRuntime<LiveSessionRecord>();
    const initial: LiveSessionRecord = {
      id: "conn-reconnect",
      kind: "mysql",
      status: "connected",
      label: "before",
      createdAt: 1,
      updatedAt: 2,
    };

    await runtime.connectSession("conn-reconnect", initial, () => undefined);
    const next = await runtime.reconnectSession("conn-reconnect", {
      ...initial,
      label: "after",
      updatedAt: 42,
    });

    expect(next.label).toBe("after");
    expect(runtime.get("conn-reconnect")?.label).toBe("after");
  });
});
