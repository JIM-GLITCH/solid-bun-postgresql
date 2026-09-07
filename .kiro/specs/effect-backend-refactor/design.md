# Design Document: Effect TS Backend Refactor

## Introduction

本文档描述将 `backend/` 目录下的 24 个 TypeScript 模块重构为 Effect TS 架构的技术设计方案。重构涵盖类型安全错误处理、资源管理、依赖注入、并发控制、配置管理和测试基础设施六个核心维度。

## Architecture Overview

### Layered Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        API Layer                                 │
│  api-core.ts → api-handlers-http.ts / api-handlers-vscode.ts   │
│  (Effect-based routing, request/response handling)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Service Layer                               │
│  DatabaseService │ SshTunnelService │ AiService                 │
│  ConnectionStoreService │ QueryHistoryService │ AiKeyStoreService│
│  SubscriptionService │ LicenseService                           │
│  (Effect Context, Tag-based DI, Layer composition)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                          │
│  PostgresAdapter │ MysqlAdapter │ SqlServerAdapter              │
│  FileSystem │ HttpClient │ Logger                               │
│  (Effect Scope, acquireRelease, resource pools)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Runtime Layer                               │
│  SessionRuntime │ Config │ TestContext                          │
│  (Effect Runtime, Ref, Fiber, Supervisor)                       │
└─────────────────────────────────────────────────────────────────┘
```

### Module Organization

重构后的目录结构：

```
backend/
├── core/
│   ├── errors.ts           # 结构化错误类型定义
│   ├── types.ts            # 共享类型定义
│   └── config.ts           # Effect Config 定义
├── services/
│   ├── DatabaseService.ts  # 数据库服务接口
│   ├── SshTunnelService.ts # SSH 隧道服务接口
│   ├── AiService.ts        # AI 服务接口
│   ├── ConnectionStoreService.ts
│   ├── QueryHistoryService.ts
│   ├── AiKeyStoreService.ts
│   ├── SubscriptionService.ts
│   └── LicenseService.ts
├── adapters/
│   ├── postgres/
│   │   ├── PostgresAdapter.ts
│   │   ├── PostgresPool.ts
│   │   └── PostgresHandlers.ts
│   ├── mysql/
│   │   ├── MysqlAdapter.ts
│   │   ├── MysqlPool.ts
│   │   └── MysqlHandlers.ts
│   └── sqlserver/
│       ├── SqlServerAdapter.ts
│       ├── SqlServerPool.ts
│       └── SqlServerHandlers.ts
├── runtime/
│   ├── SessionRuntime.ts   # 扩展现有 effect-session-runtime
│   └── layers.ts           # Layer 组合定义
├── api/
│   ├── ApiCore.ts          # 路由逻辑
│   ├── routes/             # 按领域的路由模块
│   └── middleware/         # Effect 中间件
├── storage/
│   ├── FileStorage.ts      # Effect 文件操作封装
│   └── stores/             # 各存储实现
├── ssh/
│   └── SshTunnel.ts        # SSH 隧道 Effect 封装
└── test/
    ├── mocks/              # Mock 服务实现
    ├── TestContext.ts      # 测试上下文
    └── layers/             # 测试用 Layer
```

## Component Design

### 1. Error Type Hierarchy

使用 Effect 的 `Data.Error` 模式定义结构化错误类型：

```typescript
// backend/core/errors.ts
import { Data } from "effect";

// ===== Base Error Types =====

export interface ErrorContext {
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly operation: string;
}

export const makeErrorContext = (operation: string): ErrorContext => ({
  timestamp: Date.now(),
  operation,
});

// ===== Database Errors =====

export interface DatabaseConnectionErrorContext extends ErrorContext {
  readonly host: string;      // 脱敏后
  readonly port: number;
  readonly database: string;
  readonly errorCode?: string;
  readonly retrySuggestion?: string;
}

export class DatabaseConnectionError extends Data.Error<DatabaseConnectionErrorContext>() {
  static readonly tag = "DatabaseConnectionError";
  get message() {
    return `Database connection failed: ${this.database}@${this.host}:${this.port}`;
  }
}

export interface QueryExecutionErrorContext extends ErrorContext {
  readonly sql: string;           // 脱敏后
  readonly position?: number;
  readonly databaseErrorCode?: string;
  readonly databaseErrorMessage?: string;
}

export class QueryExecutionError extends Data.Error<QueryExecutionErrorContext>() {
  static readonly tag = "QueryExecutionError";
  get message() {
    return `Query execution failed: ${this.sql.substring(0, 100)}...`;
  }
}

// ===== SSH Tunnel Errors =====

export interface SshTunnelErrorContext extends ErrorContext {
  readonly sshHost: string;       // 脱敏后
  readonly sshPort: number;
  readonly phase: "connect" | "auth" | "forward" | "unknown";
}

export class SshTunnelError extends Data.Error<SshTunnelErrorContext>() {
  static readonly tag = "SshTunnelError";
  get message() {
    return `SSH tunnel failed at ${this.phase}: ${this.sshHost}:${this.sshPort}`;
  }
}

// ===== AI Service Errors =====

export interface AiServiceErrorContext extends ErrorContext {
  readonly apiMode: "openai-compatible" | "anthropic";
  readonly model: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;
}

export class AiServiceError extends Data.Error<AiServiceErrorContext>() {
  static readonly tag = "AiServiceError";
  get message() {
    return `AI service error (${this.apiMode}): model=${this.model}, status=${this.httpStatus}`;
  }
}

// ===== Storage Errors =====

export interface StorageErrorContext extends ErrorContext {
  readonly filePath: string;
  readonly operation: "read" | "write" | "delete";
}

export class StorageError extends Data.Error<StorageErrorContext>() {
  static readonly tag = "StorageError";
  get message() {
    return `Storage operation '${this.operation}' failed: ${this.filePath}`;
  }
}

// ===== Session Errors =====

export class SessionNotFoundError extends Data.Error<{
  readonly sessionId: string;
  readonly timestamp: number;
}> {
  static readonly tag = "SessionNotFoundError";
  get message() {
    return `Session not found: ${this.sessionId}`;
  }
}

// ===== API Errors =====

export class MethodNotFoundError extends Data.Error<{
  readonly method: string;
  readonly timestamp: number;
}> {
  static readonly tag = "MethodNotFoundError";
  get message() {
    return `Method not found: ${this.method}`;
  }
}

export class SubscriptionRequiredError extends Data.Error<{
  readonly feature: string;
  readonly timestamp: number;
}> {
  static readonly tag = "SubscriptionRequiredError";
  get message() {
    return `Subscription required for feature: ${this.feature}`;
  }
}
```

### 2. Service Interfaces and Tags

```typescript
// backend/services/DatabaseService.ts
import { Context, Effect, Layer, Scope } from "effect";
import type { DbKind, DatabaseCapabilities } from "../../shared/src";
import type { SessionConnection } from "../session-connection";
import { DatabaseConnectionError, QueryExecutionError } from "../core/errors";

