// Pure, offline checks the opt-in live Gemini e2e test (gemini-e2e.live.test.ts) runs over the rows it reads
// back. No I/O, no secrets, nothing thrown: every function returns a list of violations (empty = clean), so
// the caller decides what to assert and can print every problem at once.
//
//   quotesAreVerbatim       a quote stored as `exact` / `normalized` really is a substring of its cited
//                           message body (exact: byte-for-byte; normalized: after lib/ai/quote-check.ts's
//                           own normalisation, imported, so the two can never drift apart).
//   unsupportedAttributes   owner-like labels and concrete dates in extracted attributes appear in the source
//                           text (ISO attribute dates are matched against DD/MM/YYYY or written source dates).
//   inventedOwnerOrDate     a task/next action cited ONLY from a message that names no owner and no date
//                           carries neither (the model must not invent them).
import { normalizeForQuoteMatch } from "../../lib/ai/quote-check";

// ── Quotes ───────────────────────────────────────────────────────────────────────────────────────────────

export type QuoteRow = {
  id?: string;
  quote_text: string;
  quote_check: string;
  source_message_id: string | null;
};

export type QuoteViolation = {
  quoteId: string | null;
  sourceMessageId: string | null;
  quoteCheck: string;
  reason: "missing_message" | "not_exact_substring" | "not_normalized_substring";
};

/**
 * Every quote whose `quote_check` claims a match (`exact` or `normalized`) must be found in the body of the
 * message it cites. Quotes marked `not_found` or `pending` make no verbatim claim and are skipped.
 */
export function quotesAreVerbatim(quotes: readonly QuoteRow[], bodies: ReadonlyMap<string, string>): QuoteViolation[] {
  const out: QuoteViolation[] = [];
  for (const q of quotes) {
    if (q.quote_check !== "exact" && q.quote_check !== "normalized") continue;
    const base = { quoteId: q.id ?? null, sourceMessageId: q.source_message_id, quoteCheck: q.quote_check };
    const body = q.source_message_id === null ? undefined : bodies.get(q.source_message_id);
    if (body === undefined) {
      out.push({ ...base, reason: "missing_message" });
    } else if (q.quote_check === "exact") {
      if (q.quote_text.length === 0 || !body.includes(q.quote_text)) out.push({ ...base, reason: "not_exact_substring" });
    } else {
      const needle = normalizeForQuoteMatch(q.quote_text);
      if (needle.length === 0 || !normalizeForQuoteMatch(body).includes(needle)) out.push({ ...base, reason: "not_normalized_substring" });
    }
  }
  return out;
}

// ── Attributes ───────────────────────────────────────────────────────────────────────────────────────────

export type PointAttributesRow = {
  category: string;
  attributes: Record<string, unknown> | null | undefined;
};

export type AttributeViolation = {
  /** Index of the point in the input list. */
  index: number;
  category: string;
  field: string;
  value: string;
  reason: "label_not_in_source" | "date_not_in_source";
};

/**
 * Person/party labels per category (lib/contracts/schemas.ts, extracted variants): the owner of a
 * responsibility, the assignee of a task, the actor of a next action and the holder of an account.
 * `decision.decidedByLabel` is deliberately not checked: "we"/"the committee" paraphrases are legitimate.
 */
export const LABEL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  owner: ["ownerLabel"],
  open_task: ["assigneeLabel"],
  next_action: ["actorLabel"],
  account_access: ["holderLabel"],
};

/** Date fields: `open_task.dueDate` is an ISO date; `next_action.byWhen` is free text, checked only when it names a concrete date. */
export const DATE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  open_task: ["dueDate"],
  next_action: ["byWhen"],
};

/** Values that mean "nobody / unknown"; they assert nothing and so cannot be unsupported. */
const ABSENT_LABEL = /^(?:none|null|n\/a|na|tbd|tba|unknown|unassigned|nobody|no one|not specified|unspecified|not stated)$/i;

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "to", "for", "from", "at", "in", "on", "with", "by", "mr", "mrs", "ms", "dr", "s"]);

const MASK_TOKEN = /\[[A-Z_]+(?:_\d+)?\]/g;

