/**
 * R3 Task 05E: change-review items (detected by Task 05D) and the reviewer's decisions. Shared by the server action,
 * the read query and the UI. The database (decide_change_review_item) enforces every rule; this module only shapes
 * input early and gives each kind its own, truthful wording.
 */

import { z } from "zod";

export const CHANGE_REVIEW_KINDS = ["evidence_missing", "evidence_moved", "possible_contradiction", "support_changed", "new_information"] as const;
export type ChangeReviewKind = (typeof CHANGE_REVIEW_KINDS)[number];
export const CHANGE_REVIEW_STATES = ["open", "investigating", "accepted", "rejected", "stale"] as const;
export type ChangeReviewState = (typeof CHANGE_REVIEW_STATES)[number];
export const CHANGE_REVIEW_DECISIONS = ["investigate", "accept", "reject"] as const;
export type ChangeReviewDecision = (typeof CHANGE_REVIEW_DECISIONS)[number];

export const isUnresolvedChangeReview = (s: ChangeReviewState) => s === "open" || s === "investigating";

export interface ChangeReviewQuote {
  id: string;
  quote: string;
  authorLabel: string | null;
  sentAt: string | null;
  verdict: string | null;
  rationale: string | null;
}

export interface ChangeReviewItem {
  id: string;
  changeId: string;
  kind: ChangeReviewKind;
  state: ChangeReviewState;
  staleReason: "superseded" | "source_removed" | null;
  detail: Record<string, unknown>;
  createdAt: string;
  decidedAt: string | null;
  sourceId: string;
  previousSourceId: string;
  sourceTitle: string | null;
  fromVersion: number;
  toVersion: number;
  updateState: string;
  basePublicationId: string | null;
  /** The point the item is about, or the candidate point (new_information), as it is NOW. */
  point: {
    id: string;
    category: string;
    reviewState: string;
    evidenceStatus: string;
    currentRevisionId: string;
    title: string | null;
    statement: string | null;
    attributes: Record<string, unknown> | null;
  } | null;
  /** The revision the change was detected against (the published one when the point was published). */
  base: { revisionId: string; revisionNumber: number; title: string | null; statement: string | null } | null;
  oldEvidence: (ChangeReviewQuote & { sourceTitle: string | null }) | null;
  newMessage: { id: string; body: string; sentAt: string | null; authorLabel: string | null; quoteStart: number | null; quoteEnd: number | null } | null;
  newEvidence: ChangeReviewQuote | null;
  decisions: Array<{ decision: ChangeReviewDecision; fromState: string; toState: string; note: string | null; actorProfileId: string | null; createdAt: string }>;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function quoteOf(v: unknown): ChangeReviewQuote | null {
  const o = obj(v);
  if (!o || typeof o.id !== "string") return null;
  return { id: o.id, quote: str(o.quote) ?? "", authorLabel: str(o.authorLabel), sentAt: str(o.sentAt), verdict: str(o.verdict), rationale: str(o.rationale) };
}

/** Maps api_get_change_reviews rows; anything malformed is dropped (fail closed: never shown half-understood). */
export function mapChangeReviewItems(raw: unknown): ChangeReviewItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): ChangeReviewItem[] => {
    const o = obj(r);
    if (!o || typeof o.id !== "string" || typeof o.changeId !== "string") return [];
    if (!(CHANGE_REVIEW_KINDS as readonly string[]).includes(String(o.kind)) || !(CHANGE_REVIEW_STATES as readonly string[]).includes(String(o.state))) return [];
    const p = obj(o.point);
    const b = obj(o.base);
    const m = obj(o.newMessage);
    const oe = quoteOf(o.oldEvidence);
    return [{
      id: o.id,
      changeId: o.changeId,
      kind: o.kind as ChangeReviewKind,
      state: o.state as ChangeReviewState,
      staleReason: o.staleReason === "superseded" || o.staleReason === "source_removed" ? o.staleReason : null,
      detail: obj(o.detail) ?? {},
      createdAt: str(o.createdAt) ?? "",
      decidedAt: str(o.decidedAt),
      sourceId: str(o.sourceId) ?? "",
      previousSourceId: str(o.previousSourceId) ?? "",
      sourceTitle: str(o.sourceTitle),
      fromVersion: num(o.fromVersion) ?? 0,
      toVersion: num(o.toVersion) ?? 0,
      updateState: str(o.updateState) ?? "",
      basePublicationId: str(o.basePublicationId),
      point: p && typeof p.id === "string" && typeof p.currentRevisionId === "string"
        ? { id: p.id, category: str(p.category) ?? "", reviewState: str(p.reviewState) ?? "", evidenceStatus: str(p.evidenceStatus) ?? "",
            currentRevisionId: p.currentRevisionId, title: str(p.title), statement: str(p.statement), attributes: obj(p.attributes) }
        : null,
      base: b && typeof b.revisionId === "string"
        ? { revisionId: b.revisionId, revisionNumber: num(b.revisionNumber) ?? 0, title: str(b.title), statement: str(b.statement) }
        : null,
      oldEvidence: oe ? { ...oe, sourceTitle: str(obj(o.oldEvidence)?.sourceTitle) } : null,
      newMessage: m && typeof m.id === "string"
        ? { id: m.id, body: str(m.body) ?? "", sentAt: str(m.sentAt), authorLabel: str(m.authorLabel), quoteStart: num(m.quoteStart), quoteEnd: num(m.quoteEnd) }
        : null,
      newEvidence: quoteOf(o.newEvidence),
      decisions: Array.isArray(o.decisions)
        ? o.decisions.flatMap((d) => {
            const x = obj(d);
            return x && (CHANGE_REVIEW_DECISIONS as readonly string[]).includes(String(x.decision))
              ? [{ decision: x.decision as ChangeReviewDecision, fromState: str(x.fromState) ?? "", toState: str(x.toState) ?? "", note: str(x.note),
                   actorProfileId: str(x.actorProfileId), createdAt: str(x.createdAt) ?? "" }]
              : [];
          })
        : [],
    }];
  });
}