export interface DatabaseService {
  readonly connect: (params: ConnectParams) => Effect.Effect<SessionConnection, DatabaseConnectionError, Scope.Scope>;
  readonly disconnect: (connectionId: string) => Effect.Effect<void, never>;
  readonly query: <A = unknown>(connectionId: string, sql: string, params?: unknown[]) => Effect.Effect<QueryResult<A>, QueryExecutionError>;
  readonly queryStream: (connectionId: string, sql: string, batchSize: number) => Effect.Effect<StreamResult, QueryExecutionError>;
  readonly cancel: (connectionId: string) => Effect.Effect<void, never>;
  readonly getCapabilities: (kind: DbKind) => DatabaseCapabilities;
}

export const DatabaseService = Context.GenericTag<DatabaseService>("DatabaseService");

// ===== SSH Tunnel Service =====

// backend/services/SshTunnelService.ts
import { Context, Effect, Scope } from "effect";
import type { PostgresLoginParams } from "../../shared/src";
import { SshTunnelError } from "../core/errors";

export interface SshTunnelService {
  readonly createTunnel: (params: PostgresLoginParams) => Effect.Effect<TunnelResult, SshTunnelError, Scope.Scope>;
  readonly closeTunnel: (localPort: number) => Effect.Effect<void, never>;
}

export const SshTunnelService = Context.GenericTag<SshTunnelService>("SshTunnelService");

export interface TunnelResult {
  readonly localPort: number;
  readonly close: () => Effect.Effect<void, never>;
}

// ===== AI Service =====

// backend/services/AiService.ts
import { Context, Effect, Schema } from "effect";
import { AiServiceError } from "../core/errors";

export interface AiService {
  readonly executeSqlEdit: (params: AiSqlEditParams) => Effect.Effect<AiSqlEditResult, AiServiceError>;
  readonly validateConfig: () => Effect.Effect<boolean, AiServiceError>;
}

export const AiService = Context.GenericTag<AiService>("AiService");

// Schema for AI response validation
export const AiResponseSchema = Schema.Struct({
  sql: Schema.String,
  rationale: Schema.String,
  warnings: Schema.Array(Schema.String),
  alternatives: Schema.optional(Schema.Array(Schema.String)),
});

// ===== Storage Services =====

// backend/services/ConnectionStoreService.ts
import { Context, Effect } from "effect";
import type { StoredConnectionParams } from "../../shared/src";
import { StorageError } from "../core/errors";

export interface ConnectionStoreService {
  readonly list: () => Effect.Effect<ConnectionEntry[], StorageError>;
  readonly save: (id: string, params: StoredConnectionParams, meta: ConnectionMeta) => Effect.Effect<void, StorageError>;
  readonly get: (id: string) => Effect.Effect<StoredConnectionParams | null, StorageError>;
  readonly remove: (id: string) => Effect.Effect<void, StorageError>;
  readonly updateMeta: (id: string, meta: Partial<ConnectionMeta>) => Effect.Effect<void, StorageError>;
}

export const ConnectionStoreService = Context.GenericTag<ConnectionStoreService>("ConnectionStoreService");

// ===== Subscription Services =====

// backend/services/SubscriptionService.ts
import { Context, Effect } from "effect";
import { SubscriptionRequiredError } from "../core/errors";

export interface SubscriptionService {
  readonly validateToken: () => Effect.Effect<SubscriptionStatus, SubscriptionRequiredError>;
  readonly getAccount: () => Effect.Effect<AccountInfo | null, never>;
  readonly assertFeature: (feature: string) => Effect.Effect<void, SubscriptionRequiredError>;
}

export const SubscriptionService = Context.GenericTag<SubscriptionService>("SubscriptionService");
```

### 3. Resource Management with Layer/Scope

```typescript
// backend/adapters/postgres/PostgresAdapter.ts
import { Effect, Layer, Scope, Ref } from "effect";
import { Client, Pool } from "pg";
import { DatabaseConnectionError, QueryExecutionError } from "../../core/errors";
import type { PostgresLoginParams } from "../../../shared/src";
import { SshTunnelService } from "../../services/SshTunnelService";

export interface PostgresConnection {
  readonly client: Client;
  readonly pool: Pool;
  readonly closeTunnel?: () => Effect.Effect<void, never>;
}

export const makePostgresConnection = (
  params: PostgresLoginParams
): Effect.Effect<PostgresConnection, DatabaseConnectionError, Scope.Scope> =>
  Effect.gen(function* (_) {
    const sshService = yield* _(SshTunnelService);
    
    // Establish SSH tunnel if needed
    let tunnel: TunnelResult | undefined;
    if (params.sshEnabled) {
      tunnel = yield* _(sshService.createTunnel(params));
    }

    const config = {
      host: tunnel ? undefined : params.host ?? "localhost",
      port: tunnel ? tunnel.localPort : Number(params.port ?? 5432),
      database: params.database || params.username || "postgres",
      user: params.username,
      password: params.password ?? "",
      connectionTimeoutMillis: tunnel ? 30000 : 10000,
    };

    // Create client with acquireRelease
    const client = yield* _(
      Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const c = new Client(config);
            await c.connect();
            return c;
          },
          catch: (e) => new DatabaseConnectionError({
            ...makeErrorContext("postgres.connect"),
            host: sanitizeHost(config.host),
            port: config.port,
            database: config.database,
            errorCode: extractErrorCode(e),
          }),
        }),
        (client) => Effect.promise(() => client.end().catch(() => {}))
      )
    );

    // Create pool
    const pool = yield* _(
      Effect.acquireRelease(
        Effect.sync(() => new Pool({ ...config, max: tunnel ? 2 : 6 })),
        (pool) => Effect.promise(() => pool.end().catch(() => {}))
      )
    );

    return {
      client,
      pool,
      closeTunnel: tunnel ? () => tunnel.close() : undefined,
    };
  });

// Session-scoped connection Layer
export const PostgresConnectionLive = Layer.scoped(
  DatabaseService,
  Effect.gen(function* (_) {
    const sessions = yield* _(Ref.make(new Map<string, PostgresConnection>()));
    
    return DatabaseService.of({
      connect: (params) =>
        Effect.gen(function* (_) {
          const conn = yield* _(makePostgresConnection(params));
          yield* _(Ref.update(sessions, (m) => m.set(params.connectionId, conn)));
          return conn;
        }),
      // ... other methods
    });
  })
);
```

### 4. Session Runtime Extension

```typescript
// backend/runtime/SessionRuntime.ts
import { Effect, Ref, Scope, Fiber, Supervisor } from "effect";
import type { SessionConnection } from "../session-connection";
import { SessionNotFoundError } from "../core/errors";

