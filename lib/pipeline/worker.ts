import "server-only";

import { after } from "next/server";

import { getAiProviderForRun } from "../ai/config";
import { serverDb, serverStorage } from "../db";
import { extractCandidates } from "../ai/extract";
import { verifySupport } from "../ai/verify-support";
import type { PipelineAi } from "./ai";
import { createConsoleLogger } from "./log";
import { getVerifiedPepper } from "./pepper";
import { createDrainer, DEFAULT_DEADLINE_MS, DEFAULT_MAX_JOBS } from "./runner";
import { WorkerTargetRefusedError, workerTargetAllowed } from "./target-guard";
import { maxConcurrentSweeps, runWithWorkerSlot, type WorkerReport, type WorkerTrigger } from "./worker-slot";

export type { DrainOptions, DrainReport } from "./runner";
export type { WorkerReport, WorkerTrigger } from "./worker-slot";

/** Small budget for the post-response drain: it shares the action's invocation (maxDuration). */
const SCHEDULED_DRAIN = { maxJobs: 5, deadlineMs: 50_000 } as const;

export interface DrainJobsOptions {
  maxJobs?: number;
  deadlineMs?: number;
  /** Who asked (logs and the slot row only). */
  trigger?: WorkerTrigger;
}

/**
 * I2: claims and runs ready jobs with the service role until `maxJobs` or the deadline (default 25 jobs,
 * 240 s; the drain route's maxDuration is 300 s). Never throws for job failures; they are recorded on the
 * jobs and runs.
 *
 * Task 01B: the ONLY way any entry point drains (the drain route, scheduleDrain for startProcessing and the
 * processing-page nudge, the local dev loop). Every drain runs inside a global worker slot
 * (BATON_WORKER_MAX_SWEEPS, default 1); when none is free it returns at once with `busy: 1`.
 */
export function drainJobs(opts: DrainJobsOptions = {}): Promise<WorkerReport> {
  // Independent of the dev launcher: never claim or write jobs in the original Supabase project.
  if (!workerTargetAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    createConsoleLogger().error("worker_target_refused");
    return Promise.reject(new WorkerTargetRefusedError());
  }
  const db = serverDb();
  const logger = createConsoleLogger();
  const drain = createDrainer({ db, storage: serverStorage(), logger, getPepper: getVerifiedPepper, ai: PIPELINE_AI });
  return runWithWorkerSlot(
    { db, logger },
    {
      trigger: opts.trigger ?? "other",
      maxSlots: maxConcurrentSweeps(),
      maxJobs: opts.maxJobs ?? DEFAULT_MAX_JOBS,
      deadlineMs: opts.deadlineMs ?? DEFAULT_DEADLINE_MS,
    },
    drain,
  );
}

/** lib/ai bound for the worker (I1): the provider always comes from the run snapshot (§6.17). */
const PIPELINE_AI: PipelineAi = {
  providerForRun: (runConfig) => getAiProviderForRun(runConfig),
  extractCandidates,
  verifySupport,
};

/**
 * I2: fire-and-forget drain after the response (`after()`, next/server). Never awaited by actions and never
 * throws: outside a request scope it only logs, and the scheduled worker picks the jobs up.
 */
export function scheduleDrain(): void {
  const logger = createConsoleLogger();
  try {
    after(async () => {
      try {
        await drainJobs({ ...SCHEDULED_DRAIN, trigger: "after_drain" });
      } catch {
        logger.error("scheduled_drain_error");
      }
    });
  } catch {
    logger.warn("drain_not_scheduled");
  }
}
