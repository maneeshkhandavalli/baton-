/**
 * Pipeline worker endpoint (D10, §9.3): the cron sweep that claims and runs due processing jobs. Actions
 * also schedule a small drain with `after()`; this route is the backstop.
 *
 * QA-M9: POST only; `Authorization: Bearer <CRON_SECRET>` compared in constant time; fails closed when the
 * secret is unset or too short; a fixed job budget (the caller cannot raise it); counts only in the response.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import { drainJobs } from "@/lib/pipeline/worker";

/** The drain itself stops at 240 s (lib/pipeline); this leaves room to finish the last job. */
export const maxDuration = 300;

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

const NO_STORE = { "cache-control": "no-store" };

export async function POST(request: Request): Promise<Response> {
  if (!authorised(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  try {
    const report = await drainJobs({ maxJobs: 25, deadlineMs: 240_000 });
    return Response.json(report, { status: 200, headers: NO_STORE });
  } catch {
    // Job failures are recorded on jobs and runs; this is only an infrastructure failure. No details leak.
    return Response.json({ error: "drain_failed" }, { status: 500, headers: NO_STORE });
  }
}