export interface SessionRuntime {
  readonly registry: SessionRegistry;
  readonly register: (id: string, session: SessionConnection) => Effect.Effect<void, never>;
  readonly unregister: (id: string) => Effect.Effect<void, never>;
  readonly get: (id: string) => Effect.Effect<SessionConnection, SessionNotFoundError>;
  readonly withSessionScope: <A, E>(
    id: string,
    use: (session: SessionConnection) => Effect.Effect<A, E>,
    release?: (session: SessionConnection) => Effect.Effect<void, never>
  ) => Effect.Effect<A, E | SessionNotFoundError>;
  readonly startKeepalive: (id: string) => Effect.Effect<void, never>;
  readonly stopKeepalive: (session: SessionConnection) => Effect.Effect<void, never>;
  readonly cancelAllQueries: (id: string) => Effect.Effect<void, never>;
}

export interface SessionRegistry {
  readonly get: (id: string) => Effect.Effect<SessionConnection | undefined, never>;
  readonly set: (id: string, session: SessionConnection) => Effect.Effect<void, never>;
  readonly remove: (id: string) => Effect.Effect<boolean, never>;
  readonly list: () => Effect.Effect<SessionConnection[], never>;
  readonly clear: () => Effect.Effect<void, never>;
}

export const createSessionRegistry = (): Effect.Effect<SessionRegistry, never> =>
  Effect.gen(function* (_) {
    const ref = yield* _(Ref.make(new Map<string, SessionConnection>()));
    
    return {
      get: (id) => Ref.get(ref).pipe(Effect.map((m) => m.get(id))),
      set: (id, session) => Ref.update(ref, (m) => new Map(m).set(id, session)),
      remove: (id) => Ref.modify(ref, (m) => {
        const existed = m.has(id);
        const next = new Map(m);
        next.delete(id);
        return [existed, next];
      }),
      list: () => Ref.get(ref).pipe(Effect.map((m) => Array.from(m.values()))),
      clear: () => Ref.set(ref, new Map()),
    };
  });

export const createSessionRuntime = (): Effect.Effect<SessionRuntime, never, Scope.Scope> =>
  Effect.gen(function* (_) {
    const registry = yield* _(createSessionRegistry());
    const activeFibers = yield* _(Ref.make(new Map<string, Set<Fiber.RuntimeFiber<unknown, unknown>>>()));
    
    return {
      registry,
      
      register: (id, session) => registry.set(id, session),
      
      unregister: (id) =>
        Effect.gen(function* (_) {
          yield* _(registry.remove(id));
          // Cancel all fibers for this session
          const fibers = yield* _(Ref.get(activeFibers));
          const sessionFibers = fibers.get(id);
          if (sessionFibers) {
            yield* _(Effect.forEach(sessionFibers, (f) => Fiber.interrupt(f), { concurrency: "unbounded" }));
          }
        }),
      
      get: (id) =>
        registry.get(id).pipe(
          Effect.flatMap((session) =>
            session
              ? Effect.succeed(session)
              : Effect.fail(new SessionNotFoundError({ sessionId: id, timestamp: Date.now() }))
          )
        ),
      
      withSessionScope: (id, use, release) =>
        Effect.gen(function* (_) {
          const session = yield* _(registry.get(id));
          if (!session) {
            return yield* _(Effect.fail(new SessionNotFoundError({ sessionId: id, timestamp: Date.now() })));
          }
          return yield* _(
            Effect.acquireRelease(
              Effect.succeed(session),
              (s) => release ? release(s) : Effect.void
            ),
            Effect.flatMap(use)
          );
        }),
      
      startKeepalive: (id) =>
        Effect.gen(function* (_) {
          const session = yield* _(registry.get(id));
          if (!session) return;
          
          const fiber = yield* _(
            Effect.gen(function* (_) {
              while (true) {
                yield* _(Effect.sleep("60 seconds"));
                yield* _(executeKeepalive(session));
              }
            }),
            Effect.fork
          );
          
          // Track fiber for cancellation
          yield* _(Ref.update(activeFibers, (m) => {
            const next = new Map(m);
            const set = next.get(id) ?? new Set();
            set.add(fiber);
            next.set(id, set);
            return next;
          }));
        }),
      
      stopKeepalive: (session) =>
        Effect.sync(() => {
          if (session.keepAliveTimer) {
            clearInterval(session.keepAliveTimer);
            session.keepAliveTimer = undefined;
          }
        }),
      
      cancelAllQueries: (id) =>
        Effect.gen(function* (_) {
          const fibers = yield* _(Ref.get(activeFibers));
          const sessionFibers = fibers.get(id);
          if (sessionFibers) {
            yield* _(Effect.forEach(sessionFibers, (f) => Fiber.interrupt(f), { concurrency: "unbounded" }));
          }
        }),
    };
  });

// Helper for keepalive
const executeKeepalive = (session: SessionConnection): Effect.Effect<void, never> =>
  Effect.tryPromise({
    try: async () => {
      if (session.dbKind === "postgres") {
        await session.userUsedClient.query("SELECT 1 --keepalive");
      } else if (session.dbKind === "sqlserver") {
        await session.userUsedClient.request().query("SELECT 1");
      } else {
        await session.userUsedClient.query("SELECT 1");
      }
    },
    catch: () => new Error("Keepalive failed"),
  }).pipe(Effect.orElse(() => Effect.void));
```

### 5. API Handler Refactoring

```typescript
// backend/api/routes/db.ts
import { Effect, Schema } from "effect";
import { DatabaseService } from "../../services/DatabaseService";
import { SessionNotFoundError, QueryExecutionError } from "../../core/errors";

// Define handler as independent Effect function
export const handleDbConnect = (
  params: ConnectDbRequest
): Effect.Effect<ConnectResult, DatabaseConnectionError, DatabaseService | Scope.Scope> =>
  Effect.gen(function* (_) {
    const db = yield* _(DatabaseService);
    const session = yield* _(db.connect(params));
    return { success: true, connectionId: params.connectionId, dbType: params.dbType };
  });

export const handleDbDisconnect = (
  params: { connectionId: string }
): Effect.Effect<{ success: true }, SessionNotFoundError, DatabaseService> =>
  Effect.gen(function* (_) {
    const db = yield* _(DatabaseService);
    yield* _(db.disconnect(params.connectionId));
    return { success: true };
  });

export const handleDbQuery = (
  params: { connectionId: string; query: string; statements?: string[] }
): Effect.Effect<QueryResult, QueryExecutionError | SessionNotFoundError, DatabaseService> =>
  Effect.gen(function* (_) {
    const db = yield* _(DatabaseService);
    return yield* _(db.query(params.connectionId, params.query));
  });

