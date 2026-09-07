type Ss = SessionStore | ConnectionId;

import { SessionNotFoundError } from "../../../core/errors"
import { Effect } from "effect"
import { ConnectionId, SessionStore, currentSqlServerSession } from "../../../services/SessionStore"
import {
  sqlServerFetchSessionMonitor,
  sqlServerGetOwnSpid,
  sqlServerSessionControl,
} from "../../../sqlserver-support"

/**
 * db/session-monitor：连接统计 + 锁等待 + 慢查询。
 * 返回结构与前端契约一致（直接透传 sqlServerFetchSessionMonitor 的结果）。
 */
export const handleSqlServerSessionMonitor = (
  limit: number = 20,
): Effect.Effect<
  Awaited<ReturnType<typeof sqlServerFetchSessionMonitor>>,
  SessionNotFoundError | Error,
  Ss
> =>
  Effect.gen(function* () {
    const session = yield* currentSqlServerSession;

    return yield* Effect.tryPromise({
      try: () => sqlServerFetchSessionMonitor(session.backGroundPool, limit),
      catch: (e) => new Error(`session-monitor: ${(e as Error)?.message ?? String(e)}`),
    });
  });

/**
 * db/session-control：cancel / terminate 指定会话。
 * 禁止操作当前监控连接自身会话；返回 `{ success, pid, action }`。
 */
export const handleSqlServerSessionControl = (
  pid: number,
  action: "cancel" | "terminate",
): Effect.Effect<
  { success: boolean; pid: number; action: "cancel" | "terminate" },
  SessionNotFoundError | Error,
  Ss
> =>
  Effect.gen(function* () {
    const session = yield* currentSqlServerSession;

    const self = yield* Effect.tryPromise({
      try: () => sqlServerGetOwnSpid(session.backGroundPool),
      catch: (e) => new Error(`session-control: ${(e as Error)?.message ?? String(e)}`),
    });
    if (pid === self) {
      return yield* Effect.fail(new Error("不允许操作当前监控连接自身会话"));
    }

    const ok = yield* Effect.tryPromise({
      try: () => sqlServerSessionControl(session.backGroundPool, pid, action),
      catch: (e) => new Error(`session-control: ${(e as Error)?.message ?? String(e)}`),
    });

    return { success: ok, pid, action };
  });
