/**
 * R3 Task 06: invitations (docs/history/round3/task06-contract.md §3, §4, §5, §6.2).
 *
 *   getInvitation       read-only, works signed out; NEVER redeems (safe during render and prefetch, A4).
 *   acceptInvitation    redeems for the verified session user; call it ONLY from an explicit user submit (A4).
 *   reissueInvitation   creator only: revoke + new link for the same address and role, atomically; emails it.
 *   deliverInvitation   used by inviteMember and reissueInvitation: emails the link when a transport is configured.
 *
 * The raw token never reaches the database (only its SHA-256), never a log and never an error. `token_invalid` carries
 * `details.reason` on this path only (contract D1-contract); the UI treats an unknown reason as generic (A5).
 */

import type { MemberRole } from "../../contracts/enums";
import type { Result } from "../../contracts/api";
import type { AcceptedInvitation, CreatedInvitation, InvitationDelivery, InvitationDetails, InvitationFailureReason } from "../../contracts/dto";
import { invitationTokenInput, reissueInvitationInput } from "../../contracts/schemas";
import type { ReissueInvitationInput } from "../../contracts/schemas";
import type { VerifiedActor } from "../../db/actor-rules";
import { isDbError } from "../../db/errors";
import * as mutations from "../../db/mutations";
import { consumeInviteSendLimits } from "../../db/rate-limit";
import { DEMO_ACCOUNTS_FULL_ACCESS, isDemoAccountEmail } from "../../demo-accounts";
import { renderInvitationEmail } from "../../email/core";
import { routes } from "../../routes";
import { absoluteUrl, action, failWith, guarded, ok, siteOriginOrFail, type Failure } from "./run";
import type { ActionDeps } from "./types";

/** Where a member of this role reads the handover (lead/incoming: the publication; review roles: review). */
export function memberHref(role: MemberRole, handoverId: string): string {
  return role === "lead" || role === "incoming" ? routes.handover.published(handoverId) : routes.handover.review(handoverId);
}

const INVALID_MESSAGE: Record<InvitationFailureReason, string> = {
  invalid: "This invitation link isn't valid.",
  expired: "This invitation has expired.",
  revoked: "This invitation was withdrawn.",
  used: "This invitation has already been accepted.",
  unavailable: "This handover is no longer available.",
  email_mismatch: "This invitation is for a different email address.",
  email_unconfirmed: "Confirm your email address first, then accept the invitation.",
};

export function invitationInvalid(reason: InvitationFailureReason): Failure {
  return failWith("token_invalid", { details: { reason }, message: INVALID_MESSAGE[reason] });
}

function parseToken(input: unknown): { ok: true; token: string } | Failure {
  const parsed = invitationTokenInput.safeParse(input);
  return parsed.success ? { ok: true, token: parsed.data.token } : invitationInvalid("invalid");
}

// ── getInvitation ────────────────────────────────────────────────────────────────────────────────────────

export async function getInvitation(deps: ActionDeps, input: unknown): Promise<Result<InvitationDetails>> {
  const parsed = parseToken(input);
  if (!parsed.ok) return parsed; // malformed: no database call at all
  return guarded<InvitationDetails>(async () => {
    const viewer = await deps.getActor(); // null = signed out, which is fine here
    let row: mutations.MemberInviteDetailsRow;
    try {
      row = await mutations.getMemberInviteDetails(deps.adminDb(), parsed.token, viewer, await deps.clientIp());
    } catch (error) {
      if (isDbError(error) && error.code === "token_invalid") return invitationInvalid("invalid");
      throw error;
    }
    if (row.state === "accepted") return ok({ state: "accepted", handoverId: row.handoverId, memberHref: memberHref(row.role, row.handoverId) });
    if (row.state !== "pending") return invitationInvalid(row.state);
    return ok({
      state: "pending",
      handoverTitle: row.handoverTitle,
      inviterName: row.inviterName,
      role: row.role,
      expiresAt: row.expiresAt,
      recipientEmailMasked: row.recipientEmailMasked,
      viewer: row.viewer,
      ...(row.viewer?.alreadyMember && row.member ? { memberHref: memberHref(row.member.role, row.member.handoverId) } : {}),
    });
  });
}

