/**
 * Deterministic change detection for a source update (R3 Task 05D). Pure: no I/O, no clock, no AI.
 *
 * Given the PREVIOUS version's retained evidence and the NEW version's messages, it decides for every evidence link
 * whether the quotation is still present, moved, ambiguous or missing, finds new content, ranks possible
 * contradictions with the existing Task 03 retrieval, detects support verdict reversals with a concrete basis,
 * and lists newly extracted points. The result is a list of review ITEMS that reference existing objects; nothing
 * here edits a point, removes evidence or changes a publication.
 *
 * Matching (`locateQuote`), per new message:
 *   1. strict: `checkQuote` (the app's single quote verifier: format characters removed, NFC, curly quotes and
 *      dashes mapped, whitespace and line breaks collapsed; CASE PRESERVED, as everywhere else) at EVERY occurrence,
 *      and only where the match is bounded by non-word characters, so "500" never matches inside "5000" and a
 *      fragment of a longer word never counts. The quote must meet the app's 12-character / 3-word minimum.
 *   2. placeholder-relaxed (only if 1 found nothing anywhere): placeholders are compared by TYPE only
 *      ([PERSON_1] ~ [PERSON_2], [PHONE_1] ~ [PHONE_3], never [PERSON_1] ~ [PHONE_1]). A relaxed hit is NEVER a match:
 *      it cannot show that PERSON_2 is the same identity as PERSON_1, so it is reported as `placeholder_changed`.
 * Location ("same place"): a chat message is the same place when author placeholder and timestamp are equal (a
 * re-export renumbers messages); a document block when its section heading is equal (line numbers shift freely).
 *   - strict hit at the same place                    → present (no item; the version/message id change is not news)
 *   - no strict hit at the same place, exactly one    → evidence_moved, mapped to that message and offsets
 *   - no strict hit at the same place, several        → evidence_moved with match = ambiguous and NO mapped message
 *   - no strict hit at all                            → evidence_missing (not_found, or placeholder_changed)
 *
 * New content: chats use the previous version's `last_message_at` (kept through pruning) as a watermark: later
 * messages are new; messages AT the watermark are treated as possibly new (export timestamps are minute-precise),
 * unless retained evidence is found there; earlier ones are re-exported old content. Documents keep no manifest of
 * uncited blocks, so every block without retained evidence is only "previously uncited", never "new". Pruned
 * history means edits or deletions of old, uncited messages cannot be detected; nothing here claims they can.
 */

import { checkQuote, normalizeForQuoteMatch } from "../ai/quote-check";
import type { NewChangeReviewItem } from "../db/pipeline";
import { CONTRADICTION_LIMITS, findContradictionCandidates, type RetrievalMessage } from "./contradictions";

export const CHANGE_DETECTOR_VERSION = "change-detect@1";

export type SourceFamily = "chat" | "document";
/**
 * Chats are matched by author and time; documents by section heading. A connector `chat_import` is parsed by the same
 * chat builder (author + timestamp per message, no headings), so it is a chat (PR #7 review, finding 2).
 */
export const sourceFamily = (kind: string): SourceFamily => (kind === "whatsapp_export" || kind === "chat_import" ? "chat" : "document");

/**
 * A connector `chat_import` version holds only the messages since the previous import (a DELTA), so the source's
 * content is the union of its versions. Change detection must not read "absent from the delta" as "removed"
 * (PR #7 review, finding 3).
 */
export const isAdditiveSourceKind = (kind: string): boolean => kind === "chat_import";

export interface OldEvidence {
  evidenceId: string;
  pointId: string;
  linkVerdict: string;
  quoteText: string;
  messageId: string | null;
  sentAt: string | null;
  authorLabel: string | null;
  heading: string | null;
}

export interface NewMessage {
  id: string;
  seq: number;
  sentAt: string | null;
  authorLabel: string | null;
  body: string;
  heading?: string | null;
}

export interface NewLink {
  evidenceId: string;
  pointId: string;
  messageId: string | null;
  quoteStart: number | null;
  quoteEnd: number | null;
  verdict: string;
  quoteCheck: string;
  pointHasOtherEvidence: boolean;
}

export interface DetectionPoint {
  pointId: string;
  origin: string;
  reviewState: string;
  privacyReview: string;
  currentRevisionId: string;
  title: string | null;
  statement: string | null;
  attributes: Record<string, unknown> | null;
  redacted: boolean;
  citedMessageIds?: string[];
}

