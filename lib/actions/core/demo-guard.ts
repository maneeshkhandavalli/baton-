/**
 * Shared demo accounts (lib/demo-accounts.ts) may not run destructive account actions: delete the account or
 * erase participants. The refusal uses the standard Result contract: `forbidden` with a fixed message and
 * details.reason "demo_account".
 */

import { DEMO_ACCOUNT_REFUSAL, DEMO_ACCOUNTS_FULL_ACCESS, DEMO_CONTENT_REFUSAL, isDemoAccountEmail } from "../../demo-accounts";
import type { VerifiedActor } from "../../db/actor-rules";
import { failWith, type Failure } from "./run";

export const DEMO_ACCOUNT_REASON = "demo_account";
export const DEMO_CONTENT_REASON = "demo_account_content";

/** A `forbidden` failure when the verified actor is a shared demo account, otherwise null. */
export function refuseDemoAccount(actor: VerifiedActor): Failure | null {
  if (!isDemoAccountEmail(actor.email)) return null;
  return failWith("forbidden", { message: DEMO_ACCOUNT_REFUSAL, retryable: false, details: { reason: DEMO_ACCOUNT_REASON } });
}

/**
 * F3: a `forbidden` failure when a shared demo account tries to add content or start paid AI work (new handover,
 * upload, new source version, source consent, processing, revision, deletion), otherwise null.
 */
export function refuseDemoContent(actor: VerifiedActor): Failure | null {
  if (DEMO_ACCOUNTS_FULL_ACCESS || !isDemoAccountEmail(actor.email)) return null; // judges have full access (21 Nov)
  return failWith("forbidden", { message: DEMO_CONTENT_REFUSAL, retryable: false, details: { reason: DEMO_CONTENT_REASON } });
}
