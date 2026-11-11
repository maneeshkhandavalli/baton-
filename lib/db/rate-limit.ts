/**
 * Rate limiting for token and invitation paths (audit finding M6, D12, §12.4).
 *
 * Counters live in Postgres (public.rate_limit_counters; limits are fixed in SQL per scope). Each counter
 * is consumed in its OWN database call BEFORE the protected operation, so the hit is committed even when
 * that operation later fails — an invalid or exhausted token still counts against the client.
 *
 * Subjects are SHA-256 hex digests computed here: the client IP is never stored, and tokens are counted by
 * the same hash the database stores (never the raw token).
 */

import type { DbClient } from "./client";
import { DbError } from "./errors";
import { callRpc } from "./rpc";
import { sha256Hex } from "./tokens";

export type RateLimitedAction = "gap_interview_view" | "gap_interview_submit" | "invite_magic_link" | "invite_redeem";

/** Hash a client IP for counting. Returns null when no IP is known (the per-token limit still applies). */
export async function clientSubject(ip: string | null | undefined): Promise<string | null> {
  const value = ip?.trim();
  if (!value) return null;
  return sha256Hex(`baton-rate-limit:client:${value.toLowerCase()}`);
}

/**
 * Consume one hit for the client and for the token. Throws `DbError("rate_limited")` (retryable) when either
 * is over its limit. `tokenHashHex` is SHA-256(raw token), the same value stored as access_tokens.token_hash.
 */
export async function consumeRateLimits(
  db: DbClient,
  action: RateLimitedAction,
  subjects: { client: string | null; tokenHashHex: string | null },
): Promise<void> {
  let allowed = true;
  if (subjects.client) {
    allowed = (await callRpc(db, "consume_rate_limit", { p_scope: `${action}_client`, p_subject: subjects.client })) === true && allowed;
  }
  if (subjects.tokenHashHex) {
    allowed = (await callRpc(db, "consume_rate_limit", { p_scope: `${action}_token`, p_subject: subjects.tokenHashHex })) === true && allowed;
  }
  if (!allowed) throw new DbError("rate_limited", undefined, true);
}
