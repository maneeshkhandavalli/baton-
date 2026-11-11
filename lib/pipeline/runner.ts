/**
 * The drain loop (I2, D10, §9.3), with every dependency injected so it runs against a fake DbClient in
 * tests. `worker.ts` binds it to the service-role client.
 *
 * Per claimed job:
 *   1. `getJobContext`. A claim that is no longer ours, or a run that is no longer active, is dropped
 *      without recording anything (the fenced `completeJob` would refuse it anyway).
 *   2. Generic preconditions: per-source stages after a failed or missing parse are `skipped`
 *      (upstream_failed); an `extract` whose input hash already succeeded in an earlier run is a no-op.
 *   3. The stage handler. Thrown errors become typed failures; `LeaseLostError` drops the job.
 *   4. Exactly one fenced `completeJob`: succeeded | retry (backoff 30 s, 2 min, 8 min) | failed |
 *      skipped | yield. Ordering never costs an attempt: `claimReadyJobs` only returns ready jobs (DB-1).
 *   5. On a terminal job status, `listRunJobs` + `decideRunOutcome` decide whether to finish the run.
 */

import type { Result } from "../contracts/api";
import { PIPELINE_STAGES, type PipelineStage } from "../contracts/enums";
import type { DbClient } from "../db/client";
import { DbError } from "../db/errors";
import {
  claimReadyJobs,
  completeJob,
  finishRun,
  getJobContext,
  heartbeatJob,
  listRunJobs,
  type ClaimedJob,
  type JobCompletion,
  type JobContext,
} from "../db/pipeline";
import type { StorageClient } from "../db/storage";
import { nextAttemptAt } from "./backoff";
import { decideRunOutcome } from "./finish";
import type { PipelineLogger } from "./log";
import type { VerifiedPepper } from "./pepper-core";
import type { StageContext, StageHandler } from "./stage-context";
import { runAnalyze } from "./stages/analyze";
import { runParse } from "./stages/parse";
import { runPrepareReview } from "./stages/prepare-review";
import { failed, LeaseLostError, type StageOutcome } from "./types";

export interface DrainReport {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
  /** Requeued by a checkpointed `yield` (no attempt used). */
  deferred: number;
  /** Not in I2's minimum shape: jobs cancelled as `upstream_failed`. */
  skipped: number;
  /** Not in I2's minimum shape: claims dropped because the lease was lost or the run ended. */
  lost: number;
}

export interface DrainOptions {
  maxJobs?: number;
  deadlineMs?: number;
}

export interface DrainerDeps {
  db: DbClient;
  storage: StorageClient;
  logger: PipelineLogger;
  getPepper(): Result<VerifiedPepper>;
  now?: () => number;
  handlers?: Partial<Record<PipelineStage, StageHandler>>;
  leaseSeconds?: number;
  /** A job is not claimed when less than this remains before the deadline. */
  minRemainingMs?: number;
}

export const DEFAULT_LEASE_SECONDS = 300;
export const DEFAULT_DEADLINE_MS = 240_000;
export const DEFAULT_MAX_JOBS = 25;
export const DEFAULT_MIN_REMAINING_MS = 30_000;

/** AI stages are wired in P2 (after I1 lands). Until then they fail the run loudly, never fake success. */
const notWired: StageHandler = async () => failed("internal", "stage_not_wired");

export const DEFAULT_HANDLERS: Record<PipelineStage, StageHandler> = {
  parse: runParse,
  extract: notWired,
  verify_quotes: notWired,
  verify_support: notWired,
  analyze: runAnalyze,
  prepare_review: runPrepareReview,
};

const ACTIVE_RUN = new Set(["queued", "running"]);
const NEEDS_PARSED_SOURCE: ReadonlySet<PipelineStage> = new Set(["extract", "verify_quotes"]);

type Disposition = { kind: "lost" } | StageOutcome;

function precheck(claimed: ClaimedJob, ctx: JobContext): Disposition | null {
  if (ctx.job.status !== "running" || ctx.job.attempt !== claimed.attempt) return { kind: "lost" };
  if (!ACTIVE_RUN.has(ctx.run.status)) return { kind: "lost" };
  if (!(PIPELINE_STAGES as readonly string[]).includes(ctx.job.stage)) return failed("internal", "internal");
  if (ctx.handover.deleted) return failed("not_found", "handover_unavailable");
  if (NEEDS_PARSED_SOURCE.has(ctx.job.stage)) {
    const s = ctx.source;
    if (!s || s.deleted || s.state !== "parsed") return { kind: "skipped", reason: "upstream_failed" };
  }
  if (ctx.job.stage === "extract" && ctx.priorSucceeded) return { kind: "succeeded", progress: { done: 0, total: 0 } };
  return null;
}

/** Typed failure for anything a handler throws. */
export function classifyError(e: unknown): Disposition {
  if (e instanceof LeaseLostError) return { kind: "lost" };
  if (e instanceof DbError) {
    if (e.retryable || e.code === "internal") return failed(e.code === "internal" ? "processing_failed" : e.code, "db_transient", true);
    if (e.code === "invalid_transition") return failed("invalid_transition", "run_inactive");
    return failed(e.code, "db_rejected");
  }
  return failed("internal", "internal"); // a programming defect (the parser throws only on those, §11.4)
}

