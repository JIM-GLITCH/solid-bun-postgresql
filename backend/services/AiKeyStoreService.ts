import { Context, Effect } from "effect"
import type { StorageError } from "../core/errors"

export interface AiKeyStoreService {
  get(keyRef: string): Effect.Effect<string | null, StorageError>
  set(keyRef: string, apiKey: string): Effect.Effect<void, StorageError>
  delete(keyRef: string): Effect.Effect<void, StorageError>
}

export const AiKeyStoreService = Context.Service<AiKeyStoreService>("AiKeyStoreService")
