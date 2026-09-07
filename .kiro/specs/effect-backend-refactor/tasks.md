# Implementation Plan: Effect TS Backend Refactor

## Overview

This plan transforms the `backend/` directory's 24 TypeScript modules into a fully Effect TS-based architecture. The implementation follows a layered approach: Core Infrastructure → Services → Adapters → API Layer → Testing. All tasks reference specific requirements from the requirements document and correctness properties from the design document.

## Tasks

### Phase 1: Core Infrastructure

- [ ] 1. Set up core error types and configuration
  - [x] 1.1 Create `backend/core/errors.ts` with structured error type hierarchy
    - Define base `ErrorContext` interface with timestamp, correlationId, operation
    - Implement `DatabaseConnectionError`, `QueryExecutionError`, `SshTunnelError`
    - Implement `AiServiceError`, `StorageError`, `SessionNotFoundError`
    - Implement `MethodNotFoundError`, `SubscriptionRequiredError`
    - Each error extends `Data.Error` with proper tag and message getter
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  
  - [ ]* 1.2 Write property tests for error type structure
    - **Property 1: Structured Error Types** — All errors have message, timestamp, operation
    - **Property 6: Sensitive Data Redaction** — Errors don't leak sensitive data
    - _Validates: Requirements 1.1, 1.6_

  - [x] 1.3 Create `backend/core/config.ts` with Effect Config definitions
    - Define `AiConfig` with apiMode, baseUrl, model, temperature, maxTokens
    - Define `DatabaseConfig` with connectionTimeoutMs, idleTimeoutMs, poolMaxSize
    - Define `SshConfig` with defaultTimeoutMs, debugMode
    - Define `LogConfig` with level, format
    - All configs use `Config.withDefault` for fallback values
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.4 Create `backend/core/sanitize.ts` for data sanitization
    - Implement `sanitizeHost()` — masks host parts
    - Implement `sanitizeConnectionString()` — removes credentials from URIs
    - Implement `sanitizeSql()` — removes sensitive VALUES clauses
    - Implement `sanitizeError()` — recursive sanitization for error objects
    - _Requirements: 1.6, 16.5_

  - [x] 1.5 Create `backend/core/logger.ts` with structured logging
    - Implement `structuredLogger` using Effect's `Logger.make`
    - Support JSON and text output formats
    - Integrate with `LogConfig` for level control
    - Auto-sanitize sensitive fields in log entries
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

- [ ] 2. Checkpoint — Core infrastructure validation
  - Ensure all error types compile and have proper structure
  - Verify config loading works with environment variables
  - Test sanitization functions with sample data
  - Ensure logger outputs in correct format

### Phase 2: Service Interfaces

