/**
 * Round 4 audit C2: testimony is either an accepted Gap Interview answer or a reviewer's own statement (the "How do
 * you know this?" text of a manually added point). Both are stored as `testimony` evidence; the review read does not
 * say which, so the label is derived from what the review page already has:
 *   - the quote is the text of a Gap Interview answer to this handover → "Gap Interview answer";
 *   - otherwise it is a statement: "Your statement" when the viewer made it, else "Reviewer statement".
 * Pure, no React.
 */

import { formatDate } from "@/components/handover/format";
import type { EvidenceItem, GapQuestionSummary, PointDetail, PublishedEvidenceItem } from "@/lib/contracts/dto";

export interface TestimonyContext {
  /** Texts of the handover's Gap Interview answers (trimmed). */
  answerTexts: ReadonlySet<string>;
  /** The viewer's member label in this handover (as testimony author labels are written), if known. */
  viewerLabel: string | null;
}

export function testimonyContext(gapQuestions: readonly Pick<GapQuestionSummary, "answers">[], viewerLabel: string | null): TestimonyContext {
  return { answerTexts: new Set(gapQuestions.flatMap((q) => q.answers.map((a) => a.text.trim()))), viewerLabel: viewerLabel?.trim() || null };
}

export function testimonyLabel(e: Pick<EvidenceItem, "kind" | "quote" | "authorLabel">, ctx: TestimonyContext): string | undefined {
  if (e.kind !== "testimony") return undefined;
  if (ctx.answerTexts.has(e.quote.trim())) return "Gap Interview answer";
  if (ctx.viewerLabel && e.authorLabel?.trim() === ctx.viewerLabel) return "Your statement";
  return "Reviewer statement";
}

/** The points with each testimony item labelled (`testimonyLabel` travels with the item into <EvidenceQuote {...e}>). */
export function withTestimonyLabels<P extends Pick<PointDetail, "evidence">>(points: readonly P[], ctx: TestimonyContext): P[] {
  return points.map((p) =>
    p.evidence.some((e) => e.kind === "testimony")
      ? { ...p, evidence: p.evidence.map((e) => (e.kind === "testimony" ? { ...e, testimonyLabel: testimonyLabel(e, ctx) } : e)) }
      : p,
  );
}

type ShownEvidence = Extract<PublishedEvidenceItem, { redacted: false }>;

/**
 * Round 4 audit C6 (published view): what an inferred point rests on. A point backed by an accepted Gap Interview
 * answer (or a reviewer's statement) names who answered and when, instead of claiming no evidence exists.
 */
export function inferredBasis(evidence: readonly ShownEvidence[]): string {
  const t = evidence.find((e) => e.kind === "testimony" && e.stance === "supports");
  if (!t) return "No source states this outright.";
  const who = t.authorLabel?.trim() || "A team member";
  return t.sentAt ? `Answered by ${who} on ${formatDate(t.sentAt)}, not taken from a source.` : `Answered by ${who}, not taken from a source.`;
}
