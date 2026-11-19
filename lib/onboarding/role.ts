/**
 * Round 4 (Worker 02): which guidance a signed-in user gets, derived ONLY from their real memberships
 * (listMyHandovers: viewerRole, viewerIsCreator). Pure (components/shared/__tests__/onboarding-role.test.ts).
 *
 *   creator   · prepares handovers: the creator of any handover, or an outgoing/reviewer member. Also a user with
 *               no handovers at all, since any signed-in user can start one.
 *   incoming  · receives handovers: an incoming or lead member.
 *
 * A user can be both. The primary role is the side of their most recently updated handover, so the welcome and
 * the default tour match what they are doing now; Help offers every role they actually have, never another one.
 */

import type { HandoverSummary } from "../contracts/dto";
import type { MemberRole } from "../contracts/enums";
import type { GuideRole } from "./state";

export type RoleInput = Pick<HandoverSummary, "id" | "viewerRole" | "viewerIsCreator" | "updatedAt" | "state" | "currentPublicationId">;

export interface GuideRoles {
  /** Every role this user actually has (never empty). */
  roles: GuideRole[];
  primary: GuideRole;
  /** The handover each role's guidance is about: the most recently updated one on that side, or null. */
  focus: Partial<Record<GuideRole, string>>;
}

const RECEIVING: readonly MemberRole[] = ["incoming", "lead"];

export function guideSideOf(h: Pick<HandoverSummary, "viewerRole" | "viewerIsCreator">): GuideRole {
  return !h.viewerIsCreator && RECEIVING.includes(h.viewerRole) ? "incoming" : "creator";
}

const newestFirst = (a: RoleInput, b: RoleInput) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

export function resolveGuideRoles(handovers: readonly RoleInput[]): GuideRoles {
  if (handovers.length === 0) return { roles: ["creator"], primary: "creator", focus: {} };
  const sorted = [...handovers].sort(newestFirst);
  const creating = sorted.filter((h) => guideSideOf(h) === "creator");
  const receiving = sorted.filter((h) => guideSideOf(h) === "incoming");
  const roles: GuideRole[] = [...(creating.length ? (["creator"] as const) : []), ...(receiving.length ? (["incoming"] as const) : [])];
  const focus: Partial<Record<GuideRole, string>> = {};
  // A creator's focus is a handover they created when there is one (only the creator publishes and invites).
  const ownCreated = creating.find((h) => h.viewerIsCreator);
  if (creating.length) focus.creator = (ownCreated ?? creating[0]).id;
  // An incoming member's focus prefers a published handover (that is where there is something to read).
  if (receiving.length) focus.incoming = (receiving.find((h) => h.currentPublicationId) ?? receiving[0]).id;
  return { roles, primary: guideSideOf(sorted[0]), focus };
}
