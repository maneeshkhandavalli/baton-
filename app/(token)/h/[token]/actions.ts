"use server";

/**
 * Invitation Server Functions for /h/[token] (§12.3). They wrap lib/supabase/invites:
 *   1. requestInviteLink: emails a magic link to the INVITED address (never one the visitor types); the
 *      outcome never says whether the token was valid.
 *   2. acceptInvitation: redeems the invitation for the verified session user (H3: the database checks the
 *      user's confirmed email against the invitation).
 * Both run only on an explicit form submit, never during render, so a prefetch can never redeem a token.
 */

import { redirect } from "next/navigation";

import { isWellFormedToken } from "@/lib/db/tokens";
import { acceptInvite, sendInviteMagicLink } from "@/lib/supabase/invites";
import type { GoogleStartResult } from "@/lib/supabase/oauth-core";
import { startGoogleOAuth } from "@/lib/supabase/oauth";
import { routes } from "@/lib/routes";

export async function requestInviteLink(token: string): Promise<void> {
  await sendInviteMagicLink(token);
  redirect(`${routes.token.handover(token)}?sent=1`);
}

/**
 * Google sign-in for an invitation: returns to this invitation after sign-in, where the visitor accepts it.
 * The invitation itself is still checked on accept (H3: the signed-in email must be the invited address).
 */
export async function startGoogleInviteSignIn(token: string): Promise<GoogleStartResult> {
  if (typeof token !== "string" || !isWellFormedToken(token)) {
    return { status: "error", message: "This invitation link isn't valid. Ask the person who invited you for a new one." };
  }
  return startGoogleOAuth(routes.token.handover(token));
}

export async function acceptInvitation(token: string): Promise<void> {
  const result = await acceptInvite(token);
  if (!result.ok) redirect(`${routes.token.handover(token)}?error=${result.code}`);
  // Q3 proposal: lead and incoming members read the publication by membership.
  redirect(result.role === "lead" || result.role === "incoming" ? routes.handover.published(result.handoverId) : result.redirectTo);
}
