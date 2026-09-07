import { Effect, Ref, Scope } from "effect";

export type SessionKind = "postgres" | "mysql" | "mariadb" | "sqlserver";
export type SessionStatus = "connecting" | "connected" | "disconnecting" | "disconnected";

export interface LiveSessionRecord {
  id: string;
  kind: SessionKind;
  status: SessionStatus;
  label: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface SessionRegistry<T> {
  get: (id: string) => Effect.Effect<T | undefined>;
  upsert: (id: string, value: T) => Effect.Effect<T>;
  remove: (id: string) => Effect.Effect<boolean>;
  list: () => Effect.Effect<T[]>;
  clear: () => Effect.Effect<void>;
}

export interface SessionDriverState<T> {
  registry: SessionRegistry<T>;
  get: (id: string) => Effect.Effect<T | undefined>;
  connect: (id: string, value: T) => Effect.Effect<T>;
  disconnect: (id: string) => Effect.Effect<boolean>;
  reconnect: (id: string, value: T) => Effect.Effect<T>;
  list: () => Effect.Effect<T[]>;
  register: (id: string, value: T) => Effect.Effect<T>;
  unregister: (id: string) => Effect.Effect<boolean>;
}

export type SessionRuntimeHooks<T> = {
  startKeepalive?: (id: string) => void;
  stopKeepalive?: (session: T) => void;
};

export interface SessionRuntime<T> {
  driver: SessionDriverState<T>;
  registry: SessionRegistry<T>;
  register: (id: string, value: T) => void;
  unregister: (id: string) => void;
  get: (id: string) => T | undefined;
  list: () => T[];
  connectSession: (id: string, value: T, onConnect?: (value: T) => void | Promise<void>) => Promise<T>;
  disconnectSession: (id: string, onDisconnect?: (value: T) => void | Promise<void>) => Promise<boolean>;
  reconnectSession: (
    id: string,
    next: T | ((current: T) => T | Promise<T>),
    onReconnect?: (value: T) => void | Promise<void>,
  ) => Promise<T>;
  withSessionScope: <A, E>(
    id: string,
    use: (session: T) => Effect.Effect<A, E>,
    release?: (session: T) => Effect.Effect<void, E>,
  ) => Effect.Effect<A, E, Scope.Scope>;
  startKeepalive: (id: string) => void;
  stopKeepalive: (value: T) => void;
  recreateUserUsedClient: (id: string) => Promise<void>;
  recreateMysqlUserUsedClient: (id: string) => Promise<void>;
  recreateSqlServerPool: (id: string) => Promise<void>;
}

export const createSessionRegistry = <T>(initial = new Map<string, T>()): SessionRegistry<T> => {
  const sessionRef = Ref.makeUnsafe<Map<string, T>>(initial);

  return {
    get: (id: string): Effect.Effect<T | undefined> =>
      Ref.get(sessionRef).pipe(Effect.map((map) => map.get(id))),

    upsert: (id: string, value: T): Effect.Effect<T> =>
      Ref.update(sessionRef, (map: Map<string, T>) => {
        map.set(id, value);
        return map;
      }).pipe(
        Effect.flatMap(() => Ref.get(sessionRef)),
        Effect.map((map) => map.get(id) as T),
      ),

    remove: (id: string): Effect.Effect<boolean> =>
      Ref.get(sessionRef).pipe(
        Effect.flatMap((map) => {
          const existed = map.has(id);
          if (!existed) return Effect.succeed(false);
          return Ref.update(sessionRef, (next: Map<string, T>) => {
            next.delete(id);
            return next;
          }).pipe(Effect.as(true));
        }),
      ),

    list: (): Effect.Effect<T[]> =>
      Ref.get(sessionRef).pipe(Effect.map((map) => Array.from(map.values()))),

    clear: (): Effect.Effect<void> =>
      Ref.update(sessionRef, (map: Map<string, T>) => {
        map.clear();
        return map;
      }).pipe(Effect.asVoid),
  };
};

export const defaultSessionRegistry = createSessionRegistry<LiveSessionRecord>();

export const createSessionDriver = <T>(initial = new Map<string, T>()): SessionDriverState<T> => {
  const registry = createSessionRegistry<T>(initial);
  return {
    registry,
    get: (id: string) => registry.get(id),
    connect: (id: string, value: T) => registry.upsert(id, value),
    disconnect: (id: string) => registry.remove(id),
    reconnect: (id: string, value: T) => registry.upsert(id, value),
    list: () => registry.list(),
    register: (id: string, value: T) => registry.upsert(id, value),
    unregister: (id: string) => registry.remove(id),
  };
};

export function sessionDriverFromMap<T>(map: Map<string, T>): SessionDriverState<T> {
  return createSessionDriver<T>(map);
}

export function createSessionRuntime<T>(
  initial = new Map<string, T>(),
  hooks: SessionRuntimeHooks<T> = {},
): SessionRuntime<T> {
  const driver = createSessionDriver<T>(initial);
  const startKeepalive = (id: string) => hooks.startKeepalive?.(id);
  const stopKeepalive = (session: T) => hooks.stopKeepalive?.(session);

  return {
    driver,
    registry: driver.registry,
    register: (id: string, value: T) => {
      Effect.runSync(driver.connect(id, value));
      startKeepalive(id);
    },
    unregister: (id: string) => {
      const current = Effect.runSync(driver.get(id));
      if (current != null) stopKeepalive(current);
      Effect.runSync(driver.disconnect(id));
    },
    get: (id: string) => Effect.runSync(driver.get(id)),
    list: () => Effect.runSync(driver.list()),
    connectSession: async (id: string, value: T, onConnect?: (value: T) => void | Promise<void>) => {
      const next = await Effect.runPromise(driver.connect(id, value));
      startKeepalive(id);
      await onConnect?.(next);
      return next;
    },
    disconnectSession: async (id: string, onDisconnect?: (value: T) => void | Promise<void>) => {
      const current = await Effect.runPromise(driver.get(id));
      if (current == null) return false;
      await onDisconnect?.(current);
      stopKeepalive(current);
      return await Effect.runPromise(driver.disconnect(id));
    },
    reconnectSession: async (
      id: string,
      next: T | ((current: T) => T | Promise<T>),
      onReconnect?: (value: T) => void | Promise<void>,
    ) => {
      const current = await Effect.runPromise(driver.get(id));
      if (current == null) {
        const factory = next as ((current: T) => T | Promise<T>) | undefined;
        const replacement = typeof next === "function" ? await factory!(current as T) : next;
        const result = await Effect.runPromise(driver.connect(id, replacement));
        startKeepalive(id);
        await onReconnect?.(result);
        return result;
      }
      const factory = next as ((current: T) => T | Promise<T>) | undefined;
      const replacement = typeof next === "function" ? await factory!(current) : next;
      const result = await Effect.runPromise(driver.reconnect(id, replacement));
      startKeepalive(id);
      await onReconnect?.(result);
      return result;
    },
    withSessionScope: <A, E>(id: string, use: (session: T) => Effect.Effect<A, E>, release?: (session: T) => Effect.Effect<void, E>) =>
      Effect.gen(function* () {
        const current = yield* driver.get(id);
        if (current == null) {
          return yield* Effect.fail(new Error("未找到数据库连接，请先连接数据库") as unknown as E);
        }
        return yield* Effect.acquireRelease(
          Effect.succeed(current),
          (session) => release ? release(session).pipe(Effect.catch(() => Effect.void)) : Effect.void,
        ).pipe(Effect.flatMap((session) => use(session)));
      }),
    startKeepalive,
    stopKeepalive,
    recreateUserUsedClient: async () => {
      /* no-op default */
    },
    recreateMysqlUserUsedClient: async () => {
      /* no-op default */
    },
    recreateSqlServerPool: async () => {
      /* no-op default */
    },
  };
}

export const registerSession = (
  session: Omit<LiveSessionRecord, "createdAt" | "updatedAt">,
): Effect.Effect<LiveSessionRecord> =>
  defaultSessionRegistry.upsert(session.id, {
    ...session,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

export const getSession = (id: string): Effect.Effect<LiveSessionRecord | undefined> =>
  defaultSessionRegistry.get(id);

export const removeSession = (id: string): Effect.Effect<boolean> =>
  defaultSessionRegistry.remove(id);

export const listSessions = (): Effect.Effect<LiveSessionRecord[]> =>
  defaultSessionRegistry.list();

export const clearSessions = (): Effect.Effect<void> =>
  defaultSessionRegistry.clear();

export function sessionRegistryFromMap<T>(map: Map<string, T>): SessionRegistry<T> {
  return createSessionRegistry<T>(map);
}
