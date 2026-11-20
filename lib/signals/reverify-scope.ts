/**
 * Round 4 B (audit F4): which evidence links the support verifier may (re)check. Mirrors
 * `public.link_in_reverify_scope` and `list_links_needing_support` (migration 20261121200100); the mocks and the
 * no-login demo use this so their behaviour matches the database.
 *
 * A link needs a check when it has no verdict for the point's CURRENT revision. For an APPROVED point only new,
 * never-checked source quotations qualify (in a Living Handover update run they come from the changed source
 * version). Approved human evidence is never re-checked:
 *   - testimony (a reviewer's own statement on a manual point, or an accepted Gap Interview answer);
 *   - quotes verified against an earlier wording of a point a reviewer then edited and approved;
 *   - a source quotation carried over UNCHANGED from an earlier version of the same source (its text is in a message of
 *     an earlier version that the point already cites; migration 20261121200200). A new source version is
 *     re-extracted, so its unchanged sentences come back as new, unchecked links: they are not new evidence.
 * Otherwise an update to one source re-verified, and could silently reopen, points it never touched.
 * A relevant change review (evidence missing, support changed, possible contradiction) still decides about them.
 */

import type { EvidenceKind, QuoteCheck, ReviewState, SupportVerdict } from "../contracts/enums";

export interface ScopeLink {
  evidenceKind: EvidenceKind;
  supportVerdict: SupportVerdict;
  quoteCheck: QuoteCheck;
  excluded: boolean;
  /** The point revision the verdict was given for; null when never checked. */
  verifiedRevisionId: string | null;
  /**
   * A source quotation whose text already appears in a message of an EARLIER version of the same source that the point
   * cites (SQL: _source_quote_unchanged_from_earlier_version, migration 20261121200200). Absent means false.
   */
  unchangedFromEarlierVersion?: boolean;
}

/** The SQL rule on its own (called only for links without a verdict for the current revision). */
export function linkInReverifyScope(reviewState: ReviewState, evidenceKind: EvidenceKind, supportVerdict: SupportVerdict): boolean {
  if (reviewState !== "approved") return true;
  if (evidenceKind === "testimony") return false;
  return supportVerdict === "unchecked";
}

/** Whether verify_support would be given this link now (same filters as list_links_needing_support). */
export function linkNeedsSupportCheck(point: { reviewState: ReviewState; currentRevisionId: string }, link: ScopeLink): boolean {
  if (link.excluded) return false;
  if (link.quoteCheck !== "exact" && link.quoteCheck !== "normalized") return false;
  const unverifiedForCurrent = link.supportVerdict === "unchecked" || link.verifiedRevisionId !== point.currentRevisionId;
  // an approved point: a quotation carried over unchanged from an earlier version is not new evidence
  if (point.reviewState === "approved" && link.evidenceKind === "source_quote" && link.unchangedFromEarlierVersion === true) return false;
  return unverifiedForCurrent && linkInReverifyScope(point.reviewState, link.evidenceKind, link.supportVerdict);
}
