/**
 * Data sanitization utilities for masking sensitive information in logs and error reports.
 * Pure TypeScript — no Effect dependencies.
 */

/** Lowercase keywords used to identify sensitive fields */
export const SENSITIVE_KEYS = [
  "password",
  "apikey",
  "secret",
  "privatekey",
  "token",
  "passwd",
  "credential",
  "auth",
] as const;

/**
 * Masks a hostname for safe logging.
 * - undefined / empty → "(unknown)"
 * - IP addresses (e.g. 192.168.1.1) → returned as-is
 * - Multi-part domain (e.g. db.example.com) → first segment + ".***.***"
 * - Simple hostname → returned as-is
 */
export function sanitizeHost(host: string | undefined): string {
  if (!host) return "(unknown)";

  // IP address — all segments are numeric
  const ipPattern = /^\d{1,3}(\.\d{1,3}){3}$/;
  if (ipPattern.test(host)) return host;

  const parts = host.split(".");
  if (parts.length > 1) {
    return `${parts[0]}.***.***`;
  }

  // Simple hostname (no dots)
  return host;
}

/**
 * Removes credentials from a URI connection string.
 * e.g. "postgres://user:s3cr3t@host/db" → "postgres://user:***@host/db"
 */
export function sanitizeConnectionString(str: string): string {
  // Matches :password@ in URIs, keeping the username portion intact
  return str.replace(/:([^:@/\s]+)@/g, ":***@");
}

/**
 * Redacts literal values inside SQL VALUES clauses.
 * e.g. "INSERT INTO t VALUES ('foo', 42)" → "INSERT INTO t VALUES (***)"
 */
export function sanitizeSql(sql: string): string {
  return sql.replace(/VALUES\s*\([^)]*\)/gi, "VALUES (***)");
}

/**
 * Returns true if the given key name contains a sensitive keyword.
 */
function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((k) => lower.includes(k));
}

/**
 * Recursively walks an object, replacing values whose key matches a sensitive
 * keyword with "[REDACTED]". Arrays are walked element-by-element.
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key];

    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item !== null && typeof item === "object"
          ? sanitizeObject(item as Record<string, unknown>)
          : item
      );
    } else if (value !== null && typeof value === "object") {
      result[key] = sanitizeObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

/**
 * Converts an unknown error value to a plain object and sanitizes it.
 */
export function sanitizeError(error: unknown): Record<string, unknown> {
  let plain: Record<string, unknown>;

  if (error instanceof Error) {
    plain = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  } else if (error !== null && typeof error === "object") {
    plain = { ...(error as Record<string, unknown>) };
  } else {
    plain = { error: String(error) };
  }

  return sanitizeObject(plain);
}