// ── decision input ────────────────────────────────────────────────────────────

const uuid = z.string().uuid();
const note = z.string().trim().max(2000).optional();

export const decideChangeReviewInput = z.object({
  handoverId: uuid,
  itemId: uuid,
  decision: z.enum(CHANGE_REVIEW_DECISIONS),
  expectedState: z.enum(["open", "investigating"]),
  /** The point's (or candidate's) current revision as the reviewer saw it. */
  expectedPointRevisionId: uuid,
  note,
  /** possible_contradiction accept: the corrected point and the supporting quotation (UTF-16 offsets in the new message). */
  correction: z
    .object({
      title: z.string().trim().min(1).max(300),
      statement: z.string().trim().min(1).max(2000),
      attributes: z.record(z.string(), z.unknown()),
      evidenceStart: z.number().int().min(0),
      evidenceEnd: z.number().int().min(1),
    })
    .refine((c) => c.evidenceEnd > c.evidenceStart, { message: "invalid quotation span", path: ["evidenceEnd"] })
    .optional(),
  /** new_information accept: what the normal approval needs for this candidate's evidence status. */
  approval: z
    .object({ confirmInferred: z.boolean().optional(), resolutionNote: z.string().trim().max(2000).optional(), asKnownGap: z.boolean().optional() })
    .optional(),
});
export type DecideChangeReviewInput = z.input<typeof decideChangeReviewInput>;

export const RE_ATTESTATION_MIN = 20;

