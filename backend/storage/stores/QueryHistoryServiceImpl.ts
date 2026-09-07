import { Effect, Layer } from "effect"
import * as NodePath from "node:path"
import type { QueryHistoryEntry, QueryHistorySearchParams } from "../../services/QueryHistoryService"
import { QueryHistoryService } from "../../services/QueryHistoryService"
import { StorageError, makeErrorContext } from "../../core/errors"
import * as FileStorage from "../FileStorage"

const MAX_ENTRIES = 500

interface StoredEntry {
  id: string
  sql: string
  timestamp: number
  connectionId: string
  durationMs?: number
  rowCount?: number
  error?: string
}

class QueryHistoryServiceImpl implements QueryHistoryService {
  private getBaseDir(): string {
    return (
      process.env.CONNECTIONS_STORE_DIR ||
      (typeof process !== "undefined" && (process as any).platform === "win32"
        ? NodePath.join(
            process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd(),
            "db-client"
          )
        : NodePath.join(process.env.HOME || "/tmp", ".db-client"))
    )
  }

  private getStorePath(): string {
    return NodePath.join(this.getBaseDir(), "query-history.json")
  }

  private loadRaw = (): Effect.Effect<StoredEntry[], StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const path = self.getStorePath()
      const exists = yield* FileStorage.fileExists(path)
      if (!exists) return [] as StoredEntry[]
      const content = yield* FileStorage.readFile(path)
      const arr = JSON.parse(content)
      return Array.isArray(arr) ? (arr as StoredEntry[]) : [] as StoredEntry[]
    })
  }

  private saveRaw = (list: StoredEntry[]): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const path = self.getStorePath()
      yield* FileStorage.writeFile(path, JSON.stringify(list, null, 2), { mode: 0o600 })
    })
  }

  add = (entry: { sql: string; connectionId?: string; durationMs?: number; rowCount?: number; error?: string; timestamp?: number }): Effect.Effect<QueryHistoryEntry, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const trimmed = entry.sql.trim()
      if (!trimmed) {
        return yield* Effect.fail(
          new StorageError({
            context: makeErrorContext("add"),
            filePath: self.getStorePath(),
            operation: "write"
          })
        )
      }
      const connectionId = entry.connectionId ?? ""
      let entries = yield* self.loadRaw()

      const newEntry: QueryHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        sql: trimmed,
        connectionId,
        timestamp: entry.timestamp ?? Date.now(),
        durationMs: entry.durationMs,
        rowCount: entry.rowCount,
        error: entry.error,
      }

      if (entries.length > 0 && entries[0].sql === trimmed && entries[0].connectionId === connectionId) {
        const merged: StoredEntry = {
          ...entries[0],
          timestamp: newEntry.timestamp,
          durationMs: entry.durationMs ?? entries[0].durationMs,
          rowCount: entry.rowCount ?? entries[0].rowCount,
          error: entry.error ?? entries[0].error
        }
        entries = [merged, ...entries.slice(1)].slice(0, MAX_ENTRIES)
      } else {
        entries = [newEntry as StoredEntry, ...entries].slice(0, MAX_ENTRIES)
      }

      yield* self.saveRaw(entries)
      return newEntry
    })
  }

  search = (params?: QueryHistorySearchParams): Effect.Effect<QueryHistoryEntry[], StorageError> => {
    const self = this
    return Effect.gen(function* () {
      let entries = yield* self.loadRaw()

      if (params?.keyword?.trim()) {
        const kw = params.keyword.trim().toLowerCase()
        entries = entries.filter((e: StoredEntry) => e.sql.toLowerCase().includes(kw))
      }

      if (params?.since != null) {
        entries = entries.filter((e: StoredEntry) => e.timestamp >= params.since!)
      }

      if (params?.until != null) {
        entries = entries.filter((e: StoredEntry) => e.timestamp <= params.until!)
      }

      return entries as QueryHistoryEntry[]
    })
  }

  delete = (id: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const entries = (yield* self.loadRaw()).filter((e: StoredEntry) => e.id !== id)
      yield* self.saveRaw(entries)
    })
  }

  clear = (): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      yield* self.saveRaw([])
    })
  }
}

export const QueryHistoryServiceLive = Layer.succeed(
  QueryHistoryService,
  new QueryHistoryServiceImpl()
)
