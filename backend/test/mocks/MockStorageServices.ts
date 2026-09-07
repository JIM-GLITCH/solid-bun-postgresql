/**
 * Mock Storage Services for testing
 * 匹配真实的 ConnectionStoreService / QueryHistoryService / AiKeyStoreService 接口。
 */

import { Effect, Layer } from "effect"
import { ConnectionStoreService } from "../../services/ConnectionStoreService"
import type { ConnectionEntry } from "../../services/ConnectionStoreService"
import { QueryHistoryService } from "../../services/QueryHistoryService"
import type { QueryHistoryEntry, QueryHistorySearchParams } from "../../services/QueryHistoryService"
import { AiKeyStoreService } from "../../services/AiKeyStoreService"
import type { StorageError } from "../../core/errors"
import type { StoredConnectionParams } from "../../../shared/src"

interface StoredConnection {
  id: string
  params: StoredConnectionParams
  meta: { name?: string; group?: string }
  createdAt: number
  updatedAt: number
}

class MockConnectionStoreService implements ConnectionStoreService {
  private connections = new Map<string, StoredConnection>()

  list = (): Effect.Effect<ConnectionEntry[], StorageError> => {
    const self = this
    return Effect.sync(() =>
      Array.from(self.connections.values()).map((c) => ({
        id: c.id,
        label: c.meta.name ?? c.id,
        name: c.meta.name,
        group: c.meta.group,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
    )
  }

  save = (
    id: string,
    params: StoredConnectionParams,
    meta: { name?: string; group?: string },
  ): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.sync(() => {
      const now = Date.now()
      const existing = self.connections.get(id)
      self.connections.set(id, {
        id,
        params,
        meta,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      })
    })
  }

  get = (id: string): Effect.Effect<ConnectionEntry | null, StorageError> => {
    const self = this
    return Effect.sync(() => {
      const c = self.connections.get(id)
      if (!c) return null
      return {
        id: c.id,
        label: c.meta.name ?? c.id,
        name: c.meta.name,
        group: c.meta.group,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      }
    })
  }

  getParams = (
    id: string,
  ): Effect.Effect<(StoredConnectionParams & { id: string }) | null, StorageError> => {
    const self = this
    return Effect.sync(() => {
      const c = self.connections.get(id)
      return c ? { ...c.params, id } : null
    })
  }

  remove = (id: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.sync(() => {
      self.connections.delete(id)
    })
  }

  updateMeta = (id: string, meta: { name?: string }): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.sync(() => {
      const c = self.connections.get(id)
      if (c) {
        c.meta = { ...c.meta, ...meta }
        c.updatedAt = Date.now()
      }
    })
  }

  reorder = (list: unknown[]): Effect.Effect<void, StorageError> =>
    Effect.sync(() => {
      void list
    })
}

class MockQueryHistoryService implements QueryHistoryService {
  private history: QueryHistoryEntry[] = []

  add = (entry: {
    sql: string
    connectionId?: string
    durationMs?: number
    rowCount?: number
    error?: string
    timestamp?: number
  }): Effect.Effect<QueryHistoryEntry, StorageError> => {
    const self = this
    return Effect.sync(() => {
      const record: QueryHistoryEntry = {
        id: `history-${Date.now()}-${Math.random()}`,
        connectionId: entry.connectionId ?? "",
        sql: entry.sql,
        timestamp: entry.timestamp ?? Date.now(),
        durationMs: entry.durationMs,
        rowCount: entry.rowCount,
        error: entry.error,
      }
      self.history.unshift(record)
      return record
    })
  }

  search = (
    params?: QueryHistorySearchParams,
  ): Effect.Effect<QueryHistoryEntry[], StorageError> => {
    const self = this
    return Effect.sync(() => {
      let results = [...self.history]
      if (params?.keyword) {
        const kw = params.keyword.toLowerCase()
        results = results.filter((e) => e.sql.toLowerCase().includes(kw))
      }
      if (params?.since) results = results.filter((e) => e.timestamp >= params.since!)
      if (params?.until) results = results.filter((e) => e.timestamp <= params.until!)
      return results
    })
  }

  delete = (id: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.sync(() => {
      self.history = self.history.filter((e) => e.id !== id)
    })
  }

  clear = (): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.sync(() => {
      self.history = []
    })
  }
}

class MockAiKeyStoreService implements AiKeyStoreService {
  private keys = new Map<string, string>()

  get = (keyRef: string): Effect.Effect<string | null, StorageError> => {
    const self = this
    return Effect.sync(() => self.keys.get(keyRef) ?? null)
  }

  set = (keyRef: string, apiKey: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.sync(() => {
      self.keys.set(keyRef, apiKey)
    })
  }

  delete = (keyRef: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.sync(() => {
      self.keys.delete(keyRef)
    })
  }
}

export const MockConnectionStoreServiceLayer = Layer.succeed(
  ConnectionStoreService,
  new MockConnectionStoreService(),
)

export const MockQueryHistoryServiceLayer = Layer.succeed(
  QueryHistoryService,
  new MockQueryHistoryService(),
)

export const MockAiKeyStoreServiceLayer = Layer.succeed(
  AiKeyStoreService,
  new MockAiKeyStoreService(),
)

export const MockStorageServicesLayer = Layer.mergeAll(
  MockConnectionStoreServiceLayer,
  MockQueryHistoryServiceLayer,
  MockAiKeyStoreServiceLayer,
)