export function createDrainer(deps: DrainerDeps): (opts?: DrainOptions) => Promise<DrainReport> {
  const now = deps.now ?? Date.now;
  const lease = deps.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const minRemaining = deps.minRemainingMs ?? DEFAULT_MIN_REMAINING_MS;
  const handlers: Record<PipelineStage, StageHandler> = { ...DEFAULT_HANDLERS, ...deps.handlers };
  const { db, logger } = deps;

  async function maybeFinishRun(runId: string): Promise<void> {
    for (let tries = 0; tries < 2; tries += 1) {
      try {
        const { runStatus, jobs } = await listRunJobs(db, runId);
        if (!ACTIVE_RUN.has(runStatus)) return;
        const decision = decideRunOutcome(jobs);
        if (decision.kind === "wait") return;
        await finishRun(
          db,
          decision.status === "succeeded"
            ? { runId, status: "succeeded" }
            : { runId, status: "failed", errorCode: decision.errorCode, errorMessage: decision.errorMessage },
        );
        logger.info("run_finished", {
          runId,
          status: decision.status,
          reason: decision.status === "failed" ? decision.errorMessage : null,
          jobs: jobs.length,
        });
        return;
      } catch (e) {
        if (e instanceof DbError && e.code === "invalid_transition") return; // finished or cancelled meanwhile
        const retry = e instanceof DbError && e.retryable && tries === 0;
        logger.warn("run_finish_error", { runId, code: e instanceof DbError ? e.code : "internal", willRetry: retry });
        if (!retry) return;
      }
    }
  }

  async function runClaimed(claimed: ClaimedJob, deadlineAt: number, report: DrainReport): Promise<void> {
    const base = { jobId: claimed.id, runId: claimed.run_id, stage: claimed.stage, attempt: claimed.attempt };
    let disposition: Disposition;
    try {
      const jobContext = await getJobContext(db, claimed.id);
      const pre = precheck(claimed, jobContext);
      if (pre) {
        disposition = pre;
      } else {
        const stageCtx: StageContext = {
          claimed,
          job: jobContext,
          db,
          storage: deps.storage,
          logger,
          now,
          deadlineAt,
          getPepper: deps.getPepper,
          heartbeat: async (progress) => {
            const status = await heartbeatJob(db, { jobId: claimed.id, attempt: claimed.attempt, leaseSeconds: lease, progress });
            if (status === "lost") throw new LeaseLostError();
          },
        };
        disposition = await handlers[jobContext.job.stage](stageCtx);
      }
    } catch (e) {
      disposition = classifyError(e);
    }

    if (disposition.kind === "lost") {
      report.lost += 1;
      logger.warn("job_lost", base);
      return;
    }

    let completion: JobCompletion;
    const extra: Parameters<typeof completeJob>[1] = { jobId: claimed.id, attempt: claimed.attempt, outcome: "succeeded" };
    switch (disposition.kind) {
      case "succeeded":
        completion = "succeeded";
        if (disposition.progress) extra.progress = disposition.progress;
        if (disposition.attemptRecord) extra.attemptRecord = disposition.attemptRecord;
        break;
      case "skipped":
        completion = "skipped";
        break;
      case "yield":
        completion = "yield";
        extra.progress = disposition.progress;
        break;
      case "failed":
        completion = disposition.failure.retryable ? "retry" : "failed";
        extra.errorCode = disposition.failure.code;
        extra.errorMessage = disposition.failure.reason;
        if (disposition.failure.retryable) extra.nextAttemptAt = nextAttemptAt(now(), claimed.attempt);
        if (disposition.attemptRecord) extra.attemptRecord = disposition.attemptRecord;
        break;
    }
    extra.outcome = completion;

    let status: Awaited<ReturnType<typeof completeJob>>;
    try {
      status = await completeJob(db, extra);
    } catch (e) {
      if (e instanceof DbError && e.code === "conflict" && !e.retryable) {
        report.lost += 1;
        logger.warn("job_lost", base);
      } else {
        logger.error("job_complete_error", { ...base, code: e instanceof DbError ? e.code : "internal" });
      }
      return; // the lease expires and the job is reclaimed (or reaped on its last attempt)
    }

    if (status === "succeeded") report.succeeded += 1;
    else if (status === "cancelled") report.skipped += 1;
    else if (status === "failed") report.failed += 1;
    else if (completion === "yield") report.deferred += 1;
    else report.retried += 1;

    logger.info("job_completed", {
      ...base,
      outcome: completion,
      status,
      reason: disposition.kind === "failed" ? disposition.failure.reason : null,
    });

    if (status === "succeeded" || status === "failed" || status === "cancelled") await maybeFinishRun(claimed.run_id);
  }

  return async function drain(opts: DrainOptions = {}): Promise<DrainReport> {
    const report: DrainReport = { claimed: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0, skipped: 0, lost: 0 };
    const maxJobs = Math.max(0, Math.floor(opts.maxJobs ?? DEFAULT_MAX_JOBS));
    const deadlineAt = now() + Math.max(0, opts.deadlineMs ?? DEFAULT_DEADLINE_MS);

    while (report.claimed < maxJobs && deadlineAt - now() >= minRemaining) {
      let jobs: ClaimedJob[];
      try {
        jobs = await claimReadyJobs(db, 1, lease); // one at a time: a lease never ticks while queued in memory
      } catch (e) {
        logger.error("claim_error", { code: e instanceof DbError ? e.code : "internal" });
        break;
      }
      if (jobs.length === 0) break;
      for (const job of jobs) {
        report.claimed += 1;
        await runClaimed(job, deadlineAt, report);
      }
    }
    logger.info("drain_done", { ...report });
    return report;
  };
}
