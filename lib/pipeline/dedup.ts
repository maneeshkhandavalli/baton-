/**
 * Duplicate and conflict matching in the serial extract stage (§10.9 as amended by W0 decision I2.3).
 *
 * A candidate is attached to an existing point instead of becoming a new one when, in the same category,
 * - its statement equals the point's after normalisation (a duplicate), or
 * - it names the same subject: `owner.responsibility`, `account_access.system` or `contact.nameLabel`.
 *   A candidate that says something different about the same subject is how a conflict looks; the
 *   independent support check later judges the attached quote (supports / contradicts / …), so the
 *   system never picks a winner and never trusts the extractor's stance.
 * - (QA-UI3-X1) it is a REWORDING of the point: it cites at least one of the same source messages, its
 *   numbers (dates, amounts, counts) are the same, negation agrees, and its content words overlap strongly
 *   (Dice ≥ NEAR_DUPLICATE_DICE). This is what a retry after a failed run looks like: the model re-reads the
 *   same chunk and says the same thing in other words. Both the point's current wording and its original
 *   (first-revision) wording are compared, so a human edit doesn't hide the point from its own re-extraction.
 *   Attaching only adds the candidate's citations to the existing point (never rewrites it), so approved,
 *   edited or rejected points keep their human decisions.
 *
 * Eligible points: same `extraction_access_level` as the chunk (never merge across levels), not held for
 * privacy review, not redacted. Rejected points are eligible: their new evidence attaches and they stay
 * rejected. Points without an extraction level (manual, gap answers) are never merge targets.
 */

import { normalizeForQuoteMatch } from "../ai/quote-check";
import type { AccessLevel, PointCategory } from "../contracts/enums";
import type { PipelinePoint } from "../db/pipeline";

export interface ClaimShape {
  category: PointCategory;
  statement: string;
  attributes: Record<string, unknown> | null;
  /** Source messages the claim cites (QA-UI3-X1). Without any, only exact statement/subject matching applies. */
  citedMessageIds?: readonly string[];
}

const SUBJECT_FIELD: Partial<Record<PointCategory, string>> = {
  owner: "responsibility",
  account_access: "system",
  contact: "nameLabel",
};

/** Minimum Dice overlap of content words for a same-evidence rewording to count as the same point. */
export const NEAR_DUPLICATE_DICE = 0.6;

