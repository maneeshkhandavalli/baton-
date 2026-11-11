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
 * Error thrown by the DB layer (`lib/db`, §11.2). Its code is passed through to `AppError.code`
 * unchanged (no coarsening); server actions add the safe message. It never reaches the client as is.
 */
export const DB_ERROR_CODES = [
  "validation_failed",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "invalid_transition",
  "precondition_failed",
  "rate_limited",
  "token_invalid",
  "internal",
] as const satisfies readonly ErrorCode[];
export type DbErrorCode = (typeof DB_ERROR_CODES)[number];

export interface DbErrorShape {
  code: DbErrorCode;
  retryable: boolean;
}

/**
 * Custom SQLSTATEs raised by Baton's database functions (§3.2). Standard SQLSTATEs map as listed in
 * the document (e.g. 23505 → conflict, 40001/40P01/55P03 → conflict and retryable).
 */
export const DB_SQLSTATE_ERROR_CODES = {
  BTVF0: "validation_failed",
  BTUA0: "unauthenticated",
  BTFB0: "forbidden",
  BTNF0: "not_found",
  BTCF0: "conflict",
  BTIT0: "invalid_transition",
  BTPF0: "precondition_failed",
  BTTI0: "token_invalid",
} as const satisfies Record<string, DbErrorCode>;
