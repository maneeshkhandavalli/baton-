"use server";

/** Member Server Functions (§11.3). Logic: lib/actions/core/members.ts. */

import type { Result } from "../contracts/api";
import type { CreatedLink } from "../contracts/dto";
import type { AcknowledgePublicationInput, InviteMemberInput, UpdateMemberClearanceInput } from "../contracts/schemas";
import * as core from "./core/members";
import { actionDeps } from "./deps";

export async function inviteMember(input: InviteMemberInput): Promise<Result<CreatedLink>> {
  return core.inviteMember(actionDeps(), input);
}

export async function updateMemberClearance(input: UpdateMemberClearanceInput): Promise<Result<null>> {
  return core.updateMemberClearance(actionDeps(), input);
}

export async function removeMember(input: { memberId: string }): Promise<Result<null>> {
  return core.removeMember(actionDeps(), input);
}

export async function acknowledgePublication(input: AcknowledgePublicationInput): Promise<Result<null>> {
  return core.acknowledgePublication(actionDeps(), input);
}