/** Case-, punctuation- and whitespace-insensitive form used for matching only (never stored). */
export function normalizeClaimText(s: string): string {
  return normalizeForQuoteMatch(s)
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function statementKey(c: ClaimShape): string | null {
  const n = normalizeClaimText(c.statement);
  return n ? `${c.category}\u0000s\u0000${n}` : null;
}

export function subjectKey(c: ClaimShape): string | null {
  const field = SUBJECT_FIELD[c.category];
  const value = field && c.attributes ? c.attributes[field] : null;
  if (typeof value !== "string") return null;
  const n = normalizeClaimText(value);
  return n ? `${c.category}\u0000k\u0000${n}` : null;
}

// Function words that carry no claim content. Negations are NOT here: they are compared separately.
const FILLER = new Set(
  (
    "a an the to of and or in on at by for from with into onto as is are was were be been being will would shall should " +
    "can could may might must has have had do does did it its this that these those there their they them he she his her " +
    "we our you your i me my all also only just so then than now each every any some per via up out about over after before " +
    "need needs needed issue issued set scheduled run runs running will"
  ).split(" "),
);
const NEGATION = new Set(["not", "no", "never", "none", "nobody", "nothing", "without", "cannot", "cant", "dont", "doesnt", "isnt", "wont", "arent", "wasnt"]);

/** Words that pin a claim to a specific time or position, mapped to one canonical marker each. */
const MARKER = new Map<string, string>([
  ...["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"].flatMap(
    (m, i) => [[m, `month${i + 1}`], [m.slice(0, 3), `month${i + 1}`]] as [string, string][],
  ),
  ["sept", "month9"],
  ...["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].flatMap((d, i) => [[d, `day${i + 1}`], [d.slice(0, 3), `day${i + 1}`]] as [string, string][]),
  ...["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "last", "final", "next", "previous"].map((o) => [o, `ord_${o}`] as [string, string]),
]);
// "may" is also a verb ("may need"), so it never counts as the month May.
MARKER.delete("may");

/** Comparable fingerprint of a statement: content words (lightly stemmed), numbers, and whether it negates. */
export interface ClaimFingerprint {
  words: ReadonlySet<string>;
  numbers: string;
  negated: boolean;
}

export function fingerprint(statement: string): ClaimFingerprint {
  const tokens = normalizeClaimText(statement).split(" ").filter(Boolean);
  const words = new Set<string>();
  let negated = false;
  for (const t of tokens) {
    if (NEGATION.has(t)) negated = true;
    else if (!FILLER.has(t)) words.add(t.length > 3 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t);
  }
  // Distinguishing markers must agree exactly: digits, months, weekdays and ordinals ("first … September" is not
  // "second … October", even though only "20" is a digit in both).
  const markers = new Set<string>(normalizeClaimText(statement).match(/\d+/g) ?? []);
  for (const t of tokens) {
    const m = MARKER.get(t);
    if (m) markers.add(m);
  }
  const numbers = [...markers].sort().join(",");
  return { words, numbers, negated };
}

/** Dice coefficient of two word sets (0 … 1). */
export function dice(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** QA-UI3-X1: is `b` a rewording of `a` (same evidence assumed)? Numbers and negation must agree exactly. */
export function isRewording(a: ClaimFingerprint, b: ClaimFingerprint): boolean {
  return a.numbers === b.numbers && a.negated === b.negated && dice(a.words, b.words) >= NEAR_DUPLICATE_DICE;
}

interface NearEntry {
  pointId: string;
  category: PointCategory;
  prints: ClaimFingerprint[];
  messages: Set<string>;
}

export class PointIndex {
  private readonly byKey = new Map<string, string>();
  private readonly near: NearEntry[] = [];

  constructor(points: readonly PipelinePoint[], accessLevel: AccessLevel) {
    for (const p of points) {
      if (p.extractionAccessLevel !== accessLevel || p.privacyReview === "required" || p.redacted || p.statement === null) continue;
      this.add(p.pointId, { category: p.category, statement: p.statement, attributes: p.attributes, citedMessageIds: p.citedMessageIds ?? [] });
      // The extractor's original wording too, so a human edit doesn't hide the point from its own re-extraction.
      if (p.originalStatement && p.originalStatement !== p.statement) {
        this.add(p.pointId, { category: p.category, statement: p.originalStatement, attributes: null, citedMessageIds: p.citedMessageIds ?? [] });
      }
    }
  }

  /** The point a candidate should attach to, or null to insert a new point. Exact statement, then subject, then rewording. */
  find(c: ClaimShape): string | null {
    for (const key of [statementKey(c), subjectKey(c)]) {
      if (key !== null && this.byKey.has(key)) return this.byKey.get(key) as string;
    }
    const cited = c.citedMessageIds ?? [];
    if (cited.length === 0) return null;
    const print = fingerprint(c.statement);
    for (const e of this.near) {
      if (e.category !== c.category || !cited.some((m) => e.messages.has(m))) continue;
      if (e.prints.some((p) => isRewording(p, print))) return e.pointId;
    }
    return null;
  }

  /** First point wins for a key, so later duplicates attach to the earliest point. */
  add(pointId: string, c: ClaimShape): void {
    for (const key of [statementKey(c), subjectKey(c)]) {
      if (key !== null && !this.byKey.has(key)) this.byKey.set(key, pointId);
    }
    const cited = c.citedMessageIds ?? [];
    if (cited.length === 0) return;
    const existing = this.near.find((e) => e.pointId === pointId);
    if (existing) {
      existing.prints.push(fingerprint(c.statement));
      for (const m of cited) existing.messages.add(m);
    } else {
      this.near.push({ pointId, category: c.category, prints: [fingerprint(c.statement)], messages: new Set(cited) });
    }
  }
}
