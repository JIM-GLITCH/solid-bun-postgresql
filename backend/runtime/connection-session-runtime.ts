import { createSessionRuntime, type SessionRuntime } from "../effect-session-runtime";

export type SessionRuntimeHooks<T> = {
  startKeepalive?: (id: string) => void;
  stopKeepalive?: (session: T) => void;
  recreateUserUsedClient?: (id: string) => Promise<void>;
  recreateMysqlUserUsedClient?: (id: string) => Promise<void>;
  recreateSqlServerPool?: (id: string) => Promise<void>;
};

export function createConnectionSessionRuntime<T>(
  initial: Map<string, T> = new Map<string, T>(),
  hooks: SessionRuntimeHooks<T> = {},
): SessionRuntime<T> {
  const base = createSessionRuntime<T>(initial, hooks);
  return {
    ...base,
    startKeepalive: hooks.startKeepalive ?? base.startKeepalive,
    stopKeepalive: hooks.stopKeepalive ?? base.stopKeepalive,
    recreateUserUsedClient: hooks.recreateUserUsedClient ?? base.recreateUserUsedClient,
    recreateMysqlUserUsedClient: hooks.recreateMysqlUserUsedClient ?? base.recreateMysqlUserUsedClient,
    recreateSqlServerPool: hooks.recreateSqlServerPool ?? base.recreateSqlServerPool,
  } as SessionRuntime<T>;
}

export default createConnectionSessionRuntime;