// ── acceptInvitation ─────────────────────────────────────────────────────────────────────────────────────

/** Why a redemption was refused, for the holder of the token (classified with the details function, no extra limit). */
async function classifyRefusal(deps: ActionDeps, token: string, actor: VerifiedActor): Promise<Result<AcceptedInvitation>> {
  let row: mutations.MemberInviteDetailsRow;
  try {
    row = await mutations.getMemberInviteDetails(deps.adminDb(), token, actor, null, { consume: false });
  } catch {
    return invitationInvalid("invalid");
  }
  if (row.state === "accepted") {
    // A concurrent submit by the same user won: the membership exists, so this is a replay.
    return ok({ handoverId: row.handoverId, role: row.role, redirectTo: memberHref(row.role, row.handoverId), replayed: true });
  }
  if (row.state !== "pending") return invitationInvalid(row.state);
  if (row.viewer && !row.viewer.emailMatches) return invitationInvalid("email_mismatch");
  if (row.viewer && !row.viewer.emailConfirmed) return invitationInvalid("email_unconfirmed");
  return invitationInvalid("invalid");
}

export async function acceptInvitation(deps: ActionDeps, input: unknown): Promise<Result<AcceptedInvitation>> {
  const parsed = parseToken(input);
  if (!parsed.ok) return parsed;
  return guarded<AcceptedInvitation>(async () => {
    const actor = await deps.getActor();
    if (!actor) return failWith("unauthenticated");
    try {
      const m = await mutations.redeemMemberInvite(deps.adminDb(), actor, parsed.token, await deps.clientIp());
      return ok({ handoverId: m.handoverId, role: m.role, redirectTo: memberHref(m.role, m.handoverId), replayed: m.replayed });
    } catch (error) {
      if (!isDbError(error)) throw error;
      if (error.code === "token_invalid" || error.code === "unauthenticated" || error.code === "not_found") {
        return classifyRefusal(deps, parsed.token, actor);
      }
      if (error.code === "conflict" && !error.retryable) {
        // Already a member through another invitation: say where to go (the viewer is a member, so nothing leaks).
        let member: { handoverId: string; role: MemberRole } | null = null;
        try {
          const row = await mutations.getMemberInviteDetails(deps.adminDb(), parsed.token, actor, null, { consume: false });
          member = row.state === "pending" ? row.member : null;
        } catch {
          member = null;
        }
        return failWith("conflict", {
          message: "You're already a member of this handover.",
          details: member ? { reason: "already_member", handoverId: member.handoverId, memberHref: memberHref(member.role, member.handoverId) } : { reason: "already_member" },
        });
      }
      throw error;
    }
  });
}

// ── delivery ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Emails a freshly created invitation link to the invited address, when this server has a transport. Never fails the
 * invitation: every outcome is a delivery value, and the creator always has the copyable link (D6). The outcome is
 * recorded (status only; never the address, link or provider text).
 *
 * Round 4 (Gmail):
 *   * exactly ONE send attempt per created token; a failure never creates, revokes or reissues a token, so the link
 *     the creator copies keeps working (expiry, email match and single use are unchanged: they live in SQL);
 *   * `not_connected` (Gmail has no usable refresh token) is recorded and returned like "email not configured";
 *   * shared demo accounts never send email (F3): the link is still created and returned for copying.
 */