// Router composition
export const dbRoutes = {
  "db/connect": handleDbConnect,
  "db/disconnect": handleDbDisconnect,
  "db/query": handleDbQuery,
  // ... all other db/* routes
};

// backend/api/ApiCore.ts
import { Effect } from "effect";
import { dbRoutes } from "./routes/db";
import { connectionRoutes } from "./routes/connections";
import { MethodNotFoundError } from "../core/errors";

export const routeApiRequest = <M extends string>(
  method: M,
  payload: unknown
): Effect.Effect<unknown, MethodNotFoundError | unknown, never> =>
  Effect.gen(function* (_) {
    // Try db routes
    if (method.startsWith("db/")) {
      const handler = dbRoutes[method as keyof typeof dbRoutes];
      if (handler) {
        return yield* _(handler(payload as any));
      }
    }
    
    // Try connection routes
    if (method.startsWith("connections/")) {
      const handler = connectionRoutes[method as keyof typeof connectionRoutes];
      if (handler) {
        return yield* _(handler(payload as any));
      }
    }
    
    // ... other route families
    
    return yield* _(Effect.fail(new MethodNotFoundError({ method, timestamp: Date.now() })));
  });
```

### 6. Configuration with Effect Config

```typescript
// backend/core/config.ts
import { Config, Secret } from "effect";

// AI Service Config
export const AiConfig = Config.all({
  apiMode: Config.literal("openai-compatible", "anthropic").pipe(
    Config.withDefault("openai-compatible" as const)
  ),
  baseUrl: Config.string("AI_BASE_URL").pipe(Config.option),
  model: Config.string("AI_MODEL").pipe(Config.withDefault("qwen-plus")),
  temperature: Config.number("AI_TEMPERATURE").pipe(Config.withDefault(0.2)),
  topP: Config.number("AI_TOP_P").pipe(Config.option),
  maxTokens: Config.number("AI_MAX_TOKENS").pipe(Config.withDefault(700)),
});

// Database Config
export const DatabaseConfig = Config.all({
  connectionTimeoutMs: Config.number("DB_CONNECTION_TIMEOUT_MS").pipe(Config.withDefault(10000)),
  idleTimeoutMs: Config.number("DB_IDLE_TIMEOUT_MS").pipe(Config.withDefault(30000)),
  poolMaxSize: Config.number("DB_POOL_MAX_SIZE").pipe(Config.withDefault(6)),
  poolMaxSizeWithSsh: Config.number("DB_POOL_MAX_SIZE_SSH").pipe(Config.withDefault(2)),
});

// SSH Config
export const SshConfig = Config.all({
  defaultTimeoutMs: Config.number("SSH_DEFAULT_TIMEOUT_MS").pipe(Config.withDefault(30000)),
  debugMode: Config.boolean("SSH_DEBUG_MODE").pipe(Config.withDefault(false)),
});

// Logging Config
export const LogConfig = Config.all({
  level: Config.literal("DEBUG", "INFO", "WARN", "ERROR").pipe(
    Config.withDefault("INFO" as const)
  ),
  format: Config.literal("json", "text").pipe(Config.withDefault("text" as const)),
});
```

### 7. SSH Tunnel with acquireRelease

```typescript
// backend/ssh/SshTunnel.ts
import { Effect, Scope, Layer } from "effect";
import { Client } from "ssh2";
import { createServer } from "net";
import type { PostgresLoginParams } from "../../shared/src";
import { SshTunnelError } from "../core/errors";
import { SshConfig } from "../core/config";

export const createSshTunnel = (
  params: PostgresLoginParams
): Effect.Effect<TunnelResult, SshTunnelError, Scope.Scope> =>
  Effect.gen(function* (_) {
    const config = yield* _(SshConfig);
    
    const result = yield* _(
      Effect.acquireRelease(
        // Acquire: create tunnel
        Effect.async<TunnelResult, SshTunnelError>((resume) => {
          const conn = new Client();
          const server = createServer((sock) => {
            conn.forwardOut("", 0, params.host ?? "localhost", Number(params.port ?? 5432), (err, stream) => {
              if (err) {
                sock.destroy();
                return;
              }
              sock.pipe(stream).pipe(sock);
              stream.on("close", () => sock.destroy());
              sock.on("close", () => stream.end());
            });
          });

          server.on("listening", () => {
            const localPort = (server.address() as { port: number }).port;
            resume(Effect.succeed({
              localPort,
              server,
              conn,
            }));
          });

          server.on("error", (err) => {
            conn.end();
            resume(Effect.fail(new SshTunnelError({
              ...makeErrorContext("ssh.tunnel"),
              sshHost: sanitizeHost(params.sshHost),
              sshPort: Number(params.sshPort ?? 22),
              phase: "forward",
            })));
          });

          conn.on("ready", () => {
            server.listen(0, "127.0.0.1");
          });

          conn.on("error", (err) => {
            server.close();
            const phase = /auth/i.test(err.message) ? "auth" : "connect";
            resume(Effect.fail(new SshTunnelError({
              ...makeErrorContext("ssh.tunnel"),
              sshHost: sanitizeHost(params.sshHost),
              sshPort: Number(params.sshPort ?? 22),
              phase,
            })));
          });

          conn.connect({
            host: params.sshHost,
            port: Number(params.sshPort ?? 22),
            username: params.sshUsername,
            password: params.sshPassword,
            privateKey: params.sshPrivateKey,
            readyTimeout: config.defaultTimeoutMs,
            debug: config.debugMode ? (s: string) => console.log("[SSH]", s) : undefined,
          });
        }),
        // Release: close tunnel
        (result) =>
          Effect.async<void, never>((resume) => {
            result.server.close(() => {
              result.conn.end();
              resume(Effect.void);
            });
          })
      )
    );

    return {
      localPort: result.localPort,
      close: () =>
        Effect.async<void, never>((resume) => {
          result.server.close(() => {
            result.conn.end();
            resume(Effect.void);
          });
        }),
    };
  });

// SshTunnelService implementation
export const SshTunnelServiceLive = Layer.effect(
  SshTunnelService,
  Effect.gen(function* (_) {
    return SshTunnelService.of({
      createTunnel: createSshTunnel,
      closeTunnel: (localPort) => Effect.void, // Tracked by scope
    });
  })
);
```

### 8. AI Service with Retry and Schema Validation

```typescript
// backend/services/AiService.ts
import { Effect, Schema, Schedule, Duration } from "effect";
import { AiServiceError } from "../core/errors";
import { AiConfig } from "../core/config";