export interface DetectionInput {
  family: SourceFamily;
  /**
   * The new version is a delta over the earlier versions (connector chat_import). Old evidence whose message the delta
   * does not touch (no new message at the same place: same author and time) is carried forward as present; evidence
   * whose message the delta re-sends (an edit or a deletion) is classified normally, so a removed or changed quotation
   * still produces evidence_missing / evidence_moved.
   */
  additive?: boolean;
  /** The previous version's last message time (chats); null when unknown. */
  watermark: string | null;
  /** null: the handover was never published (no new_information items). */
  basePublicationId: string | null;
  /** point id → revision in the base publication */
  basePoints: Readonly<Record<string, string>>;
  oldEvidence: readonly OldEvidence[];
  newMessages: readonly NewMessage[];
  newLinks: readonly NewLink[];
  points: readonly DetectionPoint[];
  /** Retained bodies of the messages the handover's points cite (any source or version). */
  anchors: readonly RetrievalMessage[];
}

export type DetectionCounts = Record<
  | "evidenceCompared"
  | "evidencePresent"
  | "evidenceCarried"
  | "evidenceMoved"
  | "evidenceAmbiguous"
  | "evidenceMissing"
  | "placeholderChanged"
  | "newMessages"
  | "newContentMessages"
  | "possibleContradictions"
  | "supportChanged"
  | "newInformation",
  number
>;

export interface DetectionResult {
  items: NewChangeReviewItem[];
  counts: DetectionCounts;
}

// ── matching ──────────────────────────────────────────────────────────────────

/** [PERSON_1], [PERSON], [PHONE_2], [API_KEY], [EXCLUDED_PARTICIPANT] … → type only. */
const PLACEHOLDER = /\[([A-Z]+(?:_[A-Z]+)*)(?:_[1-9]\d*)?\]/g;
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;

/** Loose form for a cheap prefilter: a strict match implies loose(quote) ⊆ loose(body). Never used to match. */
function loose(s: string): string {
  return normalizeForQuoteMatch(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const relaxed = (s: string) => normalizeForQuoteMatch(s).replace(PLACEHOLDER, "[$1]");

function charBefore(s: string, i: number): string {
  if (i <= 0) return "";
  const cp = s.codePointAt(i - 1) as number;
  return cp >= 0xdc00 && cp <= 0xdfff && i >= 2 ? s.slice(i - 2, i) : s.slice(i - 1, i);
}
function charAt(s: string, i: number): string {
  if (i >= s.length) return "";
  return String.fromCodePoint(s.codePointAt(i) as number);
}

/** The match does not start or end inside a word (only where the quote's own edge is a word character). */
export function isBounded(body: string, start: number, end: number): boolean {
  const first = charAt(body, start);
  const last = charBefore(body, end);
  if (WORD_CHAR.test(first) && WORD_CHAR.test(charBefore(body, start))) return false;
  if (WORD_CHAR.test(last) && WORD_CHAR.test(charAt(body, end))) return false;
  return true;
}

export interface Occurrence {
  messageId: string;
  start: number;
  end: number;
  check: "exact" | "normalized";
}

/** Every bounded strict occurrence of `quote` in `body` (at most `limit`). */
export function findOccurrences(body: string, quote: string, limit = 20): Array<Omit<Occurrence, "messageId">> {
  const out: Array<Omit<Occurrence, "messageId">> = [];
  for (let offset = 0; offset <= body.length && out.length < limit; ) {
    const r = checkQuote(offset === 0 ? body : body.slice(offset), quote);
    if (r.check === "not_found" || r.start === null || r.end === null) break;
    const start = offset + r.start;
    const end = offset + r.end;
    if (isBounded(body, start, end)) out.push({ start, end, check: r.check });
    const step = (body.codePointAt(start) as number) > 0xffff ? 2 : 1;
    offset = start + step;
  }
  return out;
}

interface PreparedMessage extends NewMessage {
  loose: string;
  relaxedText: string | null;
}

function prepare(messages: readonly NewMessage[]): PreparedMessage[] {
  return [...messages].sort((a, b) => a.seq - b.seq).map((m) => ({ ...m, loose: loose(m.body), relaxedText: null }));
}

export interface QuoteLocation {
  strict: Occurrence[];
  /** message ids where only the placeholder-relaxed form appears */
  relaxed: string[];
}

function boundedIncludes(haystack: string, needle: string): boolean {
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + 1)) {
    if (isBounded(haystack, i, i + needle.length)) return true;
  }
  return false;
}

