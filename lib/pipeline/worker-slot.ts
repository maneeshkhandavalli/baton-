/**
 * Task 01B: global worker concurrency. Every drain (scheduler, the after() drain on start, the processing
 * page nudge, the local dev loop) runs inside one database worker slot, so at most `maxSlots` sweeps run at
 * once across all server instances. Pure over its dependencies (tests pass fakes); `worker.ts` binds it.
 *
 * - Acquisition is atomic in SQL (SKIP LOCKED); no free slot → a no-work result with `busy: 1`.
 * - The slot lease covers the drain budget plus a minute, and is renewed before every claim; a worker that
 *   lost its slot (expired and taken) stops claiming. Its in-flight job stays protected by job fencing.
 * - Release is token-fenced: a stale worker never frees a newer worker's slot.
 * - Slot errors are infrastructure failures: the drain does not run without a slot (fails closed).
 */

import type { DbClient } from "../db/client";
import { acquireWorkerSlot, releaseWorkerSlot, renewWorkerSlot } from "../db/pipeline";
import type { PipelineLogger } from "./log";
import type { DrainOptions, DrainReport } from "./runner";

/** Initial limit: one sweep at a time (raise only after the AI provider's rate limits are verified). */
export const DEFAULT_MAX_SWEEPS = 1;
/** Hard ceiling for BATON_WORKER_MAX_SWEEPS. */
export const MAX_SWEEPS_LIMIT = 4;

export type WorkerTrigger = "pg_cron" | "vercel_schedule" | "after_drain" | "dev_loop" | "other";

export interface WorkerReport extends DrainReport {
  /** 1 when every worker slot was held and nothing ran; 0 otherwise. */
  busy: number;
}

/** BATON_WORKER_MAX_SWEEPS: an integer 1..4; anything else is the default (1). */
export function maxConcurrentSweeps(env: Record<string, string | undefined> = process.env): number {
  const raw = env.BATON_WORKER_MAX_SWEEPS;
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_MAX_SWEEPS;
  const n = Number(raw.trim());
  return n >= 1 && n <= MAX_SWEEPS_LIMIT ? n : DEFAULT_MAX_SWEEPS;
}

/** Slot lease for a drain with `remainingMs` left: the remaining budget plus a minute, within 30..900 s. */
export function slotLeaseSeconds(remainingMs: number): number {
  const s = Math.ceil(Math.max(0, remainingMs) / 1000) + 60;
  return Math.min(900, Math.max(30, s));
}

const EMPTY: DrainReport = { claimed: 0, succeeded: 0, retried: 0, failed: 0, deferred: 0, skipped: 0, lost: 0 };

export interface WorkerSlotDeps {
  db: DbClient;
  logger: PipelineLogger;
  now?: () => number;
}

export async function runWithWorkerSlot(
  deps: WorkerSlotDeps,
  input: { trigger: WorkerTrigger; maxSlots: number; maxJobs: number; deadlineMs: number },
  drain: (opts: DrainOptions) => Promise<DrainReport>,
): Promise<WorkerReport> {
  const now = deps.now ?? Date.now;
  const { db, logger } = deps;
  const deadlineAt = now() + input.deadlineMs;

  const slot = await acquireWorkerSlot(db, { maxSlots: input.maxSlots, leaseSeconds: slotLeaseSeconds(input.deadlineMs), trigger: input.trigger });
  if (!slot) {
    logger.info("worker_busy", { trigger: input.trigger, maxSlots: input.maxSlots });
    return { ...EMPTY, busy: 1 };
  }

  try {
    const report = await drain({
      maxJobs: input.maxJobs,
      deadlineMs: Math.max(0, deadlineAt - now()),
      shouldContinue: async () => {
        try {
          return await renewWorkerSlot(db, slot, slotLeaseSeconds(deadlineAt - now()));
        } catch {
          logger.warn("worker_slot_renew_error", { trigger: input.trigger, slot: slot.slot });
          return false; // fail safe: stop claiming
        }
      },
    });
    return { ...report, busy: 0 };
  } finally {
    try {
      if (!(await releaseWorkerSlot(db, slot))) logger.warn("worker_slot_not_released", { trigger: input.trigger, slot: slot.slot });
    } catch {
      // The lease expires on its own (at most the drain budget plus a minute).
      logger.warn("worker_slot_release_error", { trigger: input.trigger, slot: slot.slot });
    }
  }
}
