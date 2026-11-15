import type { EvidenceItem } from "@/lib/contracts/dto";

/**
 * QA-UI3-H2: a quote is "stale" only when it was checked against an EARLIER revision of the point (it has a real
 * verdict, but not for the current wording). A quote that was never checked (`unchecked`, e.g. a run stopped
 * before the support check) is not stale: the card already says "Not checked yet", and nothing is re-verifying.
 */
export function isStaleEvidence(e: Pick<EvidenceItem, "excluded" | "isCurrentRevisionVerdict" | "supportVerdict">): boolean {
  return !e.excluded && !e.isCurrentRevisionVerdict && e.supportVerdict !== "irrelevant" && e.supportVerdict !== "unchecked";
}
