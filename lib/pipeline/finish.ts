/**
 * Run outcome (§9.3, W0 decision I2.7). Pure over `listRunJobs` (DB-14). Nothing here approves or
 * publishes: a succeeded run only moves the handover to `in_review` (`_close_run`).
 *
 * - failed at once when any job failed with a run-fatal reason (`provider_not_configured`,
 *   `ai_config_changed`, `stage_not_wired`), even while other jobs are still open;
 * - failed at once when a handover-level stage (`verify_support`, `analyze`, `prepare_review`) failed
 *   after its retries (every per-source job is terminal by then: claim ordering, DB-1);
 * - otherwise wait until every job is terminal; then failed when no `extract` job succeeded
 *   (`no_source_succeeded`), else succeeded.
 */

import type { ErrorCode } from "../contracts/api";
import type { PipelineStage } from "../contracts/enums";
import type { RunJobState } from "../db/pipeline";
import { RUN_FATAL_REASONS } from "./types";

export type RunDecision =
  | { kind: "wait" }
  | { kind: "finish"; status: "succeeded" }
  | { kind: "finish"; status: "failed"; errorCode: ErrorCode; errorMessage: string };

const HANDOVER_STAGES: ReadonlySet<PipelineStage> = new Set(["verify_support", "analyze", "prepare_review"]);
const TERMINAL: ReadonlySet<string> = new Set(["succeeded", "failed", "cancelled"]);

export function decideRunOutcome(jobs: ReadonlyArray<Pick<RunJobState, "stage" | "status" | "errorMessage">>): RunDecision {
  const fatal = jobs.find((j) => j.status === "failed" && j.errorMessage !== null && RUN_FATAL_REASONS.has(j.errorMessage));
  if (fatal) {
    const errorCode: ErrorCode = fatal.errorMessage === "stage_not_wired" ? "internal" : "precondition_failed";
    return { kind: "finish", status: "failed", errorCode, errorMessage: fatal.errorMessage as string };
  }

  const handoverFailure = jobs.find((j) => HANDOVER_STAGES.has(j.stage) && j.status === "failed");
  if (handoverFailure) {
    return { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage: `${handoverFailure.stage}_failed` };
  }

  if (jobs.length === 0 || jobs.some((j) => !TERMINAL.has(j.status))) return { kind: "wait" };

  if (!jobs.some((j) => j.stage === "extract" && j.status === "succeeded")) {
    return { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage: "no_source_succeeded" };
  }
  return { kind: "finish", status: "succeeded" };
}