export function locateQuote(quote: string, messages: readonly NewMessage[]): QuoteLocation {
  return locatePrepared(quote, prepare(messages));
}

function locatePrepared(quote: string, messages: PreparedMessage[]): QuoteLocation {
  const strict: Occurrence[] = [];
  const lq = loose(quote);
  if (lq.length > 0) {
    for (const m of messages) {
      if (!m.loose.includes(lq)) continue;
      for (const o of findOccurrences(m.body, quote)) strict.push({ messageId: m.id, ...o });
    }
  }
  if (strict.length > 0) return { strict, relaxed: [] };

  const rq = relaxed(quote);
  if (rq === normalizeForQuoteMatch(quote)) return { strict, relaxed: [] }; // no numbered placeholder in the quote
  // prefilter: every text segment between placeholders must occur (loosely) in the message
  const segments = rq.split(PLACEHOLDER).filter((_, i) => i % 2 === 0).map(loose).filter((s) => s.length > 0);
  const out: string[] = [];
  for (const m of messages) {
    if (!segments.every((s) => m.loose.includes(s))) continue;
    m.relaxedText ??= relaxed(m.body);
    if (boundedIncludes(m.relaxedText, rq)) out.push(m.id);
  }
  return { strict, relaxed: out };
}

const sameTime = (a: string | null, b: string | null) => {
  if (a === null || b === null) return a === b;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return !Number.isNaN(x) && x === y;
};

export function samePlace(family: SourceFamily, e: Pick<OldEvidence, "authorLabel" | "sentAt" | "heading">, m: NewMessage): boolean {
  if (family === "chat") return (e.authorLabel ?? null) === (m.authorLabel ?? null) && sameTime(e.sentAt, m.sentAt);
  return (e.heading ?? null) === (m.heading ?? null);
}

export type EvidenceOutcome =
  | { kind: "present"; at: Occurrence }
  | { kind: "moved"; at: Occurrence; change: "author_changed" | "time_changed" | "author_and_time_changed" | "section_changed" }
  | { kind: "ambiguous"; candidates: number }
  | { kind: "missing"; reason: "not_found" | "placeholder_changed"; candidates: number };

export function classifyEvidence(family: SourceFamily, e: OldEvidence, messages: readonly NewMessage[]): EvidenceOutcome {
  return classifyPrepared(family, e, prepare(messages));
}

function classifyPrepared(family: SourceFamily, e: OldEvidence, messages: PreparedMessage[]): EvidenceOutcome {
  const loc = locatePrepared(e.quoteText, messages);
  if (loc.strict.length === 0) {
    return loc.relaxed.length > 0
      ? { kind: "missing", reason: "placeholder_changed", candidates: loc.relaxed.length }
      : { kind: "missing", reason: "not_found", candidates: 0 };
  }
  const byId = new Map(messages.map((m) => [m.id, m]));
  const here = loc.strict.find((o) => samePlace(family, e, byId.get(o.messageId) as NewMessage));
  if (here) return { kind: "present", at: here };
  const where = new Set(loc.strict.map((o) => o.messageId));
  if (where.size > 1) return { kind: "ambiguous", candidates: where.size };
  const at = loc.strict[0];
  const loc2 = loc.strict.filter((o) => o.messageId === at.messageId);
  if (loc2.length > 1) return { kind: "ambiguous", candidates: loc2.length }; // twice in one message: which one?
  const m = byId.get(at.messageId) as NewMessage;
  let change: Extract<EvidenceOutcome, { kind: "moved" }>["change"] = "section_changed";
  if (family === "chat") {
    const author = (e.authorLabel ?? null) !== (m.authorLabel ?? null);
    const time = !sameTime(e.sentAt, m.sentAt);
    change = author && time ? "author_and_time_changed" : author ? "author_changed" : "time_changed";
  }
  return { kind: "moved", at, change };
}

// ── the detector ──────────────────────────────────────────────────────────────

