import "server-only";

import { createDevDrainTick, DEV_DRAIN_BUDGET, devDrainAllowed } from "./dev-drain-guard";
import { drainJobs } from "./worker";

/**
 * LOCAL DEVELOPMENT ONLY (BTN-004). Keeps draining processing jobs while `next dev` runs, so a run reaches a
 * terminal state without the production cron (the `after()` drain that startProcessing schedules has a
 * small budget). It adds no endpoint and no credentials anywhere: it calls the same fenced drainJobs as
 * the protected drain route, in the server process, so claim fencing, stage ordering, retries, backoff and
 * reaping all still come from the database (DB-1…DB-3, DB-15).
 *
 * Runs only when NODE_ENV is exactly "development", Supabase server credentials are present, and
 * BATON_DEV_WORKER is not "0". Ticks never overlap; each tick is bounded (jobs and time); a failing tick is
 * retried on the next one; a tick that never settles is abandoned after DEV_TICK_TIMEOUT_MS (E4).
 */
const TICK_MS = 4_000;

type LoopState = { started: boolean };
const g = globalThis as typeof globalThis & { __batonDevDrain?: LoopState };

export function startDevDrainLoop(env: Record<string, string | undefined> = process.env): boolean {
  if (!devDrainAllowed(env)) return false;
  const state = (g.__batonDevDrain ??= { started: false });
  if (state.started) return true; // one loop per server process, even across hot reloads
  state.started = true;

  // Overlap, error and hang handling live in createDevDrainTick (unit-tested in dev-drain-guard.test.ts).
  const { tick } = createDevDrainTick(() => drainJobs(DEV_DRAIN_BUDGET), {
    info: (m) => console.info(m),
    warn: (m) => console.warn(m),
  });
  // Deliberately NOT unref()-ed: in the context where Next.js runs instrumentation, an unref()-ed
  // interval never fires (verified: 0 ticks with unref, 10 per 40 s without). The dev server keeps running anyway.
  setInterval(() => void tick(), TICK_MS);
  console.info("[baton dev worker] local job drain enabled (development only)");
  return true;
}
