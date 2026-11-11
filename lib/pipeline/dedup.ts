/**
 * Duplicate and conflict matching in the serial extract stage (§10.9 as amended by W0 decision I2.3).
 *
 * A candidate is attached to an existing point instead of becoming a new one when, in the same category,
 * - its statement equals the point's after normalisation (a duplicate), or
 * - it names the same subject: `owner.responsibility`, `account_access.system` or `contact.nameLabel`.
 *   A candidate that says something different about the same subject is how a conflict looks; the
 *   independent support check later judges the attached quote (supports / contradicts / …), so the
 *   system never picks a winner and never trusts the extractor's stance.
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
}

const SUBJECT_FIELD: Partial<Record<PointCategory, string>> = {
  owner: "responsibility",
  account_access: "system",
  contact: "nameLabel",
};

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

export class PointIndex {
  private readonly byKey = new Map<string, string>();

  constructor(points: readonly PipelinePoint[], accessLevel: AccessLevel) {
    for (const p of points) {
      if (p.extractionAccessLevel !== accessLevel || p.privacyReview === "required" || p.redacted || p.statement === null) continue;
      this.add(p.pointId, { category: p.category, statement: p.statement, attributes: p.attributes });
    }
  }

  /** The point a candidate should attach to, or null to insert a new point. Statement match wins. */
  find(c: ClaimShape): string | null {
    for (const key of [statementKey(c), subjectKey(c)]) {
      if (key !== null && this.byKey.has(key)) return this.byKey.get(key) as string;
    }
    return null;
  }

  /** First point wins for a key, so later duplicates attach to the earliest point. */
  add(pointId: string, c: ClaimShape): void {
    for (const key of [statementKey(c), subjectKey(c)]) {
      if (key !== null && !this.byKey.has(key)) this.byKey.set(key, pointId);
    }
  }
}
