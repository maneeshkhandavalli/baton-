/**
 * Round 4 B (audit F4): mock of "Confirm & approve" (mirrors confirm_testimony_and_approve, migration 20261121200100),
 * kept out of lib/mocks/actions.ts like the other Living Handover actions (change reviews live in the demo engine).
 * A review role confirms the point's own testimony supports its current wording: the testimony becomes a
 * reviewer-confirmed "supports" verdict for the current revision and the pending point is approved as Sourced.
 * A refused confirmation changes nothing.
 */

import type { AppError, Result } from "@/lib/contracts/api";
import type { PointDetail } from "@/lib/contracts/dto";

import { accessRank, activeMember, currentRevision, isReviewRole, pointAccessLevel, pointStatus, profileLabel, toPointDetail } from "./derive";
import { mockMaskText } from "./mask";
import { getStore } from "./store";

const fail = (code: AppError["code"], message: string): { ok: false; error: AppError } => ({ ok: false, error: { code, message, retryable: false } });

export async function confirmTestimonyAndApprove(input: { pointId: string; expectedRevisionId: string; note?: string }): Promise<Result<PointDetail>> {
  await new Promise((r) => setTimeout(r, 300));
  const store = getStore();
  const p = store.points.find((x) => x.id === input.pointId);
  const h = p ? store.handovers.find((x) => x.id === p.handoverId && !x.deletedAt) : undefined;
  const member = h ? activeMember(store, h.id, store.viewerId) : undefined;
  if (!p || !h || !member || !isReviewRole(member.role) || accessRank(pointAccessLevel(p)) > accessRank(member.clearance)) {
    return fail("not_found", "We couldn't find that.");
  }
  if (p.privacyReview === "required") return fail("invalid_transition", "Resolve the privacy review first.");
  if (h.state !== "in_review") return fail("invalid_transition", "Points can be reviewed only while the handover is in review.");
  const rev = currentRevision(p);
  if (input.expectedRevisionId !== rev.id) return fail("conflict", "This point changed since you opened it. Review the latest version.");
  if (p.reviewState !== "pending") return fail("invalid_transition", "Only a point waiting for review can be confirmed and approved.");
  const testimony = p.links.filter((l) => !l.excluded && l.kind === "testimony");
  if (testimony.length === 0) return fail("precondition_failed", "This point has no statement or accepted answer to confirm.");

  const saved = testimony.map((l) => ({ l, verdict: l.supportVerdict, rationale: l.verdictRationale, rev: l.verifiedRevisionId }));
  for (const l of testimony) {
    l.supportVerdict = "supports";
    l.verdictRationale = "Confirmed by a reviewer.";
    l.verifiedRevisionId = rev.id;
  }
  if (pointStatus(p) !== "sourced") {
    for (const x of saved) {
      x.l.supportVerdict = x.verdict;
      x.l.verdictRationale = x.rationale;
      x.l.verifiedRevisionId = x.rev;
    }
    return fail("precondition_failed", "A source quotation contradicts this point: resolve the conflict first.");
  }
  const at = new Date().toISOString();
  p.approvedAsKnownGap = false;
  p.reviewState = "approved";
  p.reviewHistory.push({
    action: "approve",
    actorLabel: profileLabel(store, store.viewerId),
    note: input.note?.trim() ? mockMaskText(input.note.trim()) : "Confirmed the statement and approved.",
    createdAt: at,
  });
  p.updatedAt = at;
  h.updatedAt = at;
  return { ok: true, data: toPointDetail(store, p, member.clearance) };
}
