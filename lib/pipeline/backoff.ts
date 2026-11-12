/** §9.3 retry backoff: 30 s, 2 min, 8 min (×4 per attempt), capped at 8 min. */

const BASE_MS = 30_000;
const MAX_MS = 8 * 60_000;

/** Delay before the attempt after `attempt` (1-based: the attempt that just failed). */
export function retryDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt >= 1 ? Math.floor(attempt) : 1;
  return Math.min(BASE_MS * 4 ** (n - 1), MAX_MS);
}

export function nextAttemptAt(nowMs: number, attempt: number): string {
  return new Date(nowMs + retryDelayMs(attempt)).toISOString();
}
