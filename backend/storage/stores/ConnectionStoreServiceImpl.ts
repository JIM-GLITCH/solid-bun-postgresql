import { Effect, Layer } from "effect"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import * as NodePath from "node:path"
import type { StoredConnectionParams, DbKind } from "../../../shared/src"
import type { ConnectionEntry } from "../../services/ConnectionStoreService"
import { ConnectionStoreService } from "../../services/ConnectionStoreService"
import { StorageError, makeErrorContext } from "../../core/errors"
import * as FileStorage from "../FileStorage"

const ALG = "aes-256-gcm"
const KEY_LEN = 32
const IV_LEN = 12

interface StoredConnectionItem {
  id: string
  label: string
  enc: string
  name?: string
  group?: string
  createdAt: number
  updatedAt: number
}

export type ConnectionList = StoredConnectionItem[]

const makeStorageError = (operation: "read" | "write" | "delete", filePath: string): StorageError =>
  new StorageError({
    context: makeErrorContext(operation),
    filePath,
    operation,
  })

class ConnectionStoreServiceImpl implements ConnectionStoreService {
  private getStorePath(): string {
    const base =
      process.env.CONNECTIONS_STORE_DIR ||
      (typeof process !== "undefined" && (process as any).platform === "win32"
        ? NodePath.join(
            process.env.APPDATA || process.env.LOCALAPPDATA || process.cwd(),
            "db-client"
          )
        : NodePath.join(process.env.HOME || "/tmp", ".db-client"))
    return NodePath.join(base, "connections.json")
  }

  private getKeyPath(): string {
    const storePath = this.getStorePath()
    return NodePath.join(NodePath.dirname(storePath), ".key")
  }

  private getOrDeriveKey = (): Effect.Effect<Buffer, StorageError> => {
    const self = this
    const envKey = process.env.CONNECTIONS_ENCRYPTION_KEY
    if (envKey && /^[0-9a-fA-F]{64}$/.test(envKey)) {
      return Effect.succeed(Buffer.from(envKey, "hex"))
    }
    const keyPath = self.getKeyPath()
    return Effect.gen(function* () {
      const exists = yield* FileStorage.fileExists(keyPath)
      if (exists) {
        const content = yield* FileStorage.readFile(keyPath)
        return Buffer.from(content, "hex")
      }
      const key = randomBytes(KEY_LEN)
      yield* FileStorage.writeFile(keyPath, key.toString("hex"), { mode: 0o600 })
      return key
    })
  }

