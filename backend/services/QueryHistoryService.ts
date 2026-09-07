import { Context, Effect } from "effect"
import type { StorageError } from "../core/errors"

export interface QueryHistoryEntry {
  id: string
  connectionId: string
  sql: string
  timestamp: number
  durationMs?: number
  rowCount?: number
  error?: string
}

export interface QueryHistorySearchParams {
  keyword?: string
  since?: number
  until?: number
}

export interface QueryHistoryService {
  add(entry: { sql: string; connectionId?: string; durationMs?: number; rowCount?: number; error?: string; timestamp?: number }): Effect.Effect<QueryHistoryEntry, StorageError>
  search(params?: QueryHistorySearchParams): Effect.Effect<QueryHistoryEntry[], StorageError>
  delete(id: string): Effect.Effect<void, StorageError>
  clear(): Effect.Effect<void, StorageError>
}

export const QueryHistoryService = Context.Service<QueryHistoryService>("QueryHistoryService")
