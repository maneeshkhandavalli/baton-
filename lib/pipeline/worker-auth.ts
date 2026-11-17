/**
 * Worker endpoint authentication (QA-M9, Task 01B). Two accepted credentials, both derived from CRON_SECRET
 * (≥ 32 characters; unset or shorter fails closed):
 *
 * 1. `Authorization: Bearer <CRON_SECRET>`: what Vercel cron jobs / schedules send, and manual calls.
 * 2. `x-baton-dispatch: v1.<unix seconds>.<dispatch id>.<hex HMAC-SHA256(CRON_SECRET, "v1.<unix seconds>.<dispatch id>")>`:
 *    what the database scheduler sends (supabase/ops). The secret itself never travels and is never written
 *    to pg_net's request queue (which Supabase grants to PUBLIC); a captured header is only good for
 *    DISPATCH_MAX_AGE_S and only ever triggers a slot-limited drain.
 *
 * Every comparison is constant-time over fixed-length digests. Nothing here logs or returns the secret.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MIN_SECRET_LENGTH = 32;
/** A signed dispatch is accepted for this long after it was signed ... */
export const DISPATCH_MAX_AGE_S = 120;
/** ... and this far in the future (clock skew between the database and the function). */
export const DISPATCH_MAX_SKEW_S = 30;

const DISPATCH = /^v1\.(\d{9,11})\.(\d{1,18})\.([0-9a-f]{64})$/;

export type WorkerAuth =
  | { ok: true; via: "bearer" | "dispatch"; dispatchId: number | null }
  | { ok: false; reason: "no_credentials" | "secret_unset" | "bad_bearer" | "bad_dispatch" | "stale_dispatch" };

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function sameSecret(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b)) && a.length > 0;
}

/** The dispatch signature for (`signedAt`, `dispatchId`), lower-case hex. Exported for tests and docs. */
export function signDispatch(secret: string, signedAt: number, dispatchId: number | string): string {
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(`v1.${signedAt}.${dispatchId}`, "utf8").digest("hex");
}

export function authenticateWorkerRequest(headers: Headers, secret: string | undefined, nowMs: number = Date.now()): WorkerAuth {
  const authorization = headers.get("authorization");
  const dispatch = headers.get("x-baton-dispatch");
  if (authorization === null && dispatch === null) return { ok: false, reason: "no_credentials" };
  if (!secret || secret.length < MIN_SECRET_LENGTH) return { ok: false, reason: "secret_unset" };

  if (dispatch !== null) {
    const m = DISPATCH.exec(dispatch.trim());
    if (!m) return { ok: false, reason: "bad_dispatch" };
    const signedAt = Number(m[1]);
    const expected = signDispatch(secret, signedAt, m[2]);
    if (!sameSecret(m[3], expected)) return { ok: false, reason: "bad_dispatch" };
    const age = Math.floor(nowMs / 1000) - signedAt;
    if (age > DISPATCH_MAX_AGE_S || age < -DISPATCH_MAX_SKEW_S) return { ok: false, reason: "stale_dispatch" };
    return { ok: true, via: "dispatch", dispatchId: Number(m[2]) };
  }

  const presented = authorization!.startsWith("Bearer ") ? authorization!.slice("Bearer ".length) : "";
  return sameSecret(presented, secret) ? { ok: true, via: "bearer", dispatchId: null } : { ok: false, reason: "bad_bearer" };
}
