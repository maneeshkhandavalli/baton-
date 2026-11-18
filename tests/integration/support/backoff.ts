// Shared drain fallback for the Tier E suites (R3 Task 05E hardening).
//
// When a drain claims nothing while the run is still open, the remaining jobs are usually waiting out a retry
// backoff (next_attempt_at in the future). This releases them so the test does not wait in real time.
// A data-modifying statement is valid only as a top-level statement or in a WITH clause, never as a subquery in
// FROM: the earlier inline copies (`select … from (update … returning 1) x`) were a syntax error that only surfaced
// when this fallback actually ran.
import { lit, type PgContainer } from "./pg";

/** Makes every queued, backed-off job of the run claimable now. Returns how many were released. */
export async function releaseBackedOffJobs(pg: PgContainer, runId: string): Promise<number> {
  return (await pg.json<number>(
    `with released as (
       update public.processing_jobs set next_attempt_at = now() - interval '1 second'
        where run_id = ${lit(runId)} and status = 'queued' and next_attempt_at > now()
       returning 1)
     select to_jsonb(count(*)) from released`,
  ))!;
}
