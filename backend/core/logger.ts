/**
 * 结构化日志模块
 *
 * Effect v4 变更：
 * - `LogLevel` 改为字符串字面量联合类型（"Debug" | "Info" | "Warn" | ...）
 * - `Logger.replace` 被移除，改用 `Logger.layer([logger], { mergeWithExisting: false })`
 * - `Logger.Options` 不再有 `annotations` 字段
 */

import { Logger, LogLevel } from "effect"
import type { Layer } from "effect"

/** v4 LogLevel 是字符串联合；把旧的大写标签映射过去 */
export const logLevelMap: Record<string, LogLevel.LogLevel> = {
  DEBUG: "Debug",
  INFO: "Info",
  WARN: "Warn",
  ERROR: "Error",
} as const

// 敏感字段列表（用于脱敏）
const SENSITIVE_KEYS = ["password", "apikey", "secret", "privatekey", "token", "passwd"]

const sanitizeValue = (key: string, value: unknown): unknown => {
  if (SENSITIVE_KEYS.some((k) => key.toLowerCase().includes(k))) {
    return "[REDACTED]"
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return sanitizeLogEntry(value as Record<string, unknown>)
  }
  return value
}

export const sanitizeLogEntry = (entry: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entry)) {
    result[key] = sanitizeValue(key, value)
  }
  return result
}

// v4: Logger.make 的 Options 不再有 annotations 字段
const jsonLogger = Logger.make(({ logLevel, message, date }) => {
  const entry = sanitizeLogEntry({
    timestamp: date.toISOString(),
    level: logLevel,
    message: Array.isArray(message) ? (message as unknown[]).join(" ") : String(message),
  })
  console.log(JSON.stringify(entry))
})

const textLogger = Logger.make(({ logLevel, message, date }) => {
  const ts = date.toISOString()
  const msg = Array.isArray(message) ? (message as unknown[]).join(" ") : String(message)
  console.log(`[${ts}] [${logLevel}] ${msg}`)
})

// v4: Logger.replace 不存在了，用 Logger.layer 并禁用与现有 logger 合并
export const JsonLoggerLayer: Layer.Layer<never> = Logger.layer([jsonLogger], {
  mergeWithExisting: false,
})

export const TextLoggerLayer: Layer.Layer<never> = Logger.layer([textLogger], {
  mergeWithExisting: false,
})
