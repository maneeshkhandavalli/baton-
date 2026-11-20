/** Members, invitations and acknowledgements (§6.3, §6.19, §11.3, §12.3). */

import type { Result } from "../../contracts/api";
import type { CreatedInvitation } from "../../contracts/dto";
import {
  acknowledgePublicationInput,
  inviteMemberInput,
  memberIdInput,
  updateMemberClearanceInput,
} from "../../contracts/schemas";
import type { AcknowledgePublicationInput, InviteMemberInput, UpdateMemberClearanceInput } from "../../contracts/schemas";
import { isDbError } from "../../db/errors";
import * as mutations from "../../db/mutations";
import { consumeInviteSendLimits } from "../../db/rate-limit";
import { routes } from "../../routes";
import { deliverInvitation } from "./invitations";
import { absoluteUrl, action, failWith, ok, siteOriginOrFail } from "./run";
import type { ActionDeps } from "./types";

/**
 * Creator only (SQL). Returns the raw invitation token once, inside an absolute url built from
 * BATON_SITE_URL. R3 Task 06: the per-creator and per-recipient send limits are consumed BEFORE the token exists, and
 * the link is then emailed to the invited address when this server has an email transport (`delivery`); otherwise the
 * creator copies the link (D6). The invitee can still request a magic link on /h/[token] (§12.3).
 * Bug C: an address with an OPEN invitation (not revoked, used or expired) is refused (conflict, details.reason
 * 'invite_pending'): the creator sends a new link on that invitation (reissueInvitation) or revokes it first.
 */
export const INVITE_PENDING_REASON = "invite_pending";
export const INVITE_PENDING_MESSAGE =
  "This person already has an open invitation. Use \"Send a new link\" on it below, or revoke it first.";

export async function inviteMember(deps: ActionDeps, input: InviteMemberInput): Promise<Result<CreatedInvitation>> {
  return action(deps, inviteMemberInput, input, async (actor, v) => {
    const site = siteOriginOrFail(deps); // before the token exists: a bad config leaves no orphan token
    if (!site.ok) return site;
    await consumeInviteSendLimits(deps.adminDb(), actor.profileId, v.email); // rate_limited (invite_send): no token
    let link: Awaited<ReturnType<typeof mutations.inviteMember>>;
    try {
      link = await mutations.inviteMember(deps.adminDb(), actor, v);
    } catch (error) {
      // Bug C: one open invitation per address (SQL, 20261121400200). Nothing was created, so nothing is sent.
      if (isDbError(error) && error.code === "conflict" && error.details?.reason === INVITE_PENDING_REASON) {
        return failWith("conflict", { details: { reason: INVITE_PENDING_REASON }, message: INVITE_PENDING_MESSAGE });
      }
      if (isDbError(error) && error.code === "conflict" && error.details?.reason === "already_member") {
        return failWith("conflict", { details: { reason: "already_member" }, message: "This person is already a member." });
      }
      throw error;
    }
    const url = absoluteUrl(site.origin, routes.token.handover(link.rawToken));
    const delivery = await deliverInvitation(deps, actor, { tokenId: link.tokenId, rawToken: link.rawToken, url, expiresAt: link.expiresAt, recipientEmail: v.email });
    return ok({ tokenId: link.tokenId, url, expiresAt: link.expiresAt, delivery });
  });
}

/** Creator only; lead and incoming members only, invalid_transition for review roles (SQL, §6.3). */
export async function updateMemberClearance(deps: ActionDeps, input: UpdateMemberClearanceInput): Promise<Result<null>> {
  return action(deps, updateMemberClearanceInput, input, async (actor, v) => {
    await mutations.updateMemberClearance(deps.adminDb(), actor, v);
    return ok(null);
  });
}

export async function removeMember(deps: ActionDeps, input: { memberId: string }): Promise<Result<null>> {
  return action(deps, memberIdInput, input, async (actor, v) => {
    await mutations.removeMember(deps.adminDb(), actor, v.memberId);
    return ok(null);
  });
}

export async function acknowledgePublication(deps: ActionDeps, input: AcknowledgePublicationInput): Promise<Result<null>> {
  return action(deps, acknowledgePublicationInput, input, async (actor, v) => {
    await mutations.acknowledgePublication(deps.adminDb(), actor, v);
    return ok(null);
  });
}
