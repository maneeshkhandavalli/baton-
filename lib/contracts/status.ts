/**
 * Reference implementation of evidence-status derivation
 * (docs/architecture/shared-contracts.md §4.2, §4.4).
 *
 * The database function `recompute_point_status` is authoritative. This pure mirror exists for
 * mocks, fixtures and tests, and both must pass the §4.5 vectors. Status is always derived from
 * evidence: no input here can set it directly.
 */

import type { EvidenceStatus, QuoteCheck, SupportVerdict } from "./enums";

/** One `point_evidence` link joined with its `evidence_quotes.quote_check`. */
export interface StatusEvidenceLink {
  /** `point_evidence.excluded_at IS NOT NULL` */
  excluded: boolean;
  /** Quote EXISTENCE (`evidence_quotes.quote_check`). */
  quoteCheck: QuoteCheck;
  /** Quote SUPPORT for this claim (`point_evidence.support_verdict`). */
  supportVerdict: SupportVerdict;
  /** The revision the verdict was made against (`point_evidence.verified_revision_id`). */
  verifiedRevisionId: string | null;
}

export interface StatusDerivationInput {
  /** `handover_points.current_revision_id` (R in §4.2). */
  currentRevisionId: string;
  /** `handover_points.inference_rationale`. */
  inferenceRationale: string | null;
  links: readonly StatusEvidenceLink[];
}

const isActive = (link: StatusEvidenceLink) => !link.excluded;

/** The quote exists AND its verdict is for the current text. */
const isVerified = (link: StatusEvidenceLink, currentRevisionId: string) =>
  (link.quoteCheck === "exact" || link.quoteCheck === "normalized") && link.verifiedRevisionId === currentRevisionId;

/**
 * §4.2: C ≠ ∅ → conflicting; S ≠ ∅ → sourced; I ≠ ∅ or an inference rationale → inferred;
 * otherwise missing. `irrelevant` verdicts and `not_found` quotes never count.
 */
export function deriveEvidenceStatus(input: StatusDerivationInput): EvidenceStatus {
  const { currentRevisionId, links } = input;
  const active = links.filter(isActive);

  const contradicting = active.some(
    (l) => isVerified(l, currentRevisionId) && l.supportVerdict === "contradicts",
  );
  if (contradicting) return "conflicting";

  const supporting = active.some((l) => isVerified(l, currentRevisionId) && l.supportVerdict === "supports");
  if (supporting) return "sourced";

  const inferredLink = active.some(
    (l) =>
      l.quoteCheck !== "not_found" &&
      l.supportVerdict !== "irrelevant" &&
      (l.supportVerdict === "partial" ||
        l.supportVerdict === "unchecked" ||
        l.verifiedRevisionId !== currentRevisionId), // stale verdict
  );
  const hasRationale = (input.inferenceRationale ?? "").trim().length > 0;
  if (inferredLink || hasRationale) return "inferred";

  return "missing";
}

/** §4.4: a sourced point whose latest support is more than 30 days before `evidence_as_of`. */
export const OUTDATED_AFTER_DAYS = 30;

export interface OutdatedInput {
  evidenceStatus: EvidenceStatus;
  /** Latest `message_sent_at` (or testimony time) over supporting links; null if none is dated. */
  lastSupportedAt: string | null;
  /** `handovers.evidence_as_of` (D6). */
  evidenceAsOf: string | null;
}

export function derivePotentiallyOutdated(input: OutdatedInput): boolean {
  if (input.evidenceStatus !== "sourced" || input.lastSupportedAt === null || input.evidenceAsOf === null) {
    return false;
  }
  const lastSupported = Date.parse(input.lastSupportedAt);
  const asOf = Date.parse(input.evidenceAsOf);
  if (Number.isNaN(lastSupported) || Number.isNaN(asOf)) return false;
  return lastSupported < asOf - OUTDATED_AFTER_DAYS * 24 * 60 * 60 * 1000;
}
