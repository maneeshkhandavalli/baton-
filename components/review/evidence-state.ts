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
}): { action: "approve"; pointId: string; expectedRevisionId: string; confirmInferred?: true; resolutionNote?: string } | null {
  const base = { action: "approve" as const, pointId: point.id, expectedRevisionId: point.currentRevisionId };
  if (point.evidenceStatus === "missing") return null;
  if (point.evidenceStatus === "inferred") return point.inferredConfirmation ? { ...base, confirmInferred: true } : null;
  if (point.evidenceStatus === "conflicting") return point.conflictResolution?.note.trim() ? { ...base, resolutionNote: point.conflictResolution.note.trim() } : null;
  return base;
}