export const AiServiceLive = Layer.effect(
  AiService,
  Effect.gen(function* (_) {
    const config = yield* _(AiConfig);
    
    const callApi = (req: AiServiceRequest): Effect.Effect<string, AiServiceError> =>
      Effect.gen(function* (_) {
        const url = config.apiMode === "anthropic"
          ? resolveAnthropicUrl(config.baseUrl)
          : resolveOpenAiUrl(config.baseUrl);
        
        const response = yield* _(
          Effect.tryPromise({
            try: () => fetch(url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(config.apiMode === "anthropic"
                  ? { "x-api-key": yield* _(getApiKey()) }
                  : { Authorization: `Bearer ${yield* _(getApiKey())}` }),
              },
              body: JSON.stringify({
                model: config.model,
                messages: [
                  { role: "system", content: req.systemPrompt },
                  { role: "user", content: req.userPrompt },
                ],
                temperature: config.temperature,
                max_tokens: config.maxTokens,
              }),
            }),
            catch: (e) => new AiServiceError({
              ...makeErrorContext("ai.call"),
              apiMode: config.apiMode,
              model: config.model,
              retryable: true,
            }),
          })
        );
        
        if (!response.ok) {
          return yield* _(Effect.fail(new AiServiceError({
            ...makeErrorContext("ai.call"),
            apiMode: config.apiMode,
            model: config.model,
            httpStatus: response.status,
            retryable: response.status >= 500 || response.status === 429,
          })));
        }
        
        const text = yield* _(Effect.promise(() => response.text()));
        return text;
      });
    
    // Retry policy: retry on retryable errors, max 2 attempts
    const retryPolicy = Schedule.whileInput(
      Schedule.exponential(Duration.millis(500), 2),
      (err: AiServiceError) => err.retryable
    ).pipe(Schedule.compose(Schedule.recurs(1)));
    
    return AiService.of({
      executeSqlEdit: (params) =>
        Effect.gen(function* (_) {
          const response = yield* _(
            callApi({ systemPrompt: buildSystemPrompt(params), userPrompt: params.sql }),
            Effect.retry(retryPolicy)
          );
          
          // Validate with Schema
          const validated = yield* _(
            Schema.decodeUnknown(AiResponseSchema)(JSON.parse(response)),
            Effect.mapError(() => new AiServiceError({
              ...makeErrorContext("ai.validate"),
              apiMode: config.apiMode,
              model: config.model,
              retryable: false,
            }))
          );
          
          // Detect SQL risks
          const risks = detectSqlRisks(validated.sql);
          
          return {
            ...validated,
            warnings: [...validated.warnings, ...risks],
          };
        }),
      
      validateConfig: () =>
        Effect.gen(function* (_) {
          const apiKey = yield* _(getApiKey());
          return !!apiKey;
        }),
    });
  })
);
```

### 9. Structured Logging

```typescript
// backend/core/logger.ts
import { Logger, LogLevel, Effect } from "effect";
import { LogConfig } from "./config";

// Custom logger with structured output
export const structuredLogger = Logger.make<unknown, void>((options) => {
  const { logLevel, message, annotations } = options;
  const config = annotations.get(LogConfig) ?? { level: "INFO", format: "text" };
  
  const entry = {
    timestamp: new Date().toISOString(),
    level: logLevel.label,
    message,
    ...Object.fromEntries(annotations),
  };
  
  // Sanitize sensitive data
  const sanitized = sanitizeLogEntry(entry);
  
  if (config.format === "json") {
    console.log(JSON.stringify(sanitized));
  } else {
    console.log(`[${sanitized.timestamp}] [${sanitized.level}] ${sanitized.message}`);
  }
});

