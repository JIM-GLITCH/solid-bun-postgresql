/**
 * 后端配置管理模块
 * 使用 Effect 4 的 Config 模块定义所有配置项，支持环境变量覆盖
 * 每个配置都有合理的默认值，确保类型安全
 */

import { Config } from "effect"

// ===== AI 服务配置 =====

/**
 * AI 服务配置定义
 * - apiMode: AI API 模式，支持 OpenAI 兼容和 Anthropic 两种模式
 * - baseUrl: AI API 基础 URL，可选
 * - model: 使用的 AI 模型
 * - temperature: 生成温度，控制随机性
 * - maxTokens: 最大生成 token 数量
 */
export const AiConfig = Config.all({
  /** AI API 模式："openai-compatible" 或 "anthropic" */
  apiMode: Config.literals(["openai-compatible", "anthropic"], "AI_API_MODE").pipe(
    Config.withDefault("openai-compatible" as const)
  ),

  /** AI API 基础 URL，可选配置 */
  baseUrl: Config.string("AI_BASE_URL").pipe(Config.option),

  /** 使用的 AI 模型，默认 "qwen-plus" */
  model: Config.string("AI_MODEL").pipe(Config.withDefault("qwen-plus")),

  /** 生成温度，控制随机性，默认 0.2 */
  temperature: Config.number("AI_TEMPERATURE").pipe(Config.withDefault(0.2)),

  /** 最大生成 token 数量，默认 700 */
  maxTokens: Config.number("AI_MAX_TOKENS").pipe(Config.withDefault(700)),
})

/** AI 配置类型 */
export type AiConfigType = Config.Success<typeof AiConfig>

// ===== 数据库配置 =====

/**
 * 数据库连接池配置定义
 * - connectionTimeoutMs: 连接超时时间（毫秒）
 * - idleTimeoutMs: 空闲连接超时时间
 * - poolMaxSize: 普通连接池最大大小
 * - poolMaxSizeWithSsh: SSH 隧道连接池最大大小（较小）
 */
export const DatabaseConfig = Config.all({
  /** 数据库连接超时时间（毫秒），默认 10000ms */
  connectionTimeoutMs: Config.number("DB_CONNECTION_TIMEOUT_MS").pipe(
    Config.withDefault(10000)
  ),

  /** 空闲连接超时时间（毫秒），默认 30000ms */
  idleTimeoutMs: Config.number("DB_IDLE_TIMEOUT_MS").pipe(
    Config.withDefault(30000)
  ),

  /** 普通连接池最大大小，默认 6 */
  poolMaxSize: Config.number("DB_POOL_MAX_SIZE").pipe(
    Config.withDefault(6)
  ),

  /** SSH 隧道连接池最大大小，默认 2（SSH 连接资源消耗较大） */
  poolMaxSizeWithSsh: Config.number("DB_POOL_MAX_SIZE_SSH").pipe(
    Config.withDefault(2)
  ),
})

/** 数据库配置类型 */
export type DatabaseConfigType = Config.Success<typeof DatabaseConfig>

// ===== SSH 隧道配置 =====

/**
 * SSH 隧道配置定义
 * - defaultTimeoutMs: 默认连接超时时间（毫秒）
 * - debugMode: 调试模式，启用详细日志
 */
export const SshConfig = Config.all({
  /** SSH 连接默认超时时间（毫秒），默认 30000ms */
  defaultTimeoutMs: Config.number("SSH_DEFAULT_TIMEOUT_MS").pipe(
    Config.withDefault(30000)
  ),

  /** SSH 调试模式，默认关闭 */
  debugMode: Config.boolean("SSH_DEBUG_MODE").pipe(
    Config.withDefault(false)
  ),
})

/** SSH 配置类型 */
export type SshConfigType = Config.Success<typeof SshConfig>

// ===== 日志配置 =====

/**
 * 日志配置定义
 * - level: 日志级别
 * - format: 日志输出格式
 */
export const LogConfig = Config.all({
  /** 日志级别：DEBUG, INFO, WARN, ERROR，默认 INFO */
  level: Config.literals(["DEBUG", "INFO", "WARN", "ERROR"], "LOG_LEVEL").pipe(
    Config.withDefault("INFO" as const)
  ),

  /** 日志输出格式：json 或 text，默认 text */
  format: Config.literals(["json", "text"], "LOG_FORMAT").pipe(
    Config.withDefault("text" as const)
  ),
})

/** 日志配置类型 */
export type LogConfigType = Config.Success<typeof LogConfig>
