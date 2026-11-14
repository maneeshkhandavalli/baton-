import { workerTargetAllowed } from "./target-guard";

/**
 * Whether the local development drain loop may start (BTN-004). Pure, so it is unit-tested: only under
 * `next dev` (NODE_ENV exactly "development"), only when Supabase is configured, and never when
 * BATON_DEV_WORKER is "0". Production, test, staging and an unset NODE_ENV all refuse, and so does a
 * Supabase URL naming the original project (target-guard.ts).
 * (The service key is read only by lib/supabase/admin.ts, boundary H1; without it each drain fails there
 * and the loop logs that once.)
 */
export function devDrainAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.NODE_ENV !== "development" || env.BATON_DEV_WORKER === "0") return false;
  // Never against the original Supabase project (.env.local still points at it): see target-guard.ts.
  return workerTargetAllowed(env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Per-tick budget. The deadline MUST exceed the runner's DEFAULT_MIN_REMAINING_MS (30 s), or the runner never
 * starts a job (a 25 s budget claimed nothing: regression-tested in dev-drain-guard.test.ts).
 */
export const DEV_DRAIN_BUDGET = { maxJobs: 10, deadlineMs: 60_000 } as const;

/**
 * A tick that has not settled after this long is treated as hung: the loop stops waiting for it so later
 * ticks can drain again. Safe because every write is fenced by the job claim in the database (DB-12): if
 * the hung drain ever resumes, its stale writes are refused.
 */
export const DEV_TICK_TIMEOUT_MS = DEV_DRAIN_BUDGET.deadlineMs + 60_000;

export interface DevTickReport {
  claimed: number;
  succeeded: number;
  retried: number;
  failed: number;
}

export interface DevTickState {
  running: boolean;
  /** Error name of the last failed tick (logged once per distinct name), or null. */
  lastError: string | null;
  ticks: number;
  hung: number;
}

/**
 * The dev loop's tick, pure apart from the injected drain and logger, so overlap, error and hang handling
 * are unit-tested. Ticks never overlap; a failing drain is logged once per distinct error and retried on
 * the next tick; a drain that never settles is abandoned after `timeoutMs`.
 */
export function createDevDrainTick(
  drain: () => Promise<DevTickReport>,
  log: { info(msg: string): void; warn(msg: string): void },
  opts: { timeoutMs?: number } = {},
): { tick(): Promise<void>; state: DevTickState } {
  const timeoutMs = opts.timeoutMs ?? DEV_TICK_TIMEOUT_MS;
  const state: DevTickState = { running: false, lastError: null, ticks: 0, hung: 0 };

  async function tick(): Promise<void> {
    if (state.running) return;
    state.running = true;
    state.ticks += 1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const HUNG = Symbol("hung");
    try {
      const result = await Promise.race([
        drain(),
        new Promise<typeof HUNG>((resolve) => {
          timer = setTimeout(() => resolve(HUNG), timeoutMs);
        }),
      ]);
      if (result === HUNG) {
        state.hung += 1;
        log.warn("[baton dev worker] drain did not finish in time; continuing with the next tick");
        return;
      }
      if (state.lastError !== null) log.info("[baton dev worker] drain recovered");
      state.lastError = null;
      if (result.claimed > 0) {
        // Counts only (§12.7): never content.
        log.info(`[baton dev worker] claimed=${result.claimed} succeeded=${result.succeeded} retried=${result.retried} failed=${result.failed}`);
      }
    } catch (error) {
      const code = error instanceof Error ? error.name : "unknown";
      if (state.lastError !== code) log.warn(`[baton dev worker] drain error (${code}); retrying`);
      state.lastError = code;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      state.running = false;
    }
  }
  return { tick, state };
}