// Sanitize sensitive fields
const sanitizeLogEntry = (entry: Record<string, unknown>): Record<string, unknown> => {
  const sensitiveKeys = ["password", "apiKey", "secret", "token", "privateKey"];
  const result: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(entry)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeLogEntry(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  
  return result;
};

// Log level mapping
export const logLevelMap: Record<string, LogLevel.LogLevel> = {
  DEBUG: LogLevel.Debug,
  INFO: LogLevel.Info,
  WARN: LogLevel.Warning,
  ERROR: LogLevel.Error,
};
```

### 10. Test Infrastructure

```typescript
// backend/test/TestContext.ts
import { Effect, Layer, TestContext, Ref } from "effect";
import { DatabaseService } from "../services/DatabaseService";
import { SshTunnelService } from "../services/SshTunnelService";
import { AiService } from "../services/AiService";

// Mock Database Service
export const MockDatabaseService = Layer.effect(
  DatabaseService,
  Effect.gen(function* (_) {
    const sessions = yield* _(Ref.make(new Map<string, any>()));
    
    return DatabaseService.of({
      connect: (params) =>
        Effect.gen(function* (_) {
          const mockSession = { dbKind: params.dbType, mock: true };
          yield* _(Ref.update(sessions, (m) => m.set(params.connectionId, mockSession)));
          return mockSession as any;
        }),
      
      disconnect: (id) =>
        Effect.gen(function* (_) {
          yield* _(Ref.update(sessions, (m) => {
            m.delete(id);
            return m;
          }));
        }),
      
      query: (id, sql) =>
        Effect.succeed({ rows: [], columns: [], rowCount: 0 }),
      
      queryStream: (id, sql, batchSize) =>
        Effect.succeed({ rows: [], columns: [], hasMore: false }),
      
      cancel: (id) => Effect.void,
      
      getCapabilities: (kind) => defaultDatabaseCapabilities(kind),
    });
  })
);

// Mock SSH Tunnel Service
export const MockSshTunnelService = Layer.effect(
  SshTunnelService,
  Effect.sync(() =>
    SshTunnelService.of({
      createTunnel: (params) =>
        Effect.succeed({
          localPort: 54321,
          close: () => Effect.void,
        }),
      closeTunnel: (port) => Effect.void,
    })
  )
);

// Mock AI Service
export const MockAiService = Layer.effect(
  AiService,
  Effect.sync(() =>
    AiService.of({
      executeSqlEdit: (params) =>
        Effect.succeed({
          sql: params.sql,
          rationale: "Mock AI response",
          warnings: [],
        }),
      validateConfig: () => Effect.succeed(true),
    })
  )
);

// Combined test layer
export const TestLayer = Layer.mergeAll(
  MockDatabaseService,
  MockSshTunnelService,
  MockAiService
);

// Test helper
export const runTest = <A, E>(
  effect: Effect.Effect<A, E, DatabaseService | SshTunnelService | AiService>
): Promise<A> =>
  Effect.provide(effect, TestLayer).pipe(Effect.runPromise);
```

### 11. SSE Push Mechanism

```typescript
// backend/api/sse.ts
import { Effect, Hub, SubscriptionRef } from "effect";
import type { SSEMessage } from "../../shared/src";

export interface SseEventBus {
  readonly publish: (connectionId: string, message: SSEMessage) => Effect.Effect<void, never>;
  readonly subscribe: (connectionId: string) => Effect.Effect<(message: SSEMessage) => void, never>;
}

export const SseEventBusLive = Layer.effect(
  SseEventBus,
  Effect.gen(function* (_) {
    const hubs = yield* _(Ref.make(new Map<string, Hub.Hub<SSEMessage>>()));
    
    return {
      publish: (connectionId, message) =>
        Effect.gen(function* (_) {
          const hub = yield* _(Ref.get(hubs).pipe(Effect.map((m) => m.get(connectionId))));
          if (hub) {
            yield* _(Hub.publish(hub, message));
          }
        }),
      
      subscribe: (connectionId) =>
        Effect.gen(function* (_) {
          const hub = yield* _(
            Ref.modify(hubs, (m) => {
              const existing = m.get(connectionId);
              if (existing) return [existing, m];
              const newHub = yield* _(Hub.unbounded<SSEMessage>());
              const next = new Map(m).set(connectionId, newHub);
              return [newHub, next];
            })
          );
          
          return (message: SSEMessage) => {
            Effect.runSync(Hub.publish(hub, message));
          };
        }),
    };
  })
);
```

### 12. Layer Composition

```typescript
// backend/runtime/layers.ts
import { Layer } from "effect";
import { DatabaseService } from "../services/DatabaseService";
import { SshTunnelService } from "../services/SshTunnelService";
import { AiService } from "../services/AiService";
import { ConnectionStoreService } from "../services/ConnectionStoreService";
import { QueryHistoryService } from "../services/QueryHistoryService";

// Production layers
export const ProductionLayers = Layer.mergeAll(
  SshTunnelServiceLive,
  AiServiceLive,
  ConnectionStoreServiceLive,
  QueryHistoryServiceLive,
);

// Database layer depends on SSH tunnel
export const DatabaseLayer = DatabaseServiceLive.pipe(
  Layer.provide(SshTunnelServiceLive)
);

// Full application layer
export const AppLayer = Layer.mergeAll(
  ProductionLayers,
  DatabaseLayer,
);

// Usage in entry point
import { NodeHttpServer } from "@effect/platform-node";
import { Layer } from "effect";

const program = Effect.gen(function* (_) {
  // Application logic
});

const main = program.pipe(
  Effect.provide(AppLayer),
  Effect.provide(NodeContext.layer),
);
```

## Data Models

### SessionConnection Types

```typescript
// Already defined in session-connection.ts, adapted for Effect
export interface PostgresSessionConnection {
  readonly dbKind: "postgres";
  readonly userUsedClient: Client;
  readonly backGroundPool: Pool;
  readonly dbForReconnect: GetDbConfigResult;
  readonly eventPushers: Set<(msg: SSEMessage) => void>;
  readonly closeTunnel?: () => Promise<void>;
  readonly cursor?: CursorState;
  readonly keepAliveTimer?: ReturnType<typeof setInterval>;
  readonly runningQueryPid?: number;
}

export interface MysqlSessionConnection {
  readonly dbKind: "mysql" | "mariadb";
  readonly userUsedClient: PoolConnection;
  readonly backGroundPool: MysqlPool;
  readonly dbForReconnect: GetMysqlDbConfigResult;
  readonly eventPushers: Set<(msg: SSEMessage) => void>;
  readonly closeTunnel?: () => Promise<void>;
  readonly keepAliveTimer?: ReturnType<typeof setInterval>;
  readonly mysqlRowStream?: Readable;
  readonly mysqlRunningThreadId?: number;
  readonly mysqlCurrentDatabase?: string;
}

export interface SqlServerSessionConnection {
  readonly dbKind: "sqlserver";
  readonly userUsedClient: MssqlConnectionPool;
  readonly backGroundPool: MssqlConnectionPool;
  readonly dbForReconnect: GetSqlServerDbConfigResult;
  readonly eventPushers: Set<(msg: SSEMessage) => void>;
  readonly closeTunnel?: () => Promise<void>;
  readonly keepAliveTimer?: ReturnType<typeof setInterval>;
  readonly sqlServerRowStream?: SqlServerStreamingQueryHandle;
  readonly sqlServerActiveRequest?: MssqlRequest | null;
}
```

## Error Handling Strategy

### Error Sanitization

所有错误在返回给前端或记录日志时，必须对敏感信息进行脱敏：

```typescript
// backend/core/sanitize.ts

const SENSITIVE_FIELDS = ["password", "apiKey", "secret", "privateKey", "token"];

export const sanitizeHost = (host: string | undefined): string => {
  if (!host) return "(unknown)";
  // Keep structure but mask parts
  const parts = host.split(".");
  if (parts.length > 2) {
    return `${parts[0]}.***.***`;
  }
  return host;
};

export const sanitizeConnectionString = (str: string): string => {
  return str.replace(/:[^:@]+@/, ":***@");
};

export const sanitizeSql = (sql: string): string => {
  // Remove potentially sensitive VALUES clauses
  return sql.replace(/VALUES\s*\([^)]+\)/gi, "VALUES (/***/)");
};

