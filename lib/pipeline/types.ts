/**
 * Typed processing states and failures for the pipeline worker (§9.3, §10, docs/integration/interfaces.md I2).
 *
 * Every failure carries an `ErrorCode` (ERROR_CODES only) and a structural reason token. The token is the
 * only text that ever reaches `processing_jobs.error_message` or `processing_runs.error_message`, so it
 * must match REASON_TOKEN_PATTERN and never contain content (§12.7).
 */

import type { ErrorCode } from "../contracts/api";
import type { ParserErrorCode, ParserInputErrorCode } from "../contracts/parser";

/** Same pattern `complete_processing_job` enforces. */
export const REASON_TOKEN_PATTERN = /^[a-z0-9_:]{1,64}$/;

export type FailureReason =
  | "provider_not_configured"
  | "ai_config_changed"
  | "ai_transient"
  | "ai_invalid_output"
  | "ai_budget_exceeded"
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
  | "stage_not_wired"
  | "db_transient"
  | "db_rejected"
  | "internal";

/** Reasons that end the whole run at once: every later AI job would fail the same way. */
export const RUN_FATAL_REASONS: ReadonlySet<string> = new Set<FailureReason>([
  "provider_not_configured",
  "ai_config_changed",
  "stage_not_wired",
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

/** Non-sensitive per-attempt record (§11.8 AiAttemptRecord); only AI stages produce one. */
export type AttemptRecord = Record<string, string | number | boolean | null>;

/** What a stage handler returns. The runner turns it into exactly one `completeJob` call. */
export type StageOutcome =
  | { kind: "succeeded"; progress?: JobProgress; attemptRecord?: AttemptRecord }
  | { kind: "failed"; failure: PipelineFailure; attemptRecord?: AttemptRecord }
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
