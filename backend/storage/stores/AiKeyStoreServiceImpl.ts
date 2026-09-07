import { Effect, Layer } from "effect"
import { AiKeyStoreService } from "../../services/AiKeyStoreService"
import { StorageError, makeErrorContext } from "../../core/errors"
import * as FileStorage from "../FileStorage"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import * as NodePath from "node:path"

const ALG = "aes-256-gcm"
const KEY_LEN = 32
const IV_LEN = 12

interface StoredAiKeyItem {
  keyRef: string
  enc: string
}

class AiKeyStoreServiceImpl implements AiKeyStoreService {
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
    return NodePath.join(this.getBaseDir(), "ai-keys.json")
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

  private loadRaw = (): Effect.Effect<StoredAiKeyItem[], StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const path = self.getStorePath()
      const exists = yield* FileStorage.fileExists(path)
      if (!exists) return [] as StoredAiKeyItem[]
      const content = yield* FileStorage.readFile(path)
      const arr = JSON.parse(content)
      if (!Array.isArray(arr)) return [] as StoredAiKeyItem[]
      return arr
        .map((item: unknown) => item as Partial<StoredAiKeyItem>)
        .filter((item: Partial<StoredAiKeyItem>) => typeof item.keyRef === "string" && typeof item.enc === "string")
        .map((item: Partial<StoredAiKeyItem>) => ({ keyRef: String(item.keyRef), enc: String(item.enc) }))
    })
  }

  private saveRaw = (list: StoredAiKeyItem[]): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const path = self.getStorePath()
      yield* FileStorage.writeFile(path, JSON.stringify(list, null, 2), { mode: 0o600 })
    })
  }

  set = (keyRef: string, apiKey: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const ref = keyRef.trim()
      if (!ref || !apiKey.trim()) return
      const list = yield* self.loadRaw()
      const idx = list.findIndex((x: StoredAiKeyItem) => x.keyRef === ref)
      const enc = yield* self.encrypt(apiKey.trim())
      const item: StoredAiKeyItem = { keyRef: ref, enc }
      if (idx >= 0) list[idx] = item
      else list.push(item)
      yield* self.saveRaw(list)
    })
  }

  get = (keyRef: string): Effect.Effect<string | null, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const ref = keyRef.trim()
      if (!ref) return null
      const list = yield* self.loadRaw()
      const item = list.find((x: StoredAiKeyItem) => x.keyRef === ref)
      if (!item) return null
      return yield* self.decrypt(item.enc)
    })
  }

  delete = (keyRef: string): Effect.Effect<void, StorageError> => {
    const self = this
    return Effect.gen(function* () {
      const ref = keyRef.trim()
      if (!ref) return
      const list = (yield* self.loadRaw()).filter((x: StoredAiKeyItem) => x.keyRef !== ref)
      yield* self.saveRaw(list)
    })
  }
}

export const AiKeyStoreServiceLive = Layer.succeed(
  AiKeyStoreService,
  new AiKeyStoreServiceImpl()
)
