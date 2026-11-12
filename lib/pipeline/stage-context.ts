/** What every stage handler receives from the runner. */

import type { Result } from "../contracts/api";
import type { DbClient } from "../db/client";
import type { ClaimedJob, JobClaim, JobContext } from "../db/pipeline";
import type { StorageClient } from "../db/storage";
import type { PipelineAi } from "./ai";
import type { PipelineLogger } from "./log";
import type { VerifiedPepper } from "./pepper-core";
import type { JobProgress, StageOutcome } from "./types";

export interface StageContext {
  claimed: ClaimedJob;
  job: JobContext;
  db: DbClient;
  storage: StorageClient;
  logger: PipelineLogger;
  now(): number;
  /** Epoch ms after which a long handler should checkpoint and return `yield`. */
  deadlineAt: number;
  getPepper(): Result<VerifiedPepper>;
  ai: PipelineAi;
  /** Extends the lease and records progress. Throws `LeaseLostError` when the claim is no longer ours. */
  heartbeat(progress?: JobProgress): Promise<void>;
}

export type StageHandler = (ctx: StageContext) => Promise<StageOutcome>;

/** The fencing token for every job-scoped write (DB-12): this claim's job id, attempt and claim generation. */
export function claimOf(ctx: Pick<StageContext, "claimed">): JobClaim {
  // int8 may arrive as a number or a numeric string depending on the client; anything else means an older
  // database without the column, where the attempt-only fence applies.
  const g = Number(ctx.claimed.claim_generation);
  const base = { jobId: ctx.claimed.id, attempt: ctx.claimed.attempt };
  return Number.isSafeInteger(g) && g > 0 ? { ...base, generation: g } : base;
}
