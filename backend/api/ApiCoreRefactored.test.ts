import { describe, expect, it } from "vitest"
import { Effect } from "effect"
import { routeApiRequest } from "./ApiCoreRefactored"
import { ConnectionStoreService } from "../services/ConnectionStoreService"
import { SessionStore } from "../services/SessionStore"
import { DatabaseService } from "./routes/db"

const fakeConnectionStore = {
  list: () => Effect.succeed([]),
  save: () => Effect.void,
  get: () => Effect.succeed(null),
  getParams: () => Effect.succeed({
    id: "conn-1",
    dbType: "postgres",
    host: "127.0.0.1",
    port: "5432",
    database: "postgres",
    username: "postgres",
    password: "wrong-password",
    sshEnabled: false,
  }),
  remove: () => Effect.void,
  updateMeta: () => Effect.void,
  reorder: () => Effect.void,
} as any

describe("routeApiRequest connections/connect", () => {
  it("does not lose DatabaseService when delegating to db/connect", async () => {
    const effect = routeApiRequest("connections/connect", {
      id: "conn-1",
      sessionId: "session-1",
    }).pipe(
      Effect.provideService(ConnectionStoreService, fakeConnectionStore),
    )

    await expect(Effect.runPromise(effect)).rejects.toThrow()
    await expect(Effect.runPromise(effect)).rejects.not.toThrow(/Service not found: DatabaseService/)
  })

  it("routes db/schemas through DatabaseService", async () => {
    const fakeSession = {
      dbKind: "postgres",
      backGroundPool: {
        query: async () => ({ rows: [{ schema_name: "public" }, { schema_name: "sales" }] }),
      },
    } as any

    const fakeSessionStore = {
      get: () => Effect.succeed(fakeSession),
      register: () => Effect.void,
      unregister: () => Effect.void,
      list: () => Effect.succeed([]),
    } as any

    const result = await Effect.runPromise(
      routeApiRequest("db/schemas", { connectionId: "c1", dbType: "postgres" }).pipe(
        Effect.provideService(SessionStore, fakeSessionStore),
      )
    )

    expect(result).toEqual({ schemas: ["public", "sales"] })
  })
})
