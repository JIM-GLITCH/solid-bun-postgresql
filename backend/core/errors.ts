import { Data } from "effect";

// ===== Base Error Context =====

/**
 * Common context included in all structured errors
 */
export interface ErrorContext {
  readonly timestamp: number;
  readonly correlationId?: string;
  readonly operation: string;
}

/**
 * Helper to create a standard ErrorContext
 */
export const makeErrorContext = (
  operation: string,
  correlationId?: string
): ErrorContext => ({
  timestamp: Date.now(),
  correlationId,
  operation,
});

// ===== Database Errors =====

/**
 * Raised when a database connection cannot be established.
 * Sensitive fields (host, database) should be sanitized before logging.
 *
 * Validates: Requirement 1.2
 */
export class DatabaseConnectionError extends Data.TaggedError(
  "DatabaseConnectionError"
)<{
  readonly context: ErrorContext;
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly errorCode?: string;
  readonly retrySuggestion?: string;
}> {
  get message() {
    const suggestion = this.retrySuggestion ? ` — ${this.retrySuggestion}` : "";
    return `Database connection failed: ${this.database}@${this.host}:${this.port}${suggestion}`;
  }
}

/**
 * Raised when a SQL query fails during execution.
 * The sql field should be sanitized before logging.
 *
 * Validates: Requirement 1.3
 */
export class QueryExecutionError extends Data.TaggedError(
  "QueryExecutionError"
)<{
  readonly context: ErrorContext;
  readonly sql: string;
  readonly position?: number;
  readonly databaseErrorCode?: string;
  readonly databaseErrorMessage?: string;
}> {
  get message() {
    const preview =
      this.sql.length > 100 ? `${this.sql.substring(0, 100)}…` : this.sql;
    const pos = this.position !== undefined ? ` at position ${this.position}` : "";
    const code = this.databaseErrorCode ? ` [${this.databaseErrorCode}]` : "";
    return `Query execution failed${pos}${code}: ${preview}`;
  }
}

// ===== SSH Tunnel Errors =====

/**
 * Raised when the SSH tunnel fails at any phase.
 * sshHost should be sanitized before logging.
 *
 * Validates: Requirement 1.4
 */
export class SshTunnelError extends Data.TaggedError("SshTunnelError")<{
  readonly context: ErrorContext;
  readonly sshHost: string;
  readonly sshPort: number;
  readonly phase: "connect" | "auth" | "forward" | "unknown";
}> {
  get message() {
    const phaseLabel =
      this.phase === "connect"
        ? "connection"
        : this.phase === "auth"
          ? "authentication"
          : this.phase === "forward"
            ? "port forwarding"
            : "tunnel";
    return `SSH ${phaseLabel} failed: ${this.sshHost}:${this.sshPort}`;
  }
}

// ===== AI Service Errors =====

/**
 * Raised when the AI service returns an error or an unexpected response.
 *
 * Validates: Requirement 1.5
 */
export class AiServiceError extends Data.TaggedError("AiServiceError")<{
  readonly context: ErrorContext;
  readonly apiMode: string;
  readonly model: string;
  readonly httpStatus?: number;
  readonly retryable: boolean;
}> {
  get message() {
    const status = this.httpStatus ? ` (HTTP ${this.httpStatus})` : "";
    const retry = this.retryable ? " [retryable]" : " [non-retryable]";
    return `AI service error [${this.apiMode}] model=${this.model}${status}${retry}`;
  }
}

// ===== Storage Errors =====

/**
 * Raised when a file-system storage operation fails.
 */
export class StorageError extends Data.TaggedError("StorageError")<{
  readonly context: ErrorContext;
  readonly filePath: string;
  readonly operation: "read" | "write" | "delete";
}> {
  get message() {
    return `Storage ${this.operation} failed: ${this.filePath}`;
  }
}

// ===== Session Errors =====

/**
 * Raised when an operation references a session that does not exist.
 *
 * Validates: Requirement 13.5
 */
export class SessionNotFoundError extends Data.TaggedError(
  "SessionNotFoundError"
)<{
  readonly context: ErrorContext;
  readonly sessionId: string;
}> {
  get message() {
    return `Session not found: ${this.sessionId}`;
  }
}

// ===== API Errors =====

/**
 * Raised when a request arrives for an unregistered API method.
 *
 * Validates: Requirement 7.5
 */
export class MethodNotFoundError extends Data.TaggedError(
  "MethodNotFoundError"
)<{
  readonly context: ErrorContext;
  readonly method: string;
}> {
  get message() {
    return `Method not found: ${this.method}`;
  }
}

/**
 * Raised when a feature requires an active subscription and none is present.
 *
 * Validates: Requirement 10.5
 */
export class SubscriptionRequiredError extends Data.TaggedError(
  "SubscriptionRequiredError"
)<{
  readonly context: ErrorContext;
  readonly feature: string;
}> {
  get message() {
    return `Subscription required to use feature: ${this.feature}`;
  }
}

// ===== Union type =====

/**
 * Union of all backend-layer errors.
 * Use this as the error channel type in Effect signatures.
 */
export type BackendError =
  | DatabaseConnectionError
  | QueryExecutionError
  | SshTunnelError
  | AiServiceError
  | StorageError
  | SessionNotFoundError
  | MethodNotFoundError
  | SubscriptionRequiredError;
