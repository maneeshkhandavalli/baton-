/**
 * What a review CARD shows up front versus what waits in the evidence panel (R3 Task 06, progressive disclosure).
 * Pure and React-free (components/review/__tests__/card-evidence.test.ts).
 *
 * The card leads with the claim and its quote. Routine verification (quote found word for word AND the AI judged it
 * supportive for the current wording) is not repeated on every card: the panel always shows both layers, separately
 * (VER-1). Anything that is NOT routine (quote not found or only loosely matched, not checked yet, AI judged it
 * partial, contradicting or irrelevant, a stale or guarded verdict) stays on the card, so nothing a reviewer must
 * notice is hidden. The two layers are never merged into one "verified" signal.
 */

import { evidenceLayers } from "@/lib/contracts/verification";
import type { EvidenceKind, QuoteCheck, SupportVerdict } from "@/lib/contracts/enums";

export interface CardEvidenceInput {
  kind: EvidenceKind;
  quoteCheck: QuoteCheck;
  supportVerdict: SupportVerdict;
  guarded?: boolean;
  isCurrentRevisionVerdict?: boolean;
}

/** True when the card must show the verification chips for this quote (anything but the routine case). */
export function verificationNeedsAttention(e: CardEvidenceInput): boolean {
  const l = evidenceLayers(e);
  const quoteRoutine = l.quote === "matched_exact" || l.quote === "testimony";
  return !(quoteRoutine && l.ai === "judged_supportive");
}

const normalise = (s: string) =>
  s
    .toLocaleLowerCase()
    .replace(/[\s ]+/g, " ")
    .replace(/[.,;:!?…"'“”‘’()-]/g, "")
    .trim();

/**
 * True when the statement adds nothing to the title (the title already contains it, e.g. "Open task: <statement>"),
 * so the card does not print the same sentence twice. The evidence panel still shows both.
 */
export function statementRepeatsTitle(title: string, statement: string): boolean {
  const s = normalise(statement);
  if (!s) return true;
  return normalise(title).includes(s);
}
