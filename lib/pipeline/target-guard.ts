/**
 * Worker target guard (2026-11-14). The processing worker must never claim or write jobs in the ORIGINAL
 * Supabase project. `.env.local` still points at it, so a plain `npm run dev` would otherwise start the
 * dev drain loop (instrumentation.ts) against it. This check runs inside the worker itself, independent
 * of `restore-dev/start-baton-dev.mjs`: the dev loop refuses to start, and every `drainJobs` call (dev
 * loop, the `after()` drain, the cron route) refuses before its first database call.
 *
 * Pure (no I/O), so it is unit-tested: lib/pipeline/__tests__/target-guard.test.ts.
 */

/** The original project's real 20-character ref, plus the 19-character misspelling used in some notes. */
export const FORBIDDEN_SUPABASE_REFS: readonly string[] = ["enalguyitewjojgrgzxv", "enalguyitewjojgrgzv"];

/**
 * True when the worker may run against this Supabase URL: the URL parses, and neither its host nor the
 * full string mentions a forbidden project ref (case-insensitive). Unset or unparsable URLs are refused.
 */
export function workerTargetAllowed(supabaseUrl: string | undefined): boolean {
  if (!supabaseUrl) return false;
  const lower = supabaseUrl.toLowerCase();
  if (FORBIDDEN_SUPABASE_REFS.some((ref) => lower.includes(ref))) return false;
  try {
    const host = new URL(supabaseUrl).hostname.toLowerCase();
    return host.length > 0 && !FORBIDDEN_SUPABASE_REFS.some((ref) => host.includes(ref));
  } catch {
    return false;
  }
}

/** Thrown by `drainJobs` when the configured Supabase target is refused. Carries no URL or secret. */
export class WorkerTargetRefusedError extends Error {
  constructor() {
    super("worker refused: the configured Supabase project is not allowed for processing");
    this.name = "WorkerTargetRefusedError";
  }
}
