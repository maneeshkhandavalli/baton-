"use server";

/**
 * Invitation form actions for /h/[token] (§12.3; R3 Task 06 frozen contract §4.2, A4). They wrap the invitation
 * Server Functions in lib/actions/invitations.ts:
 *   1. requestInviteLink: emails a sign-in link to the INVITED address (never one the visitor types); the outcome
 *      never says whether the token was valid (requestInvitationSignInLink always answers { sent: true }).
 *   2. acceptInvitationFromForm: redeems the invitation for the verified session user. It is bound to a form and
 *      runs only on an explicit submit, never during render or prefetch (A4). A failure comes back as
 *      `?error=<code>&reason=<reason>` (tokens only), which the page maps to its screen.
 */

import { redirect } from "next/navigation";

import { acceptFailureQuery, safeInternalPath } from "@/components/invitations/invitation-view";
import { acceptInvitation, requestInvitationSignInLink } from "@/lib/actions/invitations";
import { isWellFormedToken } from "@/lib/db/tokens";
import type { GoogleStartResult } from "@/lib/supabase/oauth-core";
import { startGoogleOAuth } from "@/lib/supabase/oauth";
import { routes } from "@/lib/routes";

export async function requestInviteLink(token: string): Promise<void> {
  await requestInvitationSignInLink({ token });
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

export async function acceptInvitationFromForm(token: string): Promise<void> {
  const result = await acceptInvitation({ token });
  if (!result.ok) {
    // Signed out meanwhile: the invitation page shows the sign-in state again, with what the invitation is for.
    if (result.error.code === "unauthenticated") redirect(routes.token.handover(token));
    redirect(`${routes.token.handover(token)}?${acceptFailureQuery(result.error)}`);
  }
  const { role, handoverId, redirectTo } = result.data;
  // Lead and incoming members read the publication by membership (as before); review roles go where the server says.
  if (role === "lead" || role === "incoming") redirect(routes.handover.published(handoverId));
  redirect(safeInternalPath(redirectTo) ?? routes.handover.review(handoverId));
}
