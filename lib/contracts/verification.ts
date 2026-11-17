/**
 * Evidence verification layers (R3 Task 03, VER-1). Pure.
 *
 * Baton has four separate kinds of verification, and the interface must never blend them:
 *   1. quote   DETERMINISTIC. The quoted words exist in the cited message (verify_quotes + the database
 *              plausibility re-check). Says nothing about meaning.
 *   2. ai      A MODEL'S JUDGEMENT of whether the quote supports the claim (verify_support). Never proof:
 *              a model can be wrong, and the PI-11 guard may have overridden it.
 *   3. human   A reviewer approved the point (the only confirmation that counts for publishing).
 *   4. conflict Evidence that disputes the point: a cited quote judged to contradict it, or a later message
 *              flagged as a possible contradiction (VER-2).
 * `evidence_status = sourced` still needs 1 AND 2; it is a label for "quote found and AI judged it
 * supportive", not an objective truth. Only 3 settles a point.
 */

import type { EvidenceKind, QuoteCheck, SupportVerdict } from "./enums";

export type QuoteLayer = "matched_exact" | "matched_normalized" | "not_found" | "pending" | "testimony";
export type AiLayer = "judged_supportive" | "judged_partial" | "judged_contradicting" | "judged_irrelevant" | "not_checked" | "stale" | "guarded";
export type HumanLayer = "confirmed" | "rejected" | "not_reviewed";

export interface EvidenceLayers {
  quote: QuoteLayer;
  ai: AiLayer;
}

export interface PointLayers {
  /** At least one active citation whose words were found in the source. */
  quoteMatched: boolean;
  /** At least one matched quote that the AI judged supportive for the current wording. */
  aiJudgedSupportive: boolean;
  human: HumanLayer;
  /** A cited quote was judged contradicting, or a later message is flagged as a possible contradiction. */
  conflictIdentified: boolean;
}

export function evidenceLayers(e: {
  kind: EvidenceKind;
  quoteCheck: QuoteCheck;
  supportVerdict: SupportVerdict;
  guarded?: boolean;
  isCurrentRevisionVerdict?: boolean;
}): EvidenceLayers {
  const quote: QuoteLayer =
    e.kind === "testimony"
      ? "testimony"
      : e.quoteCheck === "exact"
        ? "matched_exact"
        : e.quoteCheck === "normalized"
          ? "matched_normalized"
          : e.quoteCheck === "not_found"
            ? "not_found"
            : "pending";
  let ai: AiLayer;
  if (e.guarded) ai = "guarded";
  else if (e.supportVerdict === "unchecked") ai = "not_checked";
  else if (e.isCurrentRevisionVerdict === false) ai = "stale";
  else
    ai = ({ supports: "judged_supportive", partial: "judged_partial", contradicts: "judged_contradicting", irrelevant: "judged_irrelevant" } as const)[
      e.supportVerdict
    ];
  return { quote, ai };
}

export function pointLayers(p: {
  reviewState: string;
  evidence: ReadonlyArray<Parameters<typeof evidenceLayers>[0] & { excluded?: boolean }>;
  openContradictionFlags?: number;
}): PointLayers {
  const active = p.evidence.filter((e) => !e.excluded).map(evidenceLayers);
  const matched = (l: EvidenceLayers) => l.quote === "matched_exact" || l.quote === "matched_normalized" || l.quote === "testimony";
  return {
    quoteMatched: active.some(matched),
    aiJudgedSupportive: active.some((l) => matched(l) && l.ai === "judged_supportive"),
    human: p.reviewState === "approved" ? "confirmed" : p.reviewState === "rejected" ? "rejected" : "not_reviewed",
    conflictIdentified: active.some((l) => matched(l) && l.ai === "judged_contradicting") || (p.openContradictionFlags ?? 0) > 0,
  };
}

/** Interface copy. The AI layer always says it is an AI judgement. */
export const QUOTE_LAYER_LABEL: Record<QuoteLayer, string> = {
  matched_exact: "Quote found word for word",
  matched_normalized: "Quote found in source",
  not_found: "Quote not found in source",
  pending: "Quote not checked yet",
  testimony: "Accepted answer",
};

export const AI_LAYER_LABEL: Record<AiLayer, string | null> = {
  judged_supportive: "AI judged: supports",
  judged_partial: "AI judged: partly supports",
  judged_contradicting: "AI judged: contradicts",
  judged_irrelevant: "AI judged: not relevant",
  not_checked: null,
  stale: "AI judgement is for an earlier wording",
  guarded: "AI check flagged · read the quote yourself",
};
