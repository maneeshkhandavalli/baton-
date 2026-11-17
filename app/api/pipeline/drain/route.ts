/**
 * Pipeline worker endpoint (D10, §9.3): the scheduled sweep that claims and runs due processing jobs. It is
 * what advances a hosted run when nobody has the site open (Round 3 JOB-1, docs/round3/autonomous-worker.md).
 * Actions also schedule a small drain with `after()`, and the open processing page nudges one every ~20 s;
 * both are accelerators only, this route is the mechanism.
 *
 * Callers: a database scheduler (Supabase pg_cron + pg_net, POST) or a Vercel schedule (POST, or GET for a
 * legacy Vercel cron job). Both methods behave identically.
 *
 * QA-M9: `Authorization: Bearer <CRON_SECRET>` compared in constant time; fails closed when the secret is
 * unset or too short; a fixed job budget (the caller cannot raise it); counts only in the response.
 * Overlapping invocations are safe: claims, leases, fencing, retries and reaping all live in the database
 * (claim_ready_processing_jobs, DB-1/DB-12/DB-13), so concurrent sweeps never run the same job attempt.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { createConsoleLogger } from "@/lib/pipeline/log";
import { drainJobs } from "@/lib/pipeline/worker";

/** The drain itself stops at 240 s (lib/pipeline); this leaves room to finish the last job. */
export const maxDuration = 300;

/** Fixed per invocation; the caller cannot raise it. */
const SWEEP_BUDGET = { maxJobs: 25, deadlineMs: 240_000 } as const;

const MIN_SECRET_LENGTH = 32;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  // Equal-length digests, so the comparison time never depends on the secret or the presented value.
  return timingSafeEqual(digest(presented), digest(secret)) && presented.length > 0;
}

/** Which scheduler called, for the logs only (a fixed token, never the raw header). */
function triggerOf(request: Request): "pg_cron" | "vercel_schedule" | "other" {
  if (request.headers.get("x-baton-trigger") === "pg_cron") return "pg_cron";
  if ((request.headers.get("user-agent") ?? "").startsWith("vercel-cron/")) return "vercel_schedule";
  return "other";
}

const NO_STORE = { "cache-control": "no-store" };

async function sweep(request: Request): Promise<Response> {
  const logger = createConsoleLogger();
  if (!authorised(request)) {
    // A scheduler whose secret drifted from CRON_SECRET shows up here (no details are logged).
    logger.warn("worker_unauthorized", { trigger: triggerOf(request) });
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const startedAt = Date.now();
  const trigger = triggerOf(request);
  logger.info("worker_invoked", { trigger });
  try {
    const report = await drainJobs({ ...SWEEP_BUDGET });
    logger.info("worker_finished", { trigger, durationMs: Date.now() - startedAt, ...report });
    return Response.json(report, { status: 200, headers: NO_STORE });
  } catch {
    // Job failures are recorded on jobs and runs; this is only an infrastructure failure. No details leak.
    logger.error("worker_failed", { trigger, durationMs: Date.now() - startedAt });
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
