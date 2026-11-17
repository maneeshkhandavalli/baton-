/**
 * Pipeline worker endpoint (D10, §9.3): the scheduled sweep that claims and runs due processing jobs. It is
 * what advances a hosted run when nobody has the site open (Round 3 JOB-1, docs/round3/autonomous-worker.md).
 * Actions also schedule a small drain with `after()`, and the open processing page nudges one every ~20 s;
 * both are accelerators only, this route is the mechanism.
 *
 * Callers: the database scheduler (supabase/ops, POST with a signed `x-baton-dispatch` header) or a Vercel
 * schedule / cron job (POST or GET with `Authorization: Bearer <CRON_SECRET>`). See lib/pipeline/worker-auth.
 *
 * QA-M9: fails closed when CRON_SECRET is unset or too short; a fixed job budget (the caller cannot raise it);
 * counts only in the response. Task 01B: every drain holds a global worker slot (default one sweep at a
 * time); a call that finds no free slot answers 200 with `busy: 1` and does nothing. HEAD never drains.
 */

import { createConsoleLogger } from "@/lib/pipeline/log";
import { authenticateWorkerRequest } from "@/lib/pipeline/worker-auth";
import { drainJobs, type WorkerTrigger } from "@/lib/pipeline/worker";

/** The drain itself stops at 240 s (lib/pipeline); this leaves room to finish the last job. */
export const maxDuration = 300;

/** Fixed per invocation; the caller cannot raise it. */
const SWEEP_BUDGET = { maxJobs: 25, deadlineMs: 240_000 } as const;

const NO_STORE = { "cache-control": "no-store" };

async function sweep(request: Request): Promise<Response> {
  const logger = createConsoleLogger();
  const auth = authenticateWorkerRequest(request.headers, process.env.CRON_SECRET);
  if (!auth.ok) {
    // Anonymous probes (no credentials at all) are not logged; a caller that presented a credential is a
    // misconfigured scheduler (secret drift, clock skew) and is worth one line, without any detail.
    if (auth.reason !== "no_credentials") logger.warn("worker_unauthorized", { reason: auth.reason });
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const trigger: WorkerTrigger =
    auth.via === "dispatch" ? "pg_cron" : (request.headers.get("user-agent") ?? "").startsWith("vercel-cron/") ? "vercel_schedule" : "other";
  const startedAt = Date.now();
  logger.info("worker_invoked", { trigger, dispatchId: auth.dispatchId });
  try {
    const report = await drainJobs({ ...SWEEP_BUDGET, trigger });
    logger.info("worker_finished", { trigger, dispatchId: auth.dispatchId, durationMs: Date.now() - startedAt, ...report });
    return Response.json(report, { status: 200, headers: NO_STORE });
  } catch {
    // Job failures are recorded on jobs and runs; this is only an infrastructure failure. No details leak.
    logger.error("worker_failed", { trigger, dispatchId: auth.dispatchId, durationMs: Date.now() - startedAt });
    return Response.json({ error: "drain_failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request): Promise<Response> {
  return sweep(request);
}

/** Vercel cron jobs (and schedules with `requestMethod: "GET"`) call with GET; same authentication and budget. */
export async function GET(request: Request): Promise<Response> {
  return sweep(request);
}

/**
 * Explicit, so Next.js does not answer HEAD by running GET (a full drain). No authentication, no logging,
 * no database call.
 */
export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 405, headers: { ...NO_STORE, allow: "GET, POST" } });
}
