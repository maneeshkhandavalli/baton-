/**
 * Run outcome (§9.3, W0 decision I2.7). Pure over `listRunJobs` (DB-14). Nothing here approves or
 * publishes: a succeeded run only moves the handover to `in_review` (`_close_run`).
 *
 * - failed at once when any job failed with a run-fatal reason (`provider_not_configured`,
 *   `ai_config_changed`), even while other jobs are still open;
 * - failed at once when a handover-level stage (`verify_support`, `analyze`, `prepare_review`) failed
 *   after its retries (every per-source job is terminal by then: claim ordering, DB-1);
 * - failed at once (`no_jobs`) for a run without any job (QA-R3-01: nothing would ever close it);
 * - otherwise wait until every job is terminal; then failed when no `extract` job succeeded
 *   (`no_source_succeeded`), else succeeded.
 *
 * AI cause: when the deciding failure is an AI call failure, the run's reason token is that AI reason
 * (e.g. `ai_provider_error`) instead of the structural token. The run's `error_message` is the only
 * failure detail the processing page can read (api_get_processing_status does not return job reasons),
 * so without this a Gemini outage, quota or key problem reads as a generic stop. For a handover-level
 * stage it is the failed job's AI reason; for `no_source_succeeded` it is used only when every failed
 * `extract` job failed with the same AI reason. Every other case keeps the structural token.
 */

import type { ErrorCode } from "../contracts/api";
import type { PipelineStage } from "../contracts/enums";
import type { RunJobState } from "../db/pipeline";
import { RUN_FATAL_REASONS, type FailureReason } from "./types";

export type RunDecision =
  | { kind: "wait" }
  | { kind: "finish"; status: "succeeded" }
  | { kind: "finish"; status: "failed"; errorCode: ErrorCode; errorMessage: string };

const HANDOVER_STAGES: ReadonlySet<PipelineStage> = new Set(["verify_support", "analyze", "prepare_review"]);
const TERMINAL: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);

/** Job reason tokens that describe a failed AI call; surfaced as the run's reason (see above). */
export const RUN_SURFACED_AI_REASONS: ReadonlySet<string> = new Set<FailureReason>([
  "ai_transient",
  "ai_invalid_output",
  "ai_tool_call",
  "ai_provider_error",
  "ai_timed_out",
  "ai_aborted",
  "ai_request_too_large",
  "ai_request_invalid",
  "ai_budget_exceeded",
]);

function aiReason(message: string | null): string | null {
  return message !== null && RUN_SURFACED_AI_REASONS.has(message) ? message : null;
}

export function decideRunOutcome(jobs: ReadonlyArray<Pick<RunJobState, "stage" | "status" | "errorMessage">>): RunDecision {
  if (jobs.length === 0) return { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage: "no_jobs" };

  const fatal = jobs.find((j) => j.status === "failed" && j.errorMessage !== null && RUN_FATAL_REASONS.has(j.errorMessage));
  if (fatal) {
    return { kind: "finish", status: "failed", errorCode: "precondition_failed", errorMessage: fatal.errorMessage as string };
  }

  const handoverFailure = jobs.find((j) => HANDOVER_STAGES.has(j.stage) && j.status === "failed");
  if (handoverFailure) {
    const errorMessage = aiReason(handoverFailure.errorMessage) ?? `${handoverFailure.stage}_failed`;
    return { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage };
  }

  if (jobs.some((j) => !TERMINAL.has(j.status))) return { kind: "wait" };

  if (!jobs.some((j) => j.stage === "extract" && j.status === "succeeded")) {
    const reasons = new Set(jobs.filter((j) => j.stage === "extract" && j.status === "failed").map((j) => aiReason(j.errorMessage)));
    const shared = reasons.size === 1 ? [...reasons][0] : null;
    return { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage: shared ?? "no_source_succeeded" };
  }
  return { kind: "finish", status: "succeeded" };
}
