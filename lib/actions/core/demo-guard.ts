/**
 * Shared demo accounts (lib/demo-accounts.ts) may not run destructive account actions: delete the account or
 * erase participants. The refusal uses the standard Result contract: `forbidden` with a fixed message and
 * details.reason "demo_account".
 */

import { DEMO_ACCOUNT_REFUSAL, isDemoAccountEmail } from "../../demo-accounts";
import type { VerifiedActor } from "../../db/actor-rules";
import { failWith, type Failure } from "./run";

export const DEMO_ACCOUNT_REASON = "demo_account";

/** A `forbidden` failure when the verified actor is a shared demo account, otherwise null. */
export function refuseDemoAccount(actor: VerifiedActor): Failure | null {
  if (!isDemoAccountEmail(actor.email)) return null;
  return failWith("forbidden", { message: DEMO_ACCOUNT_REFUSAL, retryable: false, details: { reason: DEMO_ACCOUNT_REASON } });
}
