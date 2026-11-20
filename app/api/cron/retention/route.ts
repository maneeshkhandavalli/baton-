/**
 * Raw-upload retention endpoint (Round 3 Task 02, PRIV-2; lib/retention/sweep.ts). OFF unless the owner sets
 * BATON_RETENTION_MODE ("dry_run" or "live") on the deployment; an invalid setting is OFF.
 *
 * Callers: the database scheduler (supabase/ops/schedule-raw-retention.sql, POST with a signed
 * `x-baton-dispatch` header bound to the "retention" purpose: a pipeline-drain header is refused here) or a
 * Vercel schedule / manual call (POST or GET with `Authorization: Bearer <CRON_SECRET>`). Same credentials and
 * conventions as the pipeline worker (docs/architecture/autonomous-worker.md); no second scheduler.
 *
 * The response and logs hold counts only. HEAD never runs the sweep.
 */

import { serverDb, serverStorage } from "@/lib/db";
import { createConsoleLogger } from "@/lib/pipeline/log";
import { authenticateWorkerRequest } from "@/lib/pipeline/worker-auth";
import { retentionConfig, runRetentionSweep } from "@/lib/retention/sweep";

export const maxDuration = 300;

/** The sweep stops claiming and deleting after this; the rest is picked up by the next run. */
const SWEEP_DEADLINE_MS = 120_000;

const NO_STORE = { "cache-control": "no-store" };

async function handle(request: Request): Promise<Response> {
  const logger = createConsoleLogger();
  const auth = authenticateWorkerRequest(request.headers, process.env.CRON_SECRET, Date.now(), "retention");
  if (!auth.ok) {
    if (auth.reason !== "no_credentials") logger.warn("retention_unauthorized", { reason: auth.reason });
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const config = retentionConfig();
  if (config.mode === "off") {
    if ("invalid" in config) logger.warn("retention_config_invalid", { setting: config.invalid.toLowerCase() });
    return Response.json({ mode: "off" }, { status: 200, headers: NO_STORE });
  }
  const trigger =
    auth.via === "dispatch" ? "pg_cron" : (request.headers.get("user-agent") ?? "").startsWith("vercel-cron/") ? "vercel_schedule" : "manual";
  try {
    const report = await runRetentionSweep(
      { db: serverDb(), storage: serverStorage(), logger },
      { mode: config.mode, policy: config.policy, trigger, deadlineMs: SWEEP_DEADLINE_MS },
    );
    return Response.json(report, { status: 200, headers: NO_STORE });
  } catch {
    logger.error("retention_sweep_failed", { trigger, dispatchId: auth.dispatchId });
    return Response.json({ error: "retention_failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return handle(request);
}

/** Explicit, so Next.js does not answer HEAD by running GET. */
export async function HEAD(): Promise<Response> {
  return new Response(null, { status: 405, headers: { ...NO_STORE, allow: "GET, POST" } });
}