export const sanitizeError = <T extends Record<string, unknown>>(error: T): T => {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (SENSITIVE_FIELDS.some((s) => key.toLowerCase().includes(s))) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      result[key] = value; // Already sanitized by individual functions
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeError(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
};
```

### Error Propagation

```typescript
// Error hierarchy for matching
type BackendError =
  | DatabaseConnectionError
  | QueryExecutionError
  | SshTunnelError
  | AiServiceError
  | StorageError
  | SessionNotFoundError
  | MethodNotFoundError
  | SubscriptionRequiredError;

// Convert to API response
export const errorToApiResponse = (error: BackendError): ApiErrorResponse => {
  const sanitized = sanitizeError(error);
  
  return {
    success: false,
    error: {
      type: error._tag,
      message: error.message,
      ...sanitized,
    },
  };
};
```

## Concurrency Control

### Query Cancellation

```typescript
// backend/adapters/postgres/PostgresQuery.ts
import { Effect, Fiber, Deferred } from "effect";

export const executeCancellableQuery = (
  client: Client,
  sql: string
): Effect.Effect<QueryResult, QueryExecutionError, Scope.Scope> =>
  Effect.gen(function* (_) {
    const cancelDeferred = yield* _(Deferred.make<void>());
    
    const queryFiber = yield* _(
      Effect.async<QueryResult, QueryExecutionError>((resume) => {
        client.query(sql, (err, result) => {
          if (err) {
            resume(Effect.fail(new QueryExecutionError({
              ...makeErrorContext("postgres.query"),
              sql: sanitizeSql(sql),
              databaseErrorCode: err.code,
              databaseErrorMessage: err.message,
            })));
          } else {
            resume(Effect.succeed(result));
          }
        });
      }),
      Effect.fork
    );
    
    // Register cancellation handler
    yield* _(
      Fiber.await(queryFiber),
      Effect.flatMap(() => Deferred.succeed(cancelDeferred, void 0)),
      Effect.fork
    );
    
    // Wait for query or cancellation
    const result = yield* _(
      Effect.race(
        Fiber.join(queryFiber),
        Deferred.await(cancelDeferred).pipe(
          Effect.flatMap(() => Fiber.interrupt(queryFiber))
        )
      )
    );
    
    return result;
  });

// Send PostgreSQL cancellation
export const sendPostgresCancel = (
  client: Client
): Effect.Effect<void, never> =>
  Effect.gen(function* (_) {
    const pid = (client as any).processID;
    if (pid) {
      yield* _(
        Effect.tryPromise({
          try: async () => {
            const cancelClient = new Client(client.connectionParameters);
            await cancelClient.connect();
            await cancelClient.query(`SELECT pg_cancel_backend(${pid})`);
            await cancelClient.end();
          },
          catch: () => void 0,
        }),
        Effect.orElse(() => Effect.void)
      );
    }
  });
```

### Session-level Cancellation

```typescript
// When session disconnects, cancel all active queries
export const cancelSessionQueries = (
  session: SessionConnection
): Effect.Effect<void, never> =>
  Effect.gen(function* (_) {
    if (session.dbKind === "postgres") {
      const pgSession = session as PostgresSessionConnection;
      if (pgSession.runningQueryPid) {
        yield* _(sendPostgresCancel(pgSession.userUsedClient));
      }
      if (pgSession.cursor) {
        yield* _(
          Effect.tryPromise({
            try: () => new Promise<void>((r) => pgSession.cursor!.instance.close(() => r())),
            catch: () => void 0,
          })
        );
      }
    } else if (session.dbKind === "mysql" || session.dbKind === "mariadb") {
      const mysqlSession = session as MysqlSessionConnection;
      if (mysqlSession.mysqlRunningThreadId) {
        yield* _(
          Effect.tryPromise({
            try: async () => {
              await mysqlSession.backGroundPool.query(`KILL QUERY ${mysqlSession.mysqlRunningThreadId}`);
            },
            catch: () => void 0,
          }),
          Effect.orElse(() => Effect.void)
        );
      }
    } else if (session.dbKind === "sqlserver") {
      const sqlServerSession = session as SqlServerSessionConnection;
      if (sqlServerSession.sqlServerActiveRequest) {
        sqlServerSession.sqlServerActiveRequest.cancel();
      }
    }
  });
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Structured Error Types

*For any* error occurring in the backend system, the error SHALL be an instance of a Data.Error subclass with required fields: message, timestamp, and operation context.

**Validates: Requirements 1.1**

### Property 2: Database Connection Error Contains Sanitized Context

*For any* failed database connection attempt, the returned error SHALL be of type `DatabaseConnectionError` containing sanitized connection parameters (host, port, database), error code, and a retry suggestion.

**Validates: Requirements 1.2, 12.5**

### Property 3: Query Execution Error Contains Sanitized SQL

*For any* failed SQL execution, the returned error SHALL be of type `QueryExecutionError` containing sanitized SQL statement, error position (if available), and database error code.

**Validates: Requirements 1.3**

### Property 4: SSH Tunnel Error Contains Diagnostic Context

*For any* failed SSH tunnel creation, the returned error SHALL be of type `SshTunnelError` containing sanitized SSH host, port, and the failure phase (connect, auth, forward).

**Validates: Requirements 1.4, 11.2**

### Property 5: AI Service Error Contains Request Context

*For any* failed AI API request, the returned error SHALL be of type `AiServiceError` containing API mode, model name, HTTP status code, and a retryable flag.

**Validates: Requirements 1.5**

### Property 6: Sensitive Data Redaction

*For any* error containing sensitive data (passwords, API keys, private keys, tokens), the error's log output and JSON serialization SHALL NOT contain the raw sensitive values.

**Validates: Requirements 1.6, 16.5**

### Property 7: Database Connection Lifecycle via Scope

*For any* database connection established through `DatabaseService.connect`, the connection SHALL be automatically closed when the enclosing Scope is released.

**Validates: Requirements 2.1, 12.1, 12.2, 12.3**

### Property 8: SSH Tunnel Closure with Database Connection

*For any* database connection that uses an SSH tunnel, when the database connection is closed, the SSH tunnel SHALL also be closed.

**Validates: Requirements 2.2**

### Property 9: Stream Cleanup on Session End

*For any* active streaming query (cursor or row stream), when the session ends or is cancelled, the stream SHALL be properly closed and resources released.

**Validates: Requirements 2.3**

### Property 10: Keepalive Failure Triggers Reconnect

*For any* active session where keepalive fails, the session SHALL either trigger a reconnection attempt or transition to a disconnected state.

**Validates: Requirements 2.5**

### Property 11: Partial Resource Release Continues

*For any* sequence of resource releases where one release fails, the remaining resources SHALL still be released and the failure SHALL be logged.

**Validates: Requirements 2.6**

### Property 12: Service Interface and Tag Existence

*For each* major functional domain (Database, SSH Tunnel, AI, Connection Store, Query History, Subscription, License), a Service interface and corresponding Tag SHALL be defined.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

### Property 13: Mock Layer Injection

*For any* service interface, a mock implementation SHALL be injectable via Layer for testing purposes.

**Validates: Requirements 3.7, 14.1, 14.2, 14.3, 14.4**

### Property 14: Query Cancellation via Fiber

*For any* running query, calling `Fiber.interrupt` on the query's fiber SHALL cancel the query and release database resources.

**Validates: Requirements 4.1, 4.3**

### Property 15: Database-Specific Cancel Command

*For any* cancelled query, the appropriate database-specific cancel command SHALL be sent: `pg_cancel_backend` for PostgreSQL, `KILL QUERY` for MySQL/MariaDB, or `request.cancel()` for SQL Server.

**Validates: Requirements 4.2**

### Property 16: Session Disconnect Cancels Queries

*For any* session with running queries, when the session disconnects, all running queries SHALL be cancelled.

**Validates: Requirements 4.4**

### Property 17: Cancellation Failure Does Not Block

*For any* query cancellation that fails, the error SHALL be logged and SHALL NOT block other operations.

**Validates: Requirements 4.5**

### Property 18: Configuration via Effect Config

*For all* configuration items (AI, database, SSH, logging), values SHALL be read via Effect's Config module with appropriate defaults.

**Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

### Property 19: SSE Heartbeat Interval

*For any* active SSE connection, a heartbeat comment `: heartbeat` SHALL be sent every 10 seconds.

**Validates: Requirements 6.5**

### Property 20: SSE Client Disconnect Preserves Session

*For any* SSE client disconnect, the subscription SHALL be cleaned but the database session SHALL remain active.

**Validates: Requirements 6.6**

### Property 21: Handler Functions Are Independent Effects

*For each* case branch in database handlers, the handler SHALL be an independent, composable Effect function.

**Validates: Requirements 7.1, 7.2, 7.3**

### Property 22: Unknown Method Returns MethodNotFoundError

*For any* API request with an unrecognized method, the response SHALL be a `MethodNotFoundError`.

**Validates: Requirements 7.5**

### Property 23: File Operations via Effect API

*For any* file read/write operation in storage modules, the operation SHALL use Effect's file system API.

**Validates: Requirements 8.1, 8.2, 10.2**

### Property 24: Connection Config Validation

*For any* connection configuration being saved, required fields (host, username) and data format SHALL be validated.

**Validates: Requirements 8.3**

### Property 25: History Size Limiting

*For any* query history save operation, the history count SHALL be limited and old records SHALL be cleaned.

**Validates: Requirements 8.4**

### Property 26: Storage Error Structure

*For any* file operation failure, the returned error SHALL be of type `StorageError` with file path and operation type.

**Validates: Requirements 8.5**

### Property 27: AI Response Schema Validation

*For any* AI service response, the JSON structure SHALL be validated using Effect Schema.

**Validates: Requirements 9.4**

### Property 28: AI Retry Policy

*For any* AI API request failure, retry SHALL occur only for retryable errors (network errors, 5xx, 429) and not for authentication errors.

**Validates: Requirements 9.3**

### Property 29: SQL Risk Detection

*For any* AI-generated SQL containing high-risk operations (DROP, TRUNCATE, UPDATE/DELETE without WHERE), the response SHALL include appropriate warnings.

**Validates: Requirements 9.5**

### Property 30: Subscription Token Validation

*For any* subscription validation, the JWT token SHALL be parsed and expiration SHALL be checked.

**Validates: Requirements 10.3**

### Property 31: Subscription Error for Invalid Token

*For any* invalid or expired subscription token, the error SHALL be `SubscriptionRequiredError`.

**Validates: Requirements 10.5**

### Property 32: SSH Tunnel Resource Management

*For any* SSH tunnel created via `SshTunnelService`, the tunnel SHALL use the `acquireRelease` pattern ensuring proper cleanup.

**Validates: Requirements 11.1**

### Property 33: SSH Connection Timeout Guidance

*For any* SSH connection timeout, the error message SHALL provide guidance to check jump server configuration.

**Validates: Requirements 11.5**

### Property 34: Pool Size Adjustment for SSH

*For any* database connection pool created with SSH tunnel, the pool size SHALL be smaller (2) than without SSH tunnel (6).

**Validates: Requirements 12.4**

### Property 35: Session Thread Safety via Ref

*For any* session registration or modification, the operation SHALL use Effect's `Ref` for thread safety.

**Validates: Requirements 13.2**

### Property 36: Session Not Found Error

*For any* operation on a non-existent session, the error SHALL be `SessionNotFoundError`.

**Validates: Requirements 13.5**

### Property 37: TestContext Usage

*For all* unit and integration tests, Effect's TestContext SHALL provide test configuration and services.

**Validates: Requirements 14.5**

### Property 38: Structured Logging via Effect Logger

*For all* logging operations, Effect's Logger module SHALL be used instead of `console.log`.

**Validates: Requirements 16.1**

### Property 39: Structured Error Log Format

*For any* error log entry, the log SHALL contain structured error information, context, and timestamp.

**Validates: Requirements 16.2**

### Property 40: Log Level Environment Control

*For the* logging system, the log level SHALL be controllable via the `LOG_LEVEL` environment variable (DEBUG, INFO, WARN, ERROR).

**Validates: Requirements 16.4**

### Property 41: Concurrent Request Optimization

*For any* high-concurrency request handling, Effect's concurrency primitives (`Effect.forEach`, `Semaphore`) SHALL be used to optimize throughput.

**Validates: Requirements 17.3**

### Property 42: Batch Operation Concurrency Control

*For any* batch operation (import rows, bulk update), Effect's concurrency control SHALL prevent resource exhaustion.

**Validates: Requirements 17.4**

## Migration Strategy

### Phase 1: Core Infrastructure (Week 1-2)

1. Create error type hierarchy (`core/errors.ts`)
2. Define configuration schemas (`core/config.ts`)
3. Create base service interfaces (`services/*.ts`)
4. Set up structured logging

### Phase 2: Database Adapters (Week 2-3)

1. Refactor `connect-postgres.ts` with Effect
2. Refactor `connect-mysql.ts` with Effect
3. Refactor `connect-sqlserver.ts` with Effect
4. Implement `DatabaseService` Layer

### Phase 3: Session Runtime (Week 3)

1. Extend `effect-session-runtime.ts`
2. Implement `withSessionScope` with proper resource management
3. Add fiber-based cancellation

### Phase 4: API Handlers (Week 3-4)

1. Convert PostgreSQL handlers to independent Effect functions
2. Convert MySQL handlers to independent Effect functions
3. Convert SQL Server handlers to independent Effect functions
4. Implement Effect-based routing

### Phase 5: Support Services (Week 4)

1. Refactor SSH tunnel with `acquireRelease`
2. Refactor AI service with retry and schema validation
3. Refactor storage services with Effect file operations
4. Refactor subscription/license services

### Phase 6: Testing & Documentation (Week 5)

1. Create mock services for all interfaces
2. Write unit tests with TestContext
3. Write integration tests
4. Document API changes and migration guide

## Performance Considerations

### Connection Pooling

- PostgreSQL: Use `pg.Pool` with Effect's acquireRelease
- MySQL: Use `mysql2.Pool` with proper cleanup
- SQL Server: Use `mssql.ConnectionPool` with scope management

### Memory Management

- Stream large result sets instead of buffering
- Use Effect's `Stream` for query results
- Implement backpressure for high-volume operations

### Concurrency

- Use `Effect.forEach` with `concurrency` option for parallel operations
- Use `Semaphore` for rate limiting external API calls
- Use `Ref` for thread-safe state management

### Cancellation

- Propagate `AbortSignal` through Effect's interruption mechanism
- Send database-specific cancel commands on Fiber interrupt
- Clean up resources in reverse dependency order

## Security Considerations

### Credential Handling

- Never log raw passwords, API keys, or private keys
- Use `Secret` type from Effect for sensitive values
- Sanitize error messages before sending to client

### Input Validation

- Use Effect Schema for all incoming data validation
- Validate SQL before execution (prevent SQL injection via AI)
- Validate connection parameters before attempting connection

### Resource Limits

- Limit connection pool sizes
- Limit query result set sizes
- Implement timeouts for all external operations

## References

- [Effect TS Documentation](https://effect.website/)
- [Effect Schema](https://effect.website/docs/schema/introduction/)
- [Effect Context & Layer](https://effect.website/docs/context/introduction/)
- [Effect Resource Management](https://effect.website/docs/resource-management/)
- Existing `effect-session-runtime.ts` as reference for current patterns
