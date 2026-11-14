import "server-only";

import { after } from "next/server";

import { getAiProviderForRun } from "../ai/config";
import { serverDb, serverStorage } from "../db";
import { extractCandidates } from "../ai/extract";
import { verifySupport } from "../ai/verify-support";
import type { PipelineAi } from "./ai";
import { createConsoleLogger } from "./log";
import { getVerifiedPepper } from "./pepper";
import { createDrainer, type DrainOptions, type DrainReport } from "./runner";
import { WorkerTargetRefusedError, workerTargetAllowed } from "./target-guard";

export type { DrainOptions, DrainReport } from "./runner";

/** Small budget for the post-response drain: it shares the action's invocation (maxDuration). */
const SCHEDULED_DRAIN: DrainOptions = { maxJobs: 5, deadlineMs: 50_000 };

/**
 * I2: claims and runs ready jobs with the service role until `maxJobs` or the deadline (default 25 jobs,
 * 240 s; the drain route's maxDuration is 300 s). Never throws for job failures; they are recorded on the
 * jobs and runs.
 */
export function drainJobs(opts?: DrainOptions): Promise<DrainReport> {
  // Independent of the dev launcher: never claim or write jobs in the original Supabase project.
  if (!workerTargetAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    createConsoleLogger().error("worker_target_refused");
    return Promise.reject(new WorkerTargetRefusedError());
  }
  return createDrainer({
    db: serverDb(),
    storage: serverStorage(),
    logger: createConsoleLogger(),
    getPepper: getVerifiedPepper,
    ai: PIPELINE_AI,
  })(opts);
}

/** lib/ai bound for the worker (I1): the provider always comes from the run snapshot (§6.17). */
const PIPELINE_AI: PipelineAi = {
  providerForRun: (runConfig) => getAiProviderForRun(runConfig),
  extractCandidates,
  verifySupport,
};

/**
 * I2: fire-and-forget drain after the response (`after()`, next/server). Never awaited by actions and never
 * throws: outside a request scope it only logs, and the cron sweep picks the jobs up.
 */
export function scheduleDrain(): void {
  const logger = createConsoleLogger();
  try {
    after(async () => {
      try {
        await drainJobs(SCHEDULED_DRAIN);
      } catch {
        logger.error("scheduled_drain_error");
      }
    });
  } catch {
    logger.warn("drain_not_scheduled");
  }
}
