/**
 * Typed processing states and failures for the pipeline worker (§9.3, §10, docs/integration/interfaces.md I2).
 *
 * Every failure carries an `ErrorCode` (ERROR_CODES only) and a structural reason token. The token is the
 * only text that ever reaches `processing_jobs.error_message` or `processing_runs.error_message`, so it
 * must match REASON_TOKEN_PATTERN and never contain content (§12.7).
 */

import type { AiAttemptRecord } from "../ai/provider";
import type { ErrorCode } from "../contracts/api";
import type { ParserErrorCode, ParserInputErrorCode } from "../contracts/parser";

/** Same pattern `complete_processing_job` enforces. */
export const REASON_TOKEN_PATTERN = /^[a-z0-9_:]{1,64}$/;

export type FailureReason =
  | "provider_not_configured"
  | "ai_config_changed"
  | "ai_transient"
  | "ai_invalid_output"
  | "ai_tool_call"
  | "ai_provider_error"
  | "ai_timed_out"
  | "ai_aborted"
  | "ai_request_too_large"
  | "ai_budget_exceeded"
  | "source_changed"
  | "identity_pepper_unverified"
  | "integrity_mismatch"
  | "raw_unavailable"
  | `parser:${ParserErrorCode}`
  | `input:${ParserInputErrorCode}`
  | "exclusions_invalid"
  | "identity_confirmation_required"
  | "excluded_participant_content"
  | "source_unavailable"
  | "handover_unavailable"
  | "run_inactive"
  | "ai_request_invalid"
  | "ai_quota_exhausted"
  | "db_transient"
  | "db_rejected"
  /** The database lacks the fenced pipeline functions (migrations 2026111330* not applied). */
  | "db_schema_outdated"
  | "internal";

/** Reasons that end the whole run at once: every later AI job would fail the same way. */
export const RUN_FATAL_REASONS: ReadonlySet<string> = new Set<FailureReason>([
  "provider_not_configured",
  "ai_config_changed",
  "db_schema_outdated",
]);

export interface PipelineFailure {
  code: ErrorCode;
  reason: FailureReason;
  /** Retried with backoff until max_attempts (§9.3). */
  retryable: boolean;
}

export interface JobProgress {
  done: number;
  total: number;
}

/** Non-sensitive per-attempt record (§11.8); only AI stages produce one. */
export type AttemptRecord = AiAttemptRecord;

/** What a stage handler returns. The runner turns it into exactly one `completeJob` call. */
export type StageOutcome =
  | { kind: "succeeded"; progress?: JobProgress; attemptRecord?: AttemptRecord }
  /** `progress` keeps a checkpoint across a retry (e.g. extract chunks already stored). */
  | { kind: "failed"; failure: PipelineFailure; attemptRecord?: AttemptRecord; progress?: JobProgress }
  | { kind: "skipped"; reason: "upstream_failed" }
  | { kind: "yield"; progress: JobProgress };

/** Thrown by `heartbeat` when the claim is no longer ours (lease lost, run cancelled or finished). */
export class LeaseLostError extends Error {
  constructor() {
    super("lease lost");
    this.name = "LeaseLostError";
  }
}

export function failure(code: ErrorCode, reason: FailureReason, retryable = false): PipelineFailure {
  return { code, reason, retryable };
}

export const failed = (code: ErrorCode, reason: FailureReason, retryable = false): StageOutcome => ({
  kind: "failed",
  failure: failure(code, reason, retryable),
});
