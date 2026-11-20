"use server";

/**
 * Invitation Server Functions (R3 Task 06, docs/history/round3/task06-contract.md §6.2). Logic: lib/actions/core/invitations.ts.
 * acceptInvitation must be called ONLY from an explicit user submit; getInvitation never redeems (A4).
 */

import type { Result } from "../contracts/api";
import type { AcceptedInvitation, CreatedInvitation, InvitationDetails } from "../contracts/dto";
import type { InvitationTokenInput, ReissueInvitationInput } from "../contracts/schemas";
import { sendInviteMagicLink } from "../supabase/invites";
import * as core from "./core/invitations";
import { actionDeps } from "./deps";

export async function getInvitation(input: InvitationTokenInput): Promise<Result<InvitationDetails>> {
  return core.getInvitation(actionDeps(), input);
}

export async function acceptInvitation(input: InvitationTokenInput): Promise<Result<AcceptedInvitation>> {
  return core.acceptInvitation(actionDeps(), input);
}

export async function reissueInvitation(input: ReissueInvitationInput): Promise<Result<CreatedInvitation>> {
  return core.reissueInvitation(actionDeps(), input);
}

export async function requestInvitationSignInLink(input: InvitationTokenInput): Promise<Result<{ sent: true }>> {
  return core.requestInvitationSignInLink(sendInviteMagicLink, input);
}