  private encrypt = (plaintext: string): Effect.Effect<string, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const key = yield* self.getOrDeriveKey()
      const iv = randomBytes(IV_LEN)
      const cipher = createCipheriv(ALG, key, iv)
      const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
      const tag = cipher.getAuthTag()
      return Buffer.concat([iv, tag, enc]).toString("base64")
    })
  }

  private decrypt = (encrypted: string): Effect.Effect<string, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const key = yield* self.getOrDeriveKey()
      const buf = Buffer.from(encrypted, "base64")
      const iv = buf.subarray(0, IV_LEN)
      const tag = buf.subarray(IV_LEN, IV_LEN + 16)
      const data = buf.subarray(IV_LEN + 16)
      const decipher = createDecipheriv(ALG, key, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8")
    })
  }

  private makeLabel(params: StoredConnectionParams): string {
    return `${params.username}@${params.host}:${params.port}/${params.database}`
  }

  private normalizeStoredParams(params: StoredConnectionParams): StoredConnectionParams {
    const dbType: DbKind = params.dbType ?? "postgres"
    return { ...params, dbType }
  }

  private normalizeItem(raw: unknown): StoredConnectionItem | null {
    const o = raw as Record<string, unknown>
    if (!o?.id || !o?.label || !o?.enc) return null
    const now = Date.now()
    const c = typeof o.createdAt === "number" ? o.createdAt : now
    const u = typeof o.updatedAt === "number" ? o.updatedAt : now
    const item: StoredConnectionItem = {
      id: String(o.id),
      label: String(o.label),
      enc: String(o.enc),
      createdAt: c,
      updatedAt: u,
    }
    if (o.name != null && o.name !== "") item.name = String(o.name)
    if (o.group != null && String(o.group).trim() !== "") item.group = String(o.group).trim()
    return item
  }

  private toEntry(item: StoredConnectionItem): ConnectionEntry {
    return {
      id: item.id,
      label: item.label,
      name: item.name,
      group: item.group,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }
  }

  private loadRaw = (): Effect.Effect<ConnectionList, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const path = self.getStorePath()
      const exists = yield* FileStorage.fileExists(path)
      if (!exists) return [] as ConnectionList

      const content = yield* FileStorage.readFile(path)
      const arr = JSON.parse(content)
      if (!Array.isArray(arr)) return [] as ConnectionList

      const result: StoredConnectionItem[] = []
      for (const node of arr) {
        const o = node as Record<string, unknown>
        if (Array.isArray(o?.connections) && typeof o?.group === "string") {
          const grp = String(o.group).trim()
          for (const c of o.connections as unknown[]) {
            const item = self.normalizeItem(c)
            if (item) {
              if (grp) item.group = grp
              result.push(item)
            }
          }
        } else {
          const item = self.normalizeItem(node)
          if (item) result.push(item)
        }
      }
      return result
    })
  }

  private saveRaw = (list: ConnectionList): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const path = self.getStorePath()
      yield* FileStorage.writeFile(path, JSON.stringify(list, null, 2), { mode: 0o600 })
    })
  }

  list = (): Effect.Effect<ConnectionEntry[], StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const list = yield* self.loadRaw()
      return list.map((i: StoredConnectionItem) => self.toEntry(i))
    })
  }

  save = (id: string, params: StoredConnectionParams, meta: { name?: string; group?: string }): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const enc = yield* self.encrypt(JSON.stringify(self.normalizeStoredParams(params)))
      const list = yield* self.loadRaw()
      const idx = list.findIndex((c: StoredConnectionItem) => c.id === id)
      const now = Date.now()
      const prev = idx !== -1 ? list[idx] : undefined
      const name = meta?.name !== undefined ? meta.name.trim() || undefined : prev?.name
      const group = meta?.group !== undefined ? meta.group.trim() || undefined : prev?.group
      const label = name || self.makeLabel(params)
      const item: StoredConnectionItem = {
        id,
        label,
        enc,
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        ...(name ? { name } : {}),
        ...(group ? { group } : {}),
      }
      if (idx !== -1) list[idx] = item
      else list.push(item)
      yield* self.saveRaw(list)
    })
  }

  get = (id: string): Effect.Effect<ConnectionEntry | null, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const list = yield* self.loadRaw()
      const item = list.find((c: StoredConnectionItem) => c.id === id)
      return item ? self.toEntry(item) : null
    })
  }

  getParams = (id: string): Effect.Effect<(StoredConnectionParams & { id: string }) | null, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const list = yield* self.loadRaw()
      const item = list.find((c: StoredConnectionItem) => c.id === id)
      if (!item) return null
      const parsed = yield* self.decrypt(item.enc)
      const params = JSON.parse(parsed) as StoredConnectionParams
      return { ...self.normalizeStoredParams(params), id: item.id }
    })
  }

  remove = (id: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const list = yield* self.loadRaw()
      const idx = list.findIndex((c: StoredConnectionItem) => c.id === id)
      if (idx !== -1) {
        list.splice(idx, 1)
        yield* self.saveRaw(list)
      }
    })
  }

  updateMeta = (id: string, meta: { name?: string }): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const list = yield* self.loadRaw()
      const idx = list.findIndex((c: StoredConnectionItem) => c.id === id)
      if (idx === -1) return
      const item = list[idx]
      if (meta.name !== undefined) {
        const dec = yield* self.decrypt(item.enc)
        const parsed = JSON.parse(dec) as StoredConnectionParams
        item.label = meta.name.trim() || self.makeLabel(parsed)
        item.name = meta.name.trim() || undefined
        item.updatedAt = Date.now()
      }
      yield* self.saveRaw(list)
    })
  }

  reorder = (rawList: unknown[]): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const existing = yield* self.loadRaw()
      const byId = new Map(existing.map((x: StoredConnectionItem) => [x.id, x]))
      const list: ConnectionList = (rawList as unknown[])
        .map((raw: unknown) => {
          const o = raw as Record<string, unknown>
          const id = o?.id != null ? String(o.id) : undefined
          if (!id) return null
          const fromStore = byId.get(id)
          if (fromStore) {
            if (o.name !== undefined || o.group !== undefined) {
              return {
                ...fromStore,
                ...(o.name !== undefined ? { label: String(o.name).trim() || fromStore.label, name: String(o.name).trim() || undefined } : {}),
                ...(o.group !== undefined ? { group: String(o.group).trim() || undefined } : {}),
                updatedAt: Date.now(),
              } as StoredConnectionItem
            }
            return fromStore
          }
          return self.normalizeItem(raw)
        })
        .filter((x: StoredConnectionItem | null): x is StoredConnectionItem => x !== null)
      yield* self.saveRaw(list)
    })
  }
}

export const ConnectionStoreServiceLive = Layer.succeed(
  ConnectionStoreService,
  new ConnectionStoreServiceImpl()
)
