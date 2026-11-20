import type { EvidenceItem } from "@/lib/contracts/dto";

/**
 * QA-UI3-H2: a quote is "stale" only when it was checked against an EARLIER revision of the point (it has a real
 * verdict, but not for the current wording). A quote that was never checked (`unchecked`, e.g. a run stopped
 * before the support check) is not stale: the card already says "Not checked yet", and nothing is re-verifying.
 */
export function isStaleEvidence(e: Pick<EvidenceItem, "excluded" | "isCurrentRevisionVerdict" | "supportVerdict">): boolean {
  return !e.excluded && !e.isCurrentRevisionVerdict && e.supportVerdict !== "irrelevant" && e.supportVerdict !== "unchecked";
}

/**
 * Round 4 audit C1: what the card says about a point edited after its quotes were checked. Nothing re-checks an
 * edit straight away (the support check runs with the next processing of sources, and an approved point's edit is
 * not re-checked at all), so the card never claims "Re-verifying…". The human gate is real: the edit makes the point
 * Inferred, and approving an Inferred point needs a reviewer to confirm the new wording, so it can't be published
 * unconfirmed.
 */
export function staleEvidenceNote(point: { reviewState: "pending" | "approved" | "rejected" }): string {
  if (point.reviewState === "approved") {
    return "Edited after its quotes were checked. Approved by a reviewer; the quotes are not re-checked.";
  }
  if (point.reviewState === "rejected") return "Edited after its quotes were checked. The quotes were checked against the earlier wording.";
  return "Edited after its quotes were checked, so the quotes don't vouch for the new wording yet. Confirm it yourself before approving; Baton checks the quotes again the next time sources are processed.";
}

/**
 * QA-UI3-H4: the input for approving a point straight from its card (no dialog). approve_point requires a resolution
 * note for ANY conflicting point and confirmation for ANY inferred one, even when the conflict was already resolved
 * ("Resolve") or the inference already confirmed (a reopened point). Sending the saved note / confirmation keeps the
 * one-click Approve from failing with "This can't be done yet". Returns null when a dialog must collect input.
 */
export function directApproveInput(point: {
  id: string;
  currentRevisionId: string;
  evidenceStatus: string;
  inferredConfirmation: unknown;
  conflictResolution: { note: string } | null;
  /** Round 4 audit C1: with evidence checked against an earlier wording, an old confirmation doesn't cover the edit. */
  evidence?: ReadonlyArray<Pick<EvidenceItem, "excluded" | "isCurrentRevisionVerdict" | "supportVerdict">>;
}): { action: "approve"; pointId: string; expectedRevisionId: string; confirmInferred?: true; resolutionNote?: string } | null {
  const base = { action: "approve" as const, pointId: point.id, expectedRevisionId: point.currentRevisionId };
  if (point.evidenceStatus === "missing") return null;
  if (point.evidenceStatus === "inferred") {
    // An edit after the quotes were checked needs a fresh human confirmation of the new wording (the dialog).
    if (point.evidence?.some(isStaleEvidence)) return null;
    return point.inferredConfirmation ? { ...base, confirmInferred: true } : null;
  }
  if (point.evidenceStatus === "conflicting") return point.conflictResolution?.note.trim() ? { ...base, resolutionNote: point.conflictResolution.note.trim() } : null;
  return base;
}

/**
 * Round 4 (B's confirm_testimony_and_approve, audit F4): a PENDING point that rests on its own testimony (a reviewer
 * statement or an accepted Gap Interview answer) and reads Missing or Inferred can be confirmed by a reviewer as
 * supporting the current wording and approved, instead of only "Approve as gap". The server re-checks every rule.
 */
export function canConfirmTestimony(point: {
  reviewState: string;
  evidenceStatus: string;
  evidence: ReadonlyArray<Pick<EvidenceItem, "kind" | "excluded">>;
}): boolean {
  return (
    point.reviewState === "pending" &&
    (point.evidenceStatus === "missing" || point.evidenceStatus === "inferred") &&
    point.evidence.some((e) => e.kind === "testimony" && !e.excluded)
  );
}
