/**
 * Whether the local development drain loop may start (BTN-004). Pure, so it is unit-tested: only under
 * `next dev` (NODE_ENV exactly "development"), only when Supabase is configured, and never when
 * BATON_DEV_WORKER is "0". Production, test, staging and an unset NODE_ENV all refuse.
 * (The service key is read only by lib/supabase/admin.ts, boundary H1; without it each drain fails there
 * and the loop logs that once.)
 */
export function devDrainAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  if (env.NODE_ENV !== "development" || env.BATON_DEV_WORKER === "0") return false;
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL);
}

/**
 * Per-tick budget. The deadline MUST exceed the runner's DEFAULT_MIN_REMAINING_MS (30 s), or the runner never
 * starts a job (a 25 s budget claimed nothing: regression-tested in dev-drain-guard.test.ts).
 */
export const DEV_DRAIN_BUDGET = { maxJobs: 10, deadlineMs: 60_000 } as const;
