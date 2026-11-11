/**
 * Database error mapping (§3.2 "Database error categories", §11.2).
 *
 * Baton's SQL functions raise the custom SQLSTATEs of `DB_SQLSTATE_ERROR_CODES` (lib/contracts/api.ts):
 *   BTNF0 not_found · BTCF0 conflict · BTIT0 invalid_transition · BTPF0 precondition_failed
 *   BTFB0 forbidden · BTVF0 validation_failed · BTUA0 unauthenticated · BTTI0 token_invalid
 *
 * R8 (S1): `DbError.code` is the precise `DbErrorCode` and is passed through to `AppError.code`
 * unchanged; there is no coarser mapping. Reads still turn hidden resources into not_found (§8.5) in
 * lib/db/queries.ts. Postgres messages never reach the client: AppError messages are fixed, safe strings.
 */

import { DB_SQLSTATE_ERROR_CODES } from "../contracts/api";
import type { AppError, DbErrorCode, DbErrorShape, ErrorCode, Result } from "../contracts/api";
import type { DbRpcError } from "./client";

const BY_SQLSTATE: Readonly<Record<string, DbErrorCode>> = {
  ...DB_SQLSTATE_ERROR_CODES,
  "23505": "conflict", // unique_violation
  "40001": "conflict", // serialization_failure (retryable)
  "40P01": "conflict", // deadlock_detected (retryable)
  "55P03": "conflict", // lock_not_available / lock_timeout (retryable)
  "22P02": "validation_failed", // invalid_text_representation (e.g. malformed uuid)
  "23502": "validation_failed", // not_null_violation
  "23514": "validation_failed", // check_violation
  "22023": "validation_failed", // invalid_parameter_value
  "23503": "not_found", // a referenced row does not exist (or belongs to another handover)
  "42501": "forbidden", // insufficient_privilege
  PGRST301: "unauthenticated", // PostgREST: JWT expired / invalid
};

/** SQLSTATEs worth retrying after a short, jittered wait (§5.5 item 7). */
const RETRYABLE = new Set(["40001", "40P01", "55P03"]);

const SAFE_MESSAGES: Record<ErrorCode, string> = {
  validation_failed: "Some of the information is not valid.",
  unauthenticated: "Please sign in again.",
  forbidden: "You can't do that in this handover.",
  not_found: "We couldn't find that.",
  conflict: "Something changed in the meantime. Reload and try again.",
  invalid_transition: "That isn't possible at this stage.",
  precondition_failed: "This can't be done yet.",
  rate_limited: "Too many attempts. Please wait a moment.",
  payload_too_large: "That file is too large.",
  unsupported_file_type: "That file type isn't supported.",
  token_invalid: "This link is no longer valid.",
  parse_failed: "We couldn't read that file.",
  processing_failed: "Processing failed. Please try again.",
  internal: "Something went wrong on our side.",
};

export class DbError extends Error implements DbErrorShape {
  readonly code: DbErrorCode;
  readonly retryable: boolean;
  /** SQLSTATE, for server logs only. */
  readonly sqlState: string | undefined;

  constructor(code: DbErrorCode, sqlState?: string, retryable = false) {
    super(SAFE_MESSAGES[code]);
    this.name = "DbError";
    this.code = code;
    this.sqlState = sqlState;
    this.retryable = retryable;
  }

  static fromRpc(error: DbRpcError): DbError {
    const state = error.code;
    const code = (state !== undefined && Object.hasOwn(BY_SQLSTATE, state) && BY_SQLSTATE[state]) || "internal";
    return new DbError(code, state, state !== undefined && RETRYABLE.has(state));
  }
}

export function isDbError(value: unknown): value is DbError {
  return value instanceof DbError;
}

/** Map anything thrown by lib/db to a client-safe AppError (§3.2). */
export function toAppError(error: unknown, requestId?: string): AppError {
  if (isDbError(error)) {
    return {
      code: error.code,
      message: SAFE_MESSAGES[error.code],
      retryable: error.retryable,
      ...(error.code === "internal" && requestId ? { details: { requestId } } : {}),
    };
  }
  return {
    code: "internal",
    message: SAFE_MESSAGES.internal,
    retryable: false,
    ...(requestId ? { details: { requestId } } : {}),
  };
}

export function fail<T>(code: ErrorCode): Result<T> {
  return { ok: false, error: { code, message: SAFE_MESSAGES[code], retryable: false } };
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}