/** Early, kind-specific validation (the database re-checks all of it). Returns a field → message map or null. */
export function decisionProblems(kind: ChangeReviewKind, v: z.output<typeof decideChangeReviewInput>): Record<string, string> | null {
  const n = v.note?.trim() ?? "";
  if ((v.decision === "investigate" || v.decision === "reject") && !n) {
    return { note: v.decision === "investigate" ? "Say what you're checking." : "Say why you're rejecting this change." };
  }
  if (v.decision !== "accept") return null;
  switch (kind) {
    case "evidence_missing":
    case "support_changed":
      return n.length < RE_ATTESTATION_MIN ? { note: `Explain why the point still stands (at least ${RE_ATTESTATION_MIN} characters).` } : null;
    case "possible_contradiction":
      if (!v.correction) return { correction: "Write the corrected point and choose the supporting quotation from the new message." };
      return n ? null : { note: "Say why you're correcting the point." };
    default:
      return null;
  }
}

// ── wording (each kind has its own meaning of accept / reject) ────────────────

export const changeReviewKindText: Record<ChangeReviewKind, { label: string; explain: string; accept: string; acceptHelp: string; reject: string; rejectHelp: string }> = {
  evidence_moved: {
    label: "Quotation moved",
    explain: "The quoted words are still in the new version, but in a different message or place.",
    accept: "Use the new location",
    acceptHelp: "Links the quotation in the new version to this point as evidence. The earlier quotation stays as history.",
    reject: "Keep the old location only",
    rejectHelp: "Nothing changes: the point keeps its evidence. Record why the new location isn't the same thing.",
  },
  evidence_missing: {
    label: "Quotation not found",
    explain:
      "The new version no longer contains the quoted words. That alone doesn't mean the point is wrong: it may have been rephrased, pruned or moved out of the export.",
    accept: "Keep the point (re-attest)",
    acceptHelp: "You confirm the point still holds without the old quotation. No replacement evidence is created; explain how you know.",
    reject: "Don't keep this as confirmed",
    rejectHelp: "The point and its historical evidence stay as they are; record that you don't confirm it. Edit or reject the point in the review if it is wrong.",
  },
  possible_contradiction: {
    label: "Possible contradiction",
    explain: "A newer message may change this point. Baton never corrects a point by itself.",
    accept: "Correct the point",
    acceptHelp: "Write the corrected point in your own words and choose the words in the new message that support it. The point goes back to review.",
    reject: "The point still stands",
    rejectHelp: "The point and its evidence stay as they are. Record why the newer message doesn't change it.",
  },
  support_changed: {
    label: "Support assessment changed",
    explain: "The same quoted words were judged differently against this point in the new version.",
    accept: "Confirm the new assessment",
    acceptHelp: "Records that you checked the new assessment. Evidence and wording stay unchanged; edit the point in the review if needed.",
    reject: "Keep the earlier assessment",
    rejectHelp: "Nothing changes. Record why the earlier assessment is still right.",
  },
  new_information: {
    label: "New information",
    explain: "A point found only in the new version. It is reviewed like any other new point.",
    accept: "Approve the new point",
    acceptHelp: "Approves the point through the normal review rules for its evidence.",
    reject: "Reject the new point",
    rejectHelp: "Rejects the point through the normal review. It stays in the history, not in the handover.",
  },
};

/** A short label for the detector's detail (match / location), never message text. */
export function changeReviewDetailText(item: Pick<ChangeReviewItem, "kind" | "detail">): string | null {
  const d = item.detail;
  if (item.kind === "evidence_moved" && d.match === "ambiguous") return `Found in ${String(d.candidates ?? "several")} places: Baton can't tell which one is meant.`;
  if (item.kind === "evidence_moved" && d.location === "section_changed") return "Now in another section of the document.";
  if (item.kind === "evidence_moved" && typeof d.location === "string") return "Now in another message (author or time changed).";
  if (item.kind === "evidence_missing" && d.match === "placeholder_changed") return "Similar words appear with a different person or contact placeholder, so Baton didn't treat them as the same.";
  if (item.kind === "new_information" && d.coverage === "after_watermark") return "From messages added after the previous version.";
  if (item.kind === "new_information" || d.coverage === "previously_uncited" || d.coverage === "newly_extracted")
    return "From content that wasn't cited before (it may or may not be new).";
  return null;
}
