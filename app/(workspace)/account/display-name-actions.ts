"use server";

/**
 * Round 4 audit D1: change the signed-in user's own display name (the name other members see instead of the email
 * prefix). Shared demo accounts keep theirs. The database re-checks every rule (set_own_display_name).
 */

import { checkDisplayName } from "@/components/account/display-name";
import { serverDb } from "@/lib/db";
import { getVerifiedActor } from "@/lib/db/actor";
import { isDbError } from "@/lib/db/errors";
import { callRpc } from "@/lib/db/rpc";
import { DEMO_ACCOUNT_REFUSAL, DEMO_ACCOUNTS_FULL_ACCESS, isDemoAccountEmail } from "@/lib/demo-accounts";

export type DisplayNameResult = { ok: true; name: string } | { ok: false; message: string };

export async function updateDisplayName(raw: string): Promise<DisplayNameResult> {
  const checked = checkDisplayName(raw);
  if (!checked.ok) return checked;
  const actor = await getVerifiedActor();
  if (!actor) return { ok: false, message: "Your session has ended. Sign in again." };
  if (!DEMO_ACCOUNTS_FULL_ACCESS && isDemoAccountEmail(actor.email)) return { ok: false, message: DEMO_ACCOUNT_REFUSAL };
  try {
    const name = await callRpc(serverDb(), "set_own_display_name", { p_actor_profile_id: actor.profileId, p_display_name: checked.name });
    return { ok: true, name: typeof name === "string" ? name : checked.name };
  } catch (error) {
    if (isDbError(error) && error.code === "validation_failed") return { ok: false, message: "That name can't be used. Use 1 to 60 ordinary characters." };
    console.error("[account] display name update failed", { code: isDbError(error) ? error.code : "unknown" });
    return { ok: false, message: "Something went wrong on our side. Please try again." };
  }
}
