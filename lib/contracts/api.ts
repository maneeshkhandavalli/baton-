/**
 * Shared result and error shapes (docs/architecture/shared-contracts.md §3.2).
 *
 * Every server action and route handler returns `Result<T>` and never throws across the
 * client boundary. Raw database, provider or stack-trace details never appear in `AppError`.
 */

export const ERROR_CODES = [
  "validation_failed",
  "unauthenticated",
  "forbidden", // the caller may know the resource exists but cannot act on it
  "not_found", // ALSO returned for resources hidden by access level (§8.5)
  "conflict", // optimistic concurrency / uniqueness / stale privacy-review digest
  "invalid_transition", // lifecycle or review-state rule violated
  "precondition_failed", // e.g. publish while readiness has blockers
  "rate_limited",
  "payload_too_large",
  "unsupported_file_type",
  "token_invalid", // expired, revoked, exhausted or unknown. Never say which.
  "parse_failed",
  "processing_failed",
  "internal",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppError {
  code: ErrorCode;
  /** Safe for users; no stack traces or SQL. */
  message: string;
  /** Only for `validation_failed`. */
  fieldErrors?: Record<string, string[]>;
  retryable: boolean;
  /** Non-sensitive context only (e.g. `requestId` for `internal`). */
  details?: Record<string, string | number | boolean>;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError };

/**
 * Error thrown by DB mutations (`lib/db/mutations/*`, §11.2). Server actions map it to `AppError`;
 * it never reaches the client.
 */
export const DB_ERROR_CODES = ["conflict", "not_found", "invalid_transition", "internal"] as const;
export type DbErrorCode = (typeof DB_ERROR_CODES)[number];

export interface DbErrorShape {
  code: DbErrorCode;
}
