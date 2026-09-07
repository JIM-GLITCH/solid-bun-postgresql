/**
 * Effect-based file storage operations
 * Provides type-safe file I/O with proper error handling
 */

import { Effect } from "effect"
import * as NodeFS from "node:fs"
import * as NodePath from "node:path"
import { StorageError, makeErrorContext } from "../core/errors"

type StorageOperation = "read" | "write" | "delete"

const makeStorageError = (operation: StorageOperation, filePath: string): StorageError =>
  new StorageError({
    context: makeErrorContext(operation),
    filePath,
    operation,
  })

/**
 * Read file content as string
 */
export const readFile = (path: string): Effect.Effect<string, StorageError> =>
  Effect.tryPromise({
    try: () => NodeFS.promises.readFile(path, "utf-8"),
    catch: () => makeStorageError("read", path)
  })

/**
 * Write content to file atomically
 */
export const writeFile = (
  path: string,
  content: string,
  options?: { mode?: number }
): Effect.Effect<void, StorageError> =>
  Effect.tryPromise({
    try: async () => {
      const dir = NodePath.dirname(path)
      await NodeFS.promises.mkdir(dir, { recursive: true })
      await NodeFS.promises.writeFile(path, content, {
        mode: options?.mode || 0o600,
        encoding: "utf-8"
      })
    },
    catch: () => makeStorageError("write", path)
  })

/**
 * Check if file exists
 */
export const fileExists = (path: string): Effect.Effect<boolean, StorageError> =>
  Effect.tryPromise({
    try: () =>
      NodeFS.promises.access(path).then(
        () => true,
        () => false
      ),
    catch: () => makeStorageError("read", path)
  })

/**
 * Delete file
 */
export const deleteFile = (path: string): Effect.Effect<void, StorageError> =>
  Effect.tryPromise({
    try: () => NodeFS.promises.unlink(path),
    catch: () => makeStorageError("delete", path)
  })

/**
 * Ensure directory exists
 */
export const ensureDir = (path: string): Effect.Effect<void, StorageError> =>
  Effect.tryPromise({
    try: () => NodeFS.promises.mkdir(path, { recursive: true }),
    catch: () => makeStorageError("write", path)
  })
