import "server-only";

/**
 * Invitation flow for /h/[token] (§12.3). The page is UI-owned; main wraps these in Server Functions.
 *   1. sendInviteMagicLink(rawToken): check the token on the server and send a magic link to the INVITED
 *      address (never to an address the visitor types). The address never reaches the browser, and the
 *      result is the same for valid, invalid and rate-limited tokens.
 *   2. After sign-in the link returns to /h/[token]; acceptInvite(rawToken) redeems it for the verified
 *      session user. H3: the database reads that user's email and confirmation state from auth.users and
 *      refuses unconfirmed or different addresses; the same rule is checked here first.
 *
 * M1: the redirect destination is built only from BATON_SITE_URL, never from request headers or a
 * caller-supplied origin. M6: magic-link requests and redemptions are rate-limited per client and token.
 */

import type { MemberRole } from "../contracts/enums";
import { routes } from "../routes";
import { getVerifiedActor } from "../db/actor";
import { canRedeemInvitation } from "../db/actor-rules";
import { isDbError } from "../db/errors";
import { peekMemberInvite, redeemMemberInvite } from "../db/mutations";
import { isWellFormedToken } from "../db/tokens";
import { createSupabaseAdminClient } from "./admin";
import { asDbClient } from "./db";
import { requestClientIp } from "./request-ip";
import { createSupabaseServerClient } from "./server";
import { authCallbackUrl } from "./site-url";

export async function sendInviteMagicLink(rawToken: string): Promise<{ sent: true }> {
  if (!isWellFormedToken(rawToken)) return { sent: true };
  try {
    const emailRedirectTo = authCallbackUrl(routes.token.handover(rawToken)); // throws if BATON_SITE_URL is unsafe
    const { recipientEmail } = await peekMemberInvite(asDbClient(createSupabaseAdminClient()), rawToken, await requestClientIp());
    const supabase = await createSupabaseServerClient(); // stores the PKCE verifier in this browser
    await supabase.auth.signInWithOtp({
      email: recipientEmail,
      options: { emailRedirectTo, shouldCreateUser: true },
    });
  } catch (error) {
    if (!isDbError(error)) console.error("[invite] magic link failed");
  }
  return { sent: true }; // never say whether the token was valid or limited (§3.2 token_invalid)
}

export type AcceptInviteResult =
  | { ok: true; handoverId: string; role: MemberRole; redirectTo: string }
  | { ok: false; code: "unauthenticated" | "token_invalid" | "conflict" | "rate_limited" | "internal" };

export async function acceptInvite(rawToken: string): Promise<AcceptInviteResult> {
  if (!isWellFormedToken(rawToken)) return { ok: false, code: "token_invalid" };
  const actor = await getVerifiedActor(); // verified by the Auth server
  if (!actor) return { ok: false, code: "unauthenticated" };
  if (!canRedeemInvitation(actor)) return { ok: false, code: "token_invalid" }; // unconfirmed email (H3)

  try {
    const member = await redeemMemberInvite(asDbClient(createSupabaseAdminClient()), actor, rawToken, await requestClientIp());
    // §12.3 step 6: review roles go to the review workspace; lead and incoming to their dashboard.
    const redirectTo =
      member.role === "outgoing" || member.role === "reviewer"
        ? routes.handover.review(member.handoverId)
        : routes.dashboard;
    return { ok: true, handoverId: member.handoverId, role: member.role, redirectTo };
  } catch (error) {
    if (isDbError(error)) {
      if (error.code === "conflict") return { ok: false, code: "conflict" };
      if (error.code === "rate_limited") return { ok: false, code: "rate_limited" };
      if (error.code !== "internal") return { ok: false, code: "token_invalid" };
    }
    return { ok: false, code: "internal" };
  }
}
