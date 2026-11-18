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

export type RateLimitedAction =
  | "gap_interview_view"
  | "gap_interview_submit"
  | "invite_magic_link"
  | "invite_redeem"
  | "invite_view"; // R3 Task 06 (20261118700300)

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

/**
 * R3 Task 06: sending an invitation (and so, possibly, an email) is limited per creator and per recipient address,
 * BEFORE the invitation exists. Both subjects are SHA-256 digests; the address and the profile id are never stored.
 * Throws `DbError("rate_limited")` with `details.reason = "invite_send"` when either is over its limit.
 */
export async function consumeInviteSendLimits(db: DbClient, actorProfileId: string, recipientEmail: string): Promise<void> {
  const actor = await sha256Hex(`baton-rate-limit:actor:${actorProfileId.toLowerCase()}`);
  const recipient = await sha256Hex(`baton-rate-limit:recipient:${recipientEmail.trim().toLowerCase()}`);
  let allowed = (await callRpc(db, "consume_rate_limit", { p_scope: "invite_send_actor", p_subject: actor })) === true;
  allowed = (await callRpc(db, "consume_rate_limit", { p_scope: "invite_send_recipient", p_subject: recipient })) === true && allowed;
  if (!allowed) {
    const error = new DbError("rate_limited", undefined, true);
    (error as unknown as { details: Record<string, string> }).details = { reason: "invite_send" };
    throw error;
  }
}