- [ ] 3. Create service interfaces and Tags
  - [x] 3.1 ~~Create `backend/services/DatabaseService.ts`~~ — 已按计划 D2 废弃删除：db/* 由 routes/db.ts 直接分派到各 Adapter handlers，会话经 SessionStore + ConnectionId Context 访问，不再需要 DatabaseService Facade。`ConnectParams` 迁移至 `backend/adapters/shared/types.ts`。
    - Define `DatabaseService` interface with connect, disconnect, query, queryStream, cancel methods
    - Define `DatabaseService` Tag using `Context.GenericTag`
    - Define `ConnectParams`, `QueryResult`, `StreamResult` types
    - _Requirements: 3.2_
  
  - [x] 3.2 Create `backend/services/SshTunnelService.ts`
    - Define `SshTunnelService` interface with createTunnel, closeTunnel methods
    - Define `SshTunnelService` Tag
    - Define `TunnelResult` type with localPort and close function
    - _Requirements: 3.3_

  - [x] 3.3 Create `backend/services/AiService.ts`
    - Define `AiService` interface with executeSqlEdit, validateConfig methods
    - Define `AiService` Tag
    - Define `AiResponseSchema` using Effect Schema for validation
    - Define `AiSqlEditParams`, `AiSqlEditResult` types
    - _Requirements: 3.4_

  - [x] 3.4 Create `backend/services/ConnectionStoreService.ts`
    - Define `ConnectionStoreService` interface with list, save, get, remove, updateMeta methods
    - Define `ConnectionStoreService` Tag
    - Define `ConnectionEntry`, `ConnectionMeta` types
    - _Requirements: 3.5_

  - [x] 3.5 Create `backend/services/QueryHistoryService.ts`
    - Define `QueryHistoryService` interface with add, list, clear methods
    - Define `QueryHistoryService` Tag
    - Define `QueryHistoryEntry` type with timestamp, sql, connectionId
    - _Requirements: 3.5_

  - [x] 3.6 Create `backend/services/AiKeyStoreService.ts`
    - Define `AiKeyStoreService` interface with get, set, delete methods
    - Define `AiKeyStoreService` Tag
    - _Requirements: 3.5_

  - [x] 3.7 Create `backend/services/SubscriptionService.ts`
    - Define `SubscriptionService` interface with validateToken, getAccount, assertFeature methods
    - Define `SubscriptionService` Tag
    - Define `SubscriptionStatus`, `AccountInfo` types
    - _Requirements: 3.6_

  - [x] 3.8 Create `backend/services/LicenseService.ts`
    - Define `LicenseService` interface with validate, checkFeature methods
    - Define `LicenseService` Tag
    - _Requirements: 3.6_

  - [ ]* 3.9 Write property tests for service interfaces
    - **Property 12: Service Interface and Tag Existence** — All services have interfaces and Tags
    - _Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [ ] 4. Checkpoint — Service interfaces validation
  - Ensure all service interfaces compile correctly
  - Verify Tags are properly defined
  - Ensure type definitions match existing shared types

### Phase 3: Database Adapters

- [ ] 5. Implement PostgreSQL adapter with Effect
  - [x] 5.1 Create `backend/adapters/postgres/PostgresAdapter.ts`
    - Implement `makePostgresConnection` using `Effect.acquireRelease`
    - Handle SSH tunnel dependency through `SshTunnelService`
    - Return `PostgresConnection` with client, pool, closeTunnel
    - Apply pool size adjustment for SSH (2 vs 6)
    - _Requirements: 2.1, 12.1_
  
  - [ ]* 5.2 Write property tests for PostgreSQL connection lifecycle
    - **Property 7: Database Connection Lifecycle via Scope** — Connections close on scope release
    - **Property 8: SSH Tunnel Closure with Database Connection** — Tunnels close with connections
    - **Property 34: Pool Size Adjustment for SSH** — Pool size differs for SSH connections
    - _Validates: Requirements 2.1, 2.2, 12.4_

  - [x] 5.3 Create `backend/adapters/postgres/PostgresPool.ts`
    - Implement pool creation with Effect's acquireRelease
    - Handle connection errors with `DatabaseConnectionError`
    - Implement pool health checks
    - _Requirements: 12.1_

  - [x] 5.4 Create `backend/adapters/postgres/PostgresHandlers.ts`
    - Extract each case from `postgres-db-handlers.ts` into independent Effect functions
    - Implement `handlePostgresConnect`, `handlePostgresDisconnect`
    - Implement `handlePostgresQuery`, `handlePostgresQueryStream`
    - Implement `handlePostgresCancel`, `handlePostgresGetTables`
    - All handlers return typed Effects
    - _Requirements: 7.1_

  - [ ] 5.5 Implement cancellable query execution
    - Use `Fiber` and `Deferred` for query cancellation
    - Implement `sendPostgresCancel` with `pg_cancel_backend`
    - Handle stream cleanup on cancellation
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.6 Write property tests for PostgreSQL cancellation
    - **Property 14: Query Cancellation via Fiber** — Fiber interrupt cancels queries
    - **Property 15: Database-Specific Cancel Command** — Uses pg_cancel_backend
    - **Property 17: Cancellation Failure Does Not Block** — Failed cancel doesn't block
    - _Validates: Requirements 4.1, 4.2, 4.5_

- [ ] 6. Implement MySQL/MariaDB adapter with Effect
  - [x] 6.1 Create `backend/adapters/mysql/MysqlAdapter.ts`
    - Implement `makeMysqlConnection` using `Effect.acquireRelease`
    - Handle SSH tunnel dependency
    - Return `MysqlConnection` with pool, connection
    - _Requirements: 2.1, 12.2_
  
  - [ ]* 6.2 Write property tests for MySQL connection lifecycle
    - **Property 7: Database Connection Lifecycle via Scope** — Connections close on scope release
    - _Validates: Requirements 2.1, 12.2_

  - [x] 6.3 Create `backend/adapters/mysql/MysqlPool.ts`
    - Implement `mysql2.Pool` creation with Effect
    - Handle connection errors with `DatabaseConnectionError`
    - _Requirements: 12.2_

  - [x] 6.4 Create `backend/adapters/mysql/MysqlHandlers.ts`
    - Extract each case from `mysql-db-handlers.ts` into independent Effect functions
    - Implement all MySQL-specific handlers
    - _Requirements: 7.2_

  - [ ] 6.5 Implement MySQL query cancellation
    - Use `KILL QUERY` with thread ID
    - Handle stream cleanup for `mysqlRowStream`
    - _Requirements: 4.2, 4.3_

- [ ] 7. Implement SQL Server adapter with Effect
  - [x] 7.1 Create `backend/adapters/sqlserver/SqlServerAdapter.ts`
    - Implement `makeSqlServerConnection` using `Effect.acquireRelease`
    - Handle SSH tunnel dependency
    - Return `SqlServerConnection` with pool
    - _Requirements: 2.1, 12.3_
  
  - [ ]* 7.2 Write property tests for SQL Server connection lifecycle
    - **Property 7: Database Connection Lifecycle via Scope** — Connections close on scope release
    - _Validates: Requirements 2.1, 12.3_

  - [x] 7.3 Create `backend/adapters/sqlserver/SqlServerPool.ts`
    - Implement `mssql.ConnectionPool` creation with Effect
    - Handle connection errors with `DatabaseConnectionError`
    - _Requirements: 12.3_

  - [x] 7.4 Create `backend/adapters/sqlserver/SqlServerHandlers.ts`
    - Extract each case from `sqlserver-db-handlers.ts` into independent Effect functions
    - Implement all SQL Server-specific handlers
    - _Requirements: 7.3_

  - [ ] 7.5 Implement SQL Server query cancellation
    - Use `request.cancel()` method
    - Handle stream cleanup for `sqlServerRowStream`
    - _Requirements: 4.2, 4.3_

- [ ] 8. Checkpoint — Database adapters validation
  - Test connections to all three database types
  - Verify resource cleanup on scope release
  - Test query cancellation for each database

### Phase 4: Session Runtime

- [ ] 9. Extend session runtime with Effect
  - [x] 9.1 Refactor `backend/runtime/SessionRuntime.ts`
    - Extend existing `effect-session-runtime.ts` with full Effect patterns
    - Implement `createSessionRegistry` using `Ref`
    - Use `Ref` for thread-safe session storage
    - _Requirements: 13.2_
  
  - [ ]* 9.2 Write property tests for session thread safety
    - **Property 35: Session Thread Safety via Ref** — All operations use Ref
    - _Validates: Requirements 13.2_

  - [ ] 9.3 Implement `withSessionScope` function
    - Use `Effect.acquireRelease` for session-scoped operations
    - Ensure resource cleanup on completion or failure
    - Return `SessionNotFoundError` for missing sessions
    - _Requirements: 2.4, 13.1, 13.4_

  - [ ] 9.4 Implement session-level query cancellation
    - Track running query fibers per session
    - Cancel all fibers on session disconnect
    - Handle cancellation failures gracefully
    - _Requirements: 4.4_

  - [ ]* 9.5 Write property tests for session lifecycle
    - **Property 9: Stream Cleanup on Session End** — Streams close on session end
    - **Property 16: Session Disconnect Cancels Queries** — All queries cancelled
    - **Property 36: Session Not Found Error** — Returns proper error type
    - _Validates: Requirements 2.3, 4.4, 13.5_

  - [x] 9.6 Implement keepalive mechanism
    - Fork keepalive fiber for each session
    - Handle keepalive failures (reconnect or disconnect)
    - Track fibers for cancellation
    - _Requirements: 2.5_

  - [ ]* 9.7 Write property tests for keepalive
    - **Property 10: Keepalive Failure Triggers Reconnect** — Handles failure correctly
    - _Validates: Requirements 2.5_

- [ ] 10. Checkpoint — Session runtime validation
  - Test session registration and unregistration
  - Verify fiber cancellation works
  - Test keepalive behavior

### Phase 5: SSH Tunnel Service

- [ ] 11. Implement SSH tunnel service with Effect
  - [x] 11.1 Create `backend/ssh/SshTunnel.ts`
    - Implement `createSshTunnel` using `Effect.acquireRelease`
    - Handle all phases: connect, auth, forward
    - Return structured `SshTunnelError` on failure
    - _Requirements: 11.1, 11.2_
  
  - [ ]* 11.2 Write property tests for SSH tunnel lifecycle
    - **Property 32: SSH Tunnel Resource Management** — Uses acquireRelease
    - **Property 4: SSH Tunnel Error Contains Diagnostic Context** — Error has phase info
    - _Validates: Requirements 11.1, 11.2, 1.4_

  - [x] 11.3 Implement `SshTunnelServiceLive` Layer
    - Create Layer with SSH config dependency
    - Support debug mode logging
    - _Requirements: 11.3_

  - [ ] 11.4 Implement timeout guidance for SSH errors
    - Provide clear error messages for connection timeouts
    - Guide users to check jump server configuration
    - _Requirements: 11.4, 11.5_

  - [ ]* 11.5 Write property tests for SSH error messages
    - **Property 33: SSH Connection Timeout Guidance** — Error provides guidance
    - _Validates: Requirements 11.5_

- [ ] 12. Checkpoint — SSH tunnel validation
  - Test SSH tunnel creation and cleanup
  - Verify error handling for all failure phases
  - Test integration with database connections

### Phase 6: Storage Services

- [ ] 13. Implement storage services with Effect
  - [x] 13.1 Create `backend/storage/FileStorage.ts`
    - Implement Effect-based file read/write operations
    - Use `Effect.tryPromise` for Node.js fs operations
    - Return `StorageError` on failures
    - _Requirements: 8.1, 8.2_
  
  - [x] 13.2 Create `backend/storage/stores/ConnectionStoreServiceImpl.ts`
    - Implement `ConnectionStoreService` interface
    - Validate connection parameters before saving
    - Implement atomic file writes
    - _Requirements: 8.3_

  - [ ]* 13.3 Write property tests for connection store
    - **Property 23: File Operations via Effect API** — Uses Effect file API
    - **Property 24: Connection Config Validation** — Validates required fields
    - **Property 26: Storage Error Structure** — Returns StorageError type
    - _Validates: Requirements 8.1, 8.3, 8.5_

  - [x] 13.4 Create `backend/storage/stores/QueryHistoryServiceImpl.ts`
    - Implement `QueryHistoryService` interface
    - Limit history size and clean old records
    - _Requirements: 8.4_

  - [ ]* 13.5 Write property tests for query history
    - **Property 25: History Size Limiting** — History is bounded
    - _Validates: Requirements 8.4_

  - [x] 13.6 Create `backend/storage/stores/AiKeyStoreServiceImpl.ts`
    - Implement secure key storage with file encryption
    - Use Effect file operations
    - _Requirements: 8.1_

- [ ] 14. Checkpoint — Storage services validation
  - Test file read/write operations
  - Verify validation logic
  - Test history size limits

### Phase 7: AI Service

- [ ] 15. Implement AI service with Effect
  - [x] 15.1 Create `backend/services/AiServiceImpl.ts`
    - Implement `AiServiceLive` Layer
    - Use Effect's HTTP client (or wrapped fetch)
    - Parse SSE stream responses
    - _Requirements: 9.1, 9.2_
  
  - [ ] 15.2 Implement retry policy for AI requests
    - Retry on network errors, 5xx, 429
    - No retry on authentication errors
    - Use exponential backoff
    - _Requirements: 9.3_

  - [ ]* 15.3 Write property tests for AI retry
    - **Property 28: AI Retry Policy** — Retries only on retryable errors
    - _Validates: Requirements 9.3_

  - [ ] 15.4 Implement AI response validation
    - Use Effect Schema to validate JSON structure
    - Return `AiServiceError` on validation failure
    - _Requirements: 9.4_

  - [ ]* 15.5 Write property tests for AI validation
    - **Property 27: AI Response Schema Validation** — Validates with Schema
    - _Validates: Requirements 9.4_

  - [x] 15.6 Implement SQL risk detection
    - Detect DROP, TRUNCATE, unsafe UPDATE/DELETE
    - Add warnings to response
    - _Requirements: 9.5_

  - [ ]* 15.7 Write property tests for SQL risk detection
    - **Property 29: SQL Risk Detection** — Flags risky operations
    - _Validates: Requirements 9.5_

- [ ] 16. Checkpoint — AI service validation
  - Test API calls to AI endpoints
  - Verify retry behavior
  - Test schema validation
  - Verify risk detection

### Phase 8: Subscription Services

- [ ] 17. Implement subscription and license services
  - [x] 17.1 Create `backend/services/SubscriptionServiceImpl.ts`
    - Implement JWT token parsing and validation
    - Use Effect HTTP client for API calls
    - Return `SubscriptionRequiredError` for invalid tokens
    - _Requirements: 10.1, 10.3, 10.5_
  
  - [ ]* 17.2 Write property tests for subscription validation
    - **Property 30: Subscription Token Validation** — Validates JWT properly
    - **Property 31: Subscription Error for Invalid Token** — Returns proper error
    - _Validates: Requirements 10.3, 10.5_

  - [ ] 17.3 Implement caching for subscription status
    - Cache validation results locally
    - Use cached result when API unavailable
    - _Requirements: 10.4_

  - [x] 17.4 Create `backend/services/LicenseServiceImpl.ts`
    - Implement license validation logic
    - Check feature availability
    - _Requirements: 10.3_

- [ ] 18. Checkpoint — Subscription services validation
  - Test JWT parsing
  - Verify API integration
  - Test caching behavior

### Phase 9: API Layer

- [ ] 19. Refactor API core and handlers
  - [x] 19.1 Create `backend/api/routes/db.ts`
    - Implement all `db/*` route handlers as independent Effect functions
    - Use `handleDbConnect`, `handleDbDisconnect`, `handleDbQuery`, etc.
    - _Requirements: 7.1, 7.2, 7.3_
  
  - [ ]* 19.2 Write property tests for handler structure
    - **Property 21: Handler Functions Are Independent Effects** — Each handler is composable
    - _Validates: Requirements 7.1, 7.2, 7.3_

  - [x] 19.3 Create `backend/api/routes/connections.ts`
    - Implement `connections/*` route handlers
    - _Requirements: 8.1_

  - [x] 19.4 Create `backend/api/routes/ai.ts`
    - Implement AI-related route handlers
    - _Requirements: 9.1_

  - [x] 19.5 Refactor `backend/api/ApiCore.ts`
    - Implement `routeApiRequest` function
    - Route to appropriate handler based on method
    - Return `MethodNotFoundError` for unknown methods
    - _Requirements: 7.4, 7.5_

  - [ ]* 19.6 Write property tests for API routing
    - **Property 22: Unknown Method Returns MethodNotFoundError** — Returns proper error
    - _Validates: Requirements 7.5_

  - [x] 19.7 Create `backend/api/middleware/logging.ts`
    - Implement logging middleware for all API calls
    - Use structured logging
    - _Requirements: 16.2, 16.3_

  - [x] 19.8 Create `backend/api/sse.ts`
    - Implement `SseEventBus` with Effect Hub
    - Support per-connection subscriptions
    - Implement heartbeat mechanism
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ]* 19.9 Write property tests for SSE
    - **Property 19: SSE Heartbeat Interval** — Sends heartbeat every 10s
    - **Property 20: SSE Client Disconnect Preserves Session** — Session stays active
    - _Validates: Requirements 6.5, 6.6_

- [ ] 20. Checkpoint — API layer validation
  - Test all routes work correctly
  - Verify error handling
  - Test SSE push mechanism

### Phase 10: Layer Composition

- [ ] 21. Compose application layers
  - [x] 21.1 Create `backend/runtime/layers.ts`
    - Define `ProductionLayers` merging all service implementations
    - Define `DatabaseLayer` with SSH tunnel dependency
    - Define `AppLayer` for full application
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 21.2 Update entry points to use Layer composition
    - Modify `api-handlers-http.ts` to use Layer.provide
    - Modify `api-handlers-vscode.ts` to use Layer.provide
    - Ensure all services are properly provided

- [ ] 22. Checkpoint — Layer composition validation
  - Verify all services are properly wired
  - Test application startup
  - Verify dependency injection works

### Phase 11: Test Infrastructure

- [ ] 23. Create test infrastructure
  - [x] 23.1 ~~Create `backend/test/mocks/MockDatabaseService.ts`~~ — 已按计划 D3 替换为 `backend/test/mocks/MockSessionStore.ts`（直接 mock SessionStoreShape）。
    - Implement mock `DatabaseService` with configurable behavior
    - Support connection simulation
    - _Requirements: 14.1, 14.2_
  
  - [x] 23.2 Create `backend/test/mocks/MockSshTunnelService.ts`
    - Implement mock `SshTunnelService`
    - _Requirements: 14.3_

  - [x] 23.3 Create `backend/test/mocks/MockAiService.ts`
    - Implement mock `AiService`
    - Support configurable responses
    - _Requirements: 14.4_

  - [x] 23.4 Create `backend/test/mocks/MockStorageServices.ts`
    - Implement mock storage services
    - Support in-memory storage
    - _Requirements: 14.1_

  - [x] 23.5 Create `backend/test/TestContext.ts`
    - Define `TestLayer` combining all mocks
    - Implement `runTest` helper function
    - Provide test configuration
    - _Requirements: 14.5_

  - [ ]* 23.6 Write property tests for test infrastructure
    - **Property 13: Mock Layer Injection** — Mocks can be injected via Layer
    - **Property 37: TestContext Usage** — Tests use TestContext
    - _Validates: Requirements 3.7, 14.5_

- [ ] 24. Checkpoint — Test infrastructure validation
  - Verify all mocks work correctly
  - Test Layer injection
  - Run sample tests

### Phase 12: Frontend Integration

- [ ] 25. Update frontend API client
  - [ ] 25.1 Update `frontend/api.ts` type definitions
    - Update error type definitions to match backend
    - Add new error types (DatabaseConnectionError, etc.)
    - _Requirements: 15.4_

  - [ ] 25.2 Update error handling in frontend
    - Handle new error types
    - Display user-friendly error messages
    - _Requirements: 15.1, 15.2_

  - [ ] 25.3 Create API migration documentation
    - Document error format changes
    - Document SSE message format (unchanged)
    - List any breaking changes
    - _Requirements: 15.3, 15.5_

- [ ] 26. Checkpoint — Frontend integration validation
  - Test frontend with new backend
  - Verify error handling
  - Check SSE messages display correctly

### Phase 13: Performance and Logging

- [ ] 27. Implement performance optimizations
  - [ ] 27.1 Implement concurrent request handling
    - Use `Effect.forEach` with concurrency options
    - Use `Semaphore` for rate limiting
    - _Requirements: 17.3_
  
  - [ ]* 27.2 Write property tests for concurrency
    - **Property 41: Concurrent Request Optimization** — Uses Effect concurrency
    - **Property 42: Batch Operation Concurrency Control** — Prevents exhaustion
    - _Validates: Requirements 17.3, 17.4_

  - [ ] 27.3 Implement batch operation concurrency control
    - Use Effect's concurrency primitives
    - Prevent resource exhaustion
    - _Requirements: 17.4_

- [ ] 28. Final logging implementation
  - [ ] 28.1 Replace all `console.log` with Effect Logger
    - Update all backend modules
    - Use structured logging
    - _Requirements: 16.1_

  - [ ] 28.2 Add correlation IDs to logs
    - Propagate correlation IDs through request chain
    - Include in error logs
    - _Requirements: 16.2_

  - [ ]* 28.3 Write property tests for logging
    - **Property 38: Structured Logging via Effect Logger** — Uses Effect Logger
    - **Property 39: Structured Error Log Format** — Has proper structure
    - **Property 40: Log Level Environment Control** — Controlled by env var
    - _Validates: Requirements 16.1, 16.2, 16.4_

- [ ] 29. Final checkpoint — Complete validation
  - Run all property tests
  - Run all unit tests
  - Run integration tests
  - Verify performance metrics meet thresholds
  - _Requirements: 17.1, 17.2_

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- The design uses TypeScript; all code examples should be in TypeScript

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.2", "3.1", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8"] },
    { "id": 2, "tasks": ["3.9", "5.1", "6.1", "7.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "5.4", "5.5", "6.2", "6.3", "6.4", "6.5", "7.2", "7.3", "7.4", "7.5", "9.1", "11.1"] },
    { "id": 4, "tasks": ["5.6", "9.2", "9.3", "9.4", "9.6", "11.2", "11.3", "11.4"] },
    { "id": 5, "tasks": ["9.5", "9.7", "11.5", "13.1", "13.2", "13.4", "13.6"] },
    { "id": 6, "tasks": ["13.3", "13.5", "15.1", "15.2", "15.4", "15.6", "17.1", "17.3", "17.4"] },
    { "id": 7, "tasks": ["15.3", "15.5", "15.7", "17.2", "19.1", "19.3", "19.4", "19.5", "19.7", "19.8"] },
    { "id": 8, "tasks": ["19.2", "19.6", "19.9", "21.1", "21.2", "23.1", "23.2", "23.3", "23.4", "23.5"] },
    { "id": 9, "tasks": ["23.6", "25.1", "25.2", "25.3", "27.1", "27.3", "28.1", "28.2"] },
    { "id": 10, "tasks": ["27.2", "28.3"] }
  ]
}
```
