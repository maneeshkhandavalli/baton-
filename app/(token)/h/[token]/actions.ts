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

import { acceptInvite, sendInviteMagicLink } from "@/lib/supabase/invites";
import { routes } from "@/lib/routes";

export async function requestInviteLink(token: string): Promise<void> {
  await sendInviteMagicLink(token);
  redirect(`${routes.token.handover(token)}?sent=1`);
}

export async function acceptInvitation(token: string): Promise<void> {
  const result = await acceptInvite(token);
  if (!result.ok) redirect(`${routes.token.handover(token)}?error=${result.code}`);
  // Q3 proposal: lead and incoming members read the publication by membership.
  redirect(result.role === "lead" || result.role === "incoming" ? routes.handover.published(result.handoverId) : result.redirectTo);
}