export async function deliverInvitation(
  deps: ActionDeps,
  actor: VerifiedActor,
  link: { tokenId: string; rawToken: string; url: string; expiresAt: string; recipientEmail: string },
): Promise<InvitationDelivery> {
  const record = async (status: "sent" | "not_sent" | "failed", reason: "email_not_configured" | "provider_failed" | "rate_limited" | null, providerRef: string | null) => {
    try {
      await mutations.recordInvitationDelivery(deps.adminDb(), actor, { tokenId: link.tokenId, status, reason, providerRef });
    } catch {
      deps.logIssue("invitation_delivery_not_recorded", { tokenId: link.tokenId, status });
    }
  };

  if (!DEMO_ACCOUNTS_FULL_ACCESS && isDemoAccountEmail(actor.email)) {
    await record("not_sent", null, null);
    return { status: "not_sent", reason: "demo" };
  }

  const transport = deps.email();
  if (!transport.configured) {
    await record("not_sent", "email_not_configured", null);
    return { status: "not_sent", reason: "email_not_configured" };
  }

  let message;
  try {
    const row = await mutations.getMemberInviteDetails(deps.adminDb(), link.rawToken, null, null, { consume: false });
    if (row.state !== "pending") throw new Error("not pending");
    message = renderInvitationEmail({
      to: link.recipientEmail,
      handoverTitle: row.handoverTitle,
      inviterName: row.inviterName,
      role: row.role,
      url: link.url,
      expiresAt: link.expiresAt,
    });
  } catch {
    await record("failed", "provider_failed", null);
    return { status: "not_sent", reason: "provider_failed" };
  }

  let sent;
  try {
    sent = await transport.send(message);
  } catch {
    sent = { ok: false as const, kind: "failed" as const };
  }
  if (sent.ok) {
    await record("sent", null, sent.ref);
    return { status: "sent" };
  }
  deps.logIssue("invitation_email_failed", { tokenId: link.tokenId, kind: sent.kind });
  if (sent.kind === "not_connected") {
    await record("not_sent", "email_not_configured", null);
    return { status: "not_sent", reason: "email_not_configured" };
  }
  await record("failed", sent.kind === "rate_limited" ? "rate_limited" : "provider_failed", null);
  return { status: "not_sent", reason: "provider_failed" };
}

// ── reissueInvitation ────────────────────────────────────────────────────────────────────────────────────

export async function reissueInvitation(deps: ActionDeps, input: ReissueInvitationInput): Promise<Result<CreatedInvitation>> {
  return action(deps, reissueInvitationInput, input, async (actor, v) => {
    const site = siteOriginOrFail(deps); // before the new token exists
    if (!site.ok) return site;
    const db = deps.adminDb();
    const recipient = await mutations.memberInviteRecipient(db, actor, v.tokenId); // creator only, else not_found
    await consumeInviteSendLimits(db, actor.profileId, recipient); // before the new token exists
    const link = await mutations.reissueMemberInvite(db, actor, v);
    const url = absoluteUrl(site.origin, routes.token.handover(link.rawToken));
    const delivery = await deliverInvitation(deps, actor, { tokenId: link.tokenId, rawToken: link.rawToken, url, expiresAt: link.expiresAt, recipientEmail: link.recipientEmail });
    return ok({ tokenId: link.tokenId, url, expiresAt: link.expiresAt, delivery });
  });
}

// ── requestInvitationSignInLink ──────────────────────────────────────────────────────────────────────────

/**
 * Emails a sign-in link to the INVITED address (lib/supabase/invites.ts sendInviteMagicLink: the address never reaches
 * the browser; rate limited per client and token). Always `{ sent: true }`, whatever the token: the answer never says
 * whether the link is valid.
 */
export async function requestInvitationSignInLink(
  send: (rawToken: string) => Promise<unknown>,
  input: unknown,
): Promise<Result<{ sent: true }>> {
  const parsed = invitationTokenInput.safeParse(input);
  if (parsed.success) {
    try {
      await send(parsed.data.token);
    } catch {
      // same answer either way
    }
  }
  return ok({ sent: true as const });
}