function wordTokens(s: string): string[] {
  return s
    .replace(MASK_TOKEN, " ")
    .toLowerCase()
    .replace(/['’]s\b/g, "") // possessive
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

function labelSupported(label: string, sourceWords: ReadonlySet<string>): boolean {
  // A parenthetical is a description ("Meera Iyer (incoming secretary)"), not the label itself.
  const significant = wordTokens(label.replace(/\([^)]*\)/g, " ")).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  return significant.every((t) => sourceWords.has(t));
}

type DayMonth = { y: number | null; m: number; d: number };

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join("|");

function year(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return raw.length === 2 ? 2000 + n : n;
}

function valid(dm: DayMonth): boolean {
  return dm.m >= 1 && dm.m <= 12 && dm.d >= 1 && dm.d <= 31;
}

/**
 * Every concrete calendar date written in `text`: ISO YYYY-MM-DD, numeric D/M[/Y] (or M/D[/Y] for "mdy";
 * `/`, `.` or `-` separated), "20 November [2026]", "20th Nov", "November 20[, 2026]".
 */
export function datesIn(text: string, dateOrder: "dmy" | "mdy" = "dmy"): DayMonth[] {
  const found: DayMonth[] = [];
  const iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  for (const m of text.matchAll(iso)) found.push({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) });
  const textNoIso = text.replace(iso, " ");
  for (const m of textNoIso.matchAll(/\b(\d{1,2})([/.-])(\d{1,2})(?:\2(\d{4}|\d{2}))?\b/g)) {
    const [a, b] = [Number(m[1]), Number(m[3])];
    found.push(dateOrder === "dmy" ? { y: year(m[4]), m: b, d: a } : { y: year(m[4]), m: a, d: b });
  }
  const dayMonth = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(${MONTH_ALT})\.?(?:,?\s+(\d{4}))?\b`, "gi");
  for (const m of text.matchAll(dayMonth)) found.push({ y: year(m[3]), m: MONTHS[m[2].toLowerCase()], d: Number(m[1]) });
  const monthDay = new RegExp(String.raw`\b(${MONTH_ALT})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?`, "gi");
  for (const m of text.matchAll(monthDay)) found.push({ y: year(m[3]), m: MONTHS[m[1].toLowerCase()], d: Number(m[2]) });
  return found.filter(valid);
}

function sameDate(a: DayMonth, b: DayMonth): boolean {
  return a.m === b.m && a.d === b.d && (a.y === null || b.y === null || a.y === b.y);
}

/**
 * Owner-like labels and concrete dates in extracted attributes that the source text does not contain.
 * Labels: every significant word (case-insensitive, ignoring parentheticals, stopwords, honorifics,
 * possessives and mask tokens) must occur as a word in `sourceText`. Dates: the attribute's date must equal a date written in
 * `sourceText` (a source date without a year matches any year). Pass chat text WITHOUT the per-line
 * timestamps (see stripChatTimestamps) so a message's own date cannot "support" an invented deadline.
 */
export function unsupportedAttributes(
  points: readonly PointAttributesRow[],
  sourceText: string,
  options: { dateOrder?: "dmy" | "mdy" } = {},
): AttributeViolation[] {
  const sourceWords = new Set(wordTokens(sourceText));
  const sourceDates = datesIn(sourceText, options.dateOrder ?? "dmy");
  const out: AttributeViolation[] = [];
  points.forEach((p, index) => {
    const attrs = p.attributes ?? {};
    for (const field of LABEL_FIELDS[p.category] ?? []) {
      const v = attrs[field];
      if (typeof v !== "string" || v.trim() === "" || ABSENT_LABEL.test(v.trim())) continue;
      if (!labelSupported(v, sourceWords)) out.push({ index, category: p.category, field, value: v, reason: "label_not_in_source" });
    }
    for (const field of DATE_FIELDS[p.category] ?? []) {
      const v = attrs[field];
      if (typeof v !== "string" || v.trim() === "") continue;
      const claimed = datesIn(v, options.dateOrder ?? "dmy"); // ISO first, then the source's own formats
      if (claimed.length === 0) continue; // "this week", "before the debate": no concrete date asserted
      if (!claimed.every((c) => sourceDates.some((s) => sameDate(c, s)))) {
        out.push({ index, category: p.category, field, value: v, reason: "date_not_in_source" });
      }
    }
  });
  return out;
}

/** Removes the leading `DD/MM/YYYY, HH:MM - ` (Android) or `[DD/MM/YYYY, HH:MM:SS] ` (iOS) of each chat line. */
export function stripChatTimestamps(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^‎?\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap]\.?[Mm]\.?)?\]?\s*(?:-\s+)?/, ""))
    .join("\n");
}

// ── Owner-less task ──────────────────────────────────────────────────────────────────────────────────────

export type CitedPoint = PointAttributesRow & {
  /** Source message ids of the point's verified (exact/normalized) quotes. */
  messageIds: readonly string[];
};

export type InventedViolation = { index: number; category: string; field: string; value: string };

/**
 * For each task or next action whose verified evidence comes ONLY from `ownerlessMessageIds` (messages that
 * name no owner and no date), the owner and date attributes must be empty. Returns what was invented.
 */
export function inventedOwnerOrDate(points: readonly CitedPoint[], ownerlessMessageIds: ReadonlySet<string>): InventedViolation[] {
  const out: InventedViolation[] = [];
  points.forEach((p, index) => {
    if (p.category !== "open_task" && p.category !== "next_action") return;
    if (p.messageIds.length === 0 || !p.messageIds.every((id) => ownerlessMessageIds.has(id))) return;
    const attrs = p.attributes ?? {};
    for (const field of [...(LABEL_FIELDS[p.category] ?? []), ...(DATE_FIELDS[p.category] ?? [])]) {
      const v = attrs[field];
      if (typeof v === "string" && v.trim() !== "" && !ABSENT_LABEL.test(v.trim())) out.push({ index, category: p.category, field, value: v });
    }
  });
  return out;
}