const POLARITY: Readonly<Record<string, number>> = { supports: 1, partial: 1, contradicts: -1, irrelevant: 0 };
const id = (s: string) => s.toLowerCase();

export function detectChanges(input: DetectionInput): DetectionResult {
  const counts: DetectionCounts = {
    evidenceCompared: 0, evidencePresent: 0, evidenceCarried: 0, evidenceMoved: 0, evidenceAmbiguous: 0, evidenceMissing: 0, placeholderChanged: 0,
    newMessages: input.newMessages.length, newContentMessages: 0, possibleContradictions: 0, supportChanged: 0, newInformation: 0,
  };
  const items: NewChangeReviewItem[] = [];
  const messages = prepare(input.newMessages);
  const byMessage = new Map(messages.map((m) => [m.id, m]));
  const points = new Map(input.points.map((p) => [p.pointId, p]));
  const baseRevision = (pointId: string) => input.basePoints[pointId] ?? points.get(pointId)?.currentRevisionId ?? null;
  const represented = new Set<string>(); // new messages that carry retained evidence

  // 1. evidence of the previous version
  for (const e of [...input.oldEvidence].sort((a, b) => (a.evidenceId + a.pointId < b.evidenceId + b.pointId ? -1 : 1))) {
    const rev = baseRevision(e.pointId);
    if (!points.has(e.pointId) || rev === null) continue; // an erased point
    counts.evidenceCompared += 1;
    // additive (delta) versions: a cited message the delta does not re-send is still part of the source
    if (input.additive && input.family === "chat" && e.sentAt !== null && !messages.some((m) => samePlace("chat", e, m))) {
      counts.evidenceCarried += 1;
      continue;
    }
    const outcome = classifyPrepared(input.family, e, messages);
    const key = `${id(e.evidenceId)}:${id(e.pointId)}`;
    const base = { pointId: e.pointId, baseRevisionId: rev, oldEvidenceId: e.evidenceId };
    if (outcome.kind === "present" || outcome.kind === "moved") {
      represented.add(outcome.at.messageId);
      const m = byMessage.get(outcome.at.messageId) as NewMessage;
      if (outcome.kind === "present") counts.evidencePresent += 1;
      else {
        counts.evidenceMoved += 1;
        items.push({
          kind: "evidence_moved", dedupeKey: `evidence_moved:${key}`, ...base,
          newMessageId: m.id, newQuoteStart: outcome.at.start, newQuoteEnd: outcome.at.end,
          detail: { match: outcome.at.check, location: outcome.change, newPosition: m.seq, family: input.family },
        });
      }
      // support_changed: the independent support check judged the SAME passage differently in the new version
      const before = POLARITY[e.linkVerdict];
      const link = input.newLinks
        .filter((l) => l.pointId === e.pointId && l.messageId === m.id && l.quoteStart !== null && l.quoteEnd !== null
                       && l.quoteStart < outcome.at.end && (l.quoteEnd as number) > outcome.at.start && POLARITY[l.verdict] !== undefined)
        .sort((a, b) => (a.evidenceId < b.evidenceId ? -1 : 1))[0];
      if (before !== undefined && link && POLARITY[link.verdict] !== before) {
        counts.supportChanged += 1;
        items.push({
          kind: "support_changed", dedupeKey: `support_changed:${key}`, ...base, newEvidenceId: link.evidenceId,
          newMessageId: m.id, newQuoteStart: outcome.at.start, newQuoteEnd: outcome.at.end,
          detail: { from: e.linkVerdict, to: link.verdict },
        });
      }
    } else if (outcome.kind === "ambiguous") {
      counts.evidenceAmbiguous += 1;
      items.push({
        kind: "evidence_moved", dedupeKey: `evidence_moved:${key}`, ...base,
        detail: { match: "ambiguous", candidates: outcome.candidates, family: input.family },
      });
    } else {
      counts.evidenceMissing += 1;
      if (outcome.reason === "placeholder_changed") counts.placeholderChanged += 1;
      items.push({
        kind: "evidence_missing", dedupeKey: `evidence_missing:${key}`, ...base,
        detail: { match: outcome.reason, candidates: outcome.candidates, family: input.family },
      });
    }
  }

  // 2. new content
  const watermark = input.watermark === null ? Number.NaN : Date.parse(input.watermark);
  const coverage = new Map<string, "after_watermark" | "at_watermark" | "previously_uncited">();
  for (const m of messages) {
    if (represented.has(m.id)) continue;
    if (input.family === "chat" && !Number.isNaN(watermark)) {
      const t = m.sentAt === null ? Number.NaN : Date.parse(m.sentAt);
      if (Number.isNaN(t) || t > watermark) coverage.set(m.id, "after_watermark");
      else if (t === watermark) coverage.set(m.id, "at_watermark");
      // earlier: re-exported content that the previous version already had
    } else {
      coverage.set(m.id, "previously_uncited");
    }
  }
  counts.newContentMessages = coverage.size;

  // 3. possible contradictions of live points by new content (Task 03 retrieval, new content only as candidates)
  const live = input.points.filter((p) => p.reviewState !== "rejected" && !p.redacted && p.statement !== null && p.privacyReview !== "required");
  if (coverage.size > 0 && live.length > 0) {
    const anchors = [...input.anchors].sort((a, b) => (a.id < b.id ? -1 : 1));
    const fresh = messages.filter((m) => coverage.has(m.id));
    // one synthetic order: every anchor before every new message; real chat timestamps still decide when both exist
    const pool: RetrievalMessage[] = [
      ...anchors.map((a, i) => ({ ...a, sourceId: "cmp", seq: i })),
      ...fresh.map((m, i) => ({
        id: m.id, sourceId: "cmp", seq: anchors.length + i, authorLabel: m.authorLabel, body: m.body,
        sentAt: input.family === "chat" ? m.sentAt : null,
      })),
    ];
    const ranked = findContradictionCandidates(
      live.map((p) => ({ pointId: p.pointId, title: p.title, statement: p.statement, attributes: p.attributes, citedMessageIds: p.citedMessageIds ?? [] })),
      pool,
      { perPoint: Number.MAX_SAFE_INTEGER, minScore: CONTRADICTION_LIMITS.minScore },
    );
    const perPoint = new Map<string, number>();
    for (const c of ranked) {
      if (!coverage.has(c.messageId)) continue;
      const n = perPoint.get(c.pointId) ?? 0;
      if (n >= CONTRADICTION_LIMITS.perPoint) continue;
      const rev = baseRevision(c.pointId);
      if (rev === null) continue;
      perPoint.set(c.pointId, n + 1);
      counts.possibleContradictions += 1;
      items.push({
        kind: "possible_contradiction", dedupeKey: `possible_contradiction:${id(c.pointId)}:${id(c.messageId)}`,
        pointId: c.pointId, baseRevisionId: rev, newMessageId: c.messageId,
        detail: { reasons: [...c.reasons], score: c.score, coverage: coverage.get(c.messageId) as string },
      });
    }
  }

  // 4. new information: newly extracted points backed ONLY by the new version (dedup already merged equivalents)
  if (input.basePublicationId !== null) {
    const linksByPoint = new Map<string, NewLink[]>();
    for (const l of input.newLinks) linksByPoint.set(l.pointId, [...(linksByPoint.get(l.pointId) ?? []), l]);
    for (const p of [...input.points].sort((a, b) => (a.pointId < b.pointId ? -1 : 1))) {
      if (p.reviewState !== "pending" || p.origin !== "extracted") continue;
      const links = (linksByPoint.get(p.pointId) ?? []).filter((l) => l.quoteCheck !== "not_found");
      if (links.length === 0 || links.some((l) => l.pointHasOtherEvidence)) continue;
      const seqOf = (l: NewLink) => (l.messageId ? (byMessage.get(l.messageId)?.seq ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER);
      const first = [...links].sort((a, b) => seqOf(a) - seqOf(b) || (a.evidenceId < b.evidenceId ? -1 : 1))[0];
      let cov: string = input.family === "chat" ? "previously_uncited" : "newly_extracted";
      if (input.family === "chat" && links.every((l) => l.messageId !== null && coverage.get(l.messageId) === "after_watermark")) cov = "after_watermark";
      counts.newInformation += 1;
      items.push({
        kind: "new_information", dedupeKey: `new_information:${id(p.pointId)}`, candidatePointId: p.pointId,
        newEvidenceId: first.evidenceId, detail: { coverage: cov, evidence: links.length },
      });
    }
  }

  return { items, counts };
}
