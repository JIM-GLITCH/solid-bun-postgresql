import { Context, Effect } from "effect"
import type { StoredConnectionParams } from "../../shared/src"
import type { StorageError } from "../core/errors"

export interface ConnectionMeta {
  id: string
  label?: string
  name?: string
  group?: string
  lastConnectedAt?: number
  createdAt: number
  updatedAt: number
}

export interface ConnectionEntry {
  id: string
  label: string
  name?: string
  group?: string
  createdAt: number
  updatedAt: number
}

export interface ConnectionStoreService {
  list(): Effect.Effect<ConnectionEntry[], StorageError>
  save(id: string, params: StoredConnectionParams, meta: { name?: string; group?: string }): Effect.Effect<void, StorageError>
  get(id: string): Effect.Effect<ConnectionEntry | null, StorageError>
  getParams(id: string): Effect.Effect<(StoredConnectionParams & { id: string }) | null, StorageError>
  remove(id: string): Effect.Effect<void, StorageError>
  updateMeta(id: string, meta: { name?: string }): Effect.Effect<void, StorageError>
  reorder(list: unknown[]): Effect.Effect<void, StorageError>
}

export const ConnectionStoreService = Context.Service<ConnectionStoreService>("ConnectionStoreService")
