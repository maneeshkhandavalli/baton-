/**
 * Attribution verification (R3 Task 03, VER-3). Pure and deterministic.
 *
 * The model writes person fields (`ownerLabel`, `assigneeLabel`, …) as free text. This module checks each
 * one against what the sources actually contain:
 *   - `cited_author`          the value is the author label of a message the point cites;
 *   - `mentioned_in_evidence` the value appears in the text of a cited message;
 *   - `participant_elsewhere` the value is a known participant, but not in the cited evidence (inferred);
 *   - `ambiguous`             the unnumbered [PERSON] token: several people share that name (unresolved);
 *   - `unrecognized`          not a participant and not in the evidence, e.g. a name the model invented, an
 *                             outsider, or a role such as "the treasurer" (unresolved).
 * The resolution is `verified` for the first two, `inferred` for the third and `unresolved` otherwise. The
 * check never rewrites the field and never decides who is right: an inferred or unresolved field stays so
 * until a reviewer approves or edits the point.
 *
 * Text compared here is the stored, pseudonymised text ([PERSON_n]); nothing is resolved to a real name.
 */

import type { PointCategory } from "../contracts/enums";

/** Person fields per category. Contacts and dependencies may legitimately name outsiders and are not checked. */
export const PERSON_FIELDS: Readonly<Partial<Record<PointCategory, readonly string[]>>> = Object.freeze({
  decision: ["decidedByLabel"],
  owner: ["ownerLabel"],
  open_task: ["assigneeLabel"],
  next_action: ["actorLabel"],
  account_access: ["holderLabel"],
});

export const ATTRIBUTION_STATUSES = ["cited_author", "mentioned_in_evidence", "participant_elsewhere", "ambiguous", "unrecognized"] as const;
export type AttributionStatus = (typeof ATTRIBUTION_STATUSES)[number];
export type AttributionResolution = "verified" | "inferred" | "unresolved";

export interface AttributionCheck {
  field: string;
  status: AttributionStatus;
  resolution: AttributionResolution;
}

export interface AttributionInput {
  category: PointCategory;
  attributes: Record<string, unknown> | null;
  /** The cited messages (pseudonymised author label and body). */
  cited: ReadonlyArray<{ authorLabel: string | null; body: string }>;
  /** Every author label seen in the handover's sources (pseudonymised). */
  participants: ReadonlySet<string>;
}

const PERSON_TOKEN = /\[PERSON(?:_[1-9]\d*)?\]/gu;
const norm = (s: string) => s.normalize("NFKC").replace(/^@/, "").replace(/\s+/g, " ").trim().toLowerCase();

const RESOLUTION: Record<AttributionStatus, AttributionResolution> = {
  cited_author: "verified",
  mentioned_in_evidence: "verified",
  participant_elsewhere: "inferred",
  ambiguous: "unresolved",
  unrecognized: "unresolved",
};

function statusOf(value: string, input: AttributionInput): AttributionStatus {
  const v = norm(value);
  const tokens = value.match(PERSON_TOKEN) ?? [];
  if (tokens.length > 0 && tokens.every((t) => t === "[PERSON]")) return "ambiguous";
  const authors = new Set(input.cited.map((c) => (c.authorLabel ? norm(c.authorLabel) : "")).filter(Boolean));
  const named = tokens.length > 0 ? tokens.filter((t) => t !== "[PERSON]").map(norm) : [v];
  if (named.every((n) => authors.has(n))) return "cited_author";
  const bodies = input.cited.map((c) => norm(c.body));
  const inEvidence = (n: string) => authors.has(n) || bodies.some((b) => containsWhole(b, n));
  if (named.every(inEvidence)) return "mentioned_in_evidence";
  const participants = new Set([...input.participants].map(norm));
  if (named.every((n) => participants.has(n) || inEvidence(n))) return "participant_elsewhere";
  return "unrecognized";
}

/** Whole-token containment, so "[person_1]" never matches inside "[person_12]" and "ravi" not inside "ravindra". */
function containsWhole(haystack: string, needle: string): boolean {
  if (needle.length === 0) return false;
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) return false;
    const before = i === 0 ? "" : haystack[i - 1];
    const after = haystack[i + needle.length] ?? "";
    const isWord = (c: string) => /[\p{L}\p{N}_]/u.test(c);
    const tokenEnd = needle.endsWith("]");
    if (!isWord(before) && (tokenEnd ? !/\d/.test(after) : !isWord(after))) return true;
    from = i + 1;
  }
}

/** Checks every non-empty person field of one point. */
export function checkAttribution(input: AttributionInput): AttributionCheck[] {
  const fields = PERSON_FIELDS[input.category] ?? [];
  const out: AttributionCheck[] = [];
  for (const field of fields) {
    const value = input.attributes?.[field];
    if (typeof value !== "string" || value.trim() === "") continue;
    const status = statusOf(value, input);
    out.push({ field, status, resolution: RESOLUTION[status] });
  }
  return out;
}
