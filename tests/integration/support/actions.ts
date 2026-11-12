/**
 * Shared set-up for action-level scenarios: the REAL Server Functions (lib/actions/*.ts → actionDeps() →
 * lib/db → lib/supabase) run against the Recording* backends via the approved platform stubs. Identity
 * comes only from the stubbed Auth server (signInAs), as in production from auth.getUser().
 */

import { randomUUID } from "node:crypto";

import { installBackends, resetPlatform, signInAs, type Backends } from "./platform";

export const ACTOR = "0b6a1c1e-1f00-4c3b-9d7a-0000000000c3";
export const OTHER_PROFILE = "0b6a1c1e-1f00-4c3b-9d7a-0000000000d4";

export interface ActionWorld extends Backends {
  ids: { handover: string; source: string; point: string; question: string; answer: string; token: string; member: string; evidence: string };
}

/** Fresh platform, fresh backends, signed in as ACTOR (unless `signedIn` is false). */
export function actionWorld(signedIn = true): ActionWorld {
  resetPlatform();
  const backends = installBackends();
  if (signedIn) signInAs(ACTOR);
  return {
    ...backends,
    ids: {
      handover: randomUUID(), source: randomUUID(), point: randomUUID(), question: randomUUID(),
      answer: randomUUID(), token: randomUUID(), member: randomUUID(), evidence: randomUUID(),
    },
  };
}

/** Every RPC either database client received, in order. */
export function allCalls(w: Backends) {
  return [...w.adminDb.calls.map((c) => ({ client: "admin", ...c })), ...w.userDb.calls.map((c) => ({ client: "user", ...c }))];
}

export const WRITE_RPCS = [
  "create_handover", "update_handover_details", "start_processing", "cancel_processing", "publish_handover", "start_revision", "delete_handover",
  "offer_creator_transfer", "respond_to_creator_transfer", "acknowledge_publication", "approve_point", "reject_point",
  "reopen_point", "edit_point", "confirm_inferred", "resolve_conflict", "exclude_evidence", "restore_evidence",
  "change_point_access", "create_manual_point", "create_gap_question", "submit_gap_answers", "review_gap_answer",
  "create_source", "confirm_source_uploaded", "record_source_consent", "add_exclusion", "confirm_identity_match",
  "remove_source", "create_gap_interview_link", "revoke_access_token", "invite_member", "update_member_clearance",
  "remove_member", "resolve_privacy_review", "erase_participant", "erasure_target", "purge_handover",
  "check_account_deletion", "delete_account_data", "submit_gap_answers_with_token", "redeem_member_invite",
  "transition_handover", "finish_processing_run",
] as const;
