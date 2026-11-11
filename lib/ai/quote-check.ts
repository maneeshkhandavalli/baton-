/**
 * Quote existence check (docs/architecture/shared-contracts.md §10.7). Deterministic, no AI, pure.
 * The single implementation for the whole app (interfaces.md I1). Not server-only: it holds no secrets.
 *
 * Normalised tier (§10.7.1 plus W0 decision I1.8), applied identically to body and quote:
 *   1. remove format characters (Unicode Cf: zero-width, bidi marks/embeddings/isolates, BOM, soft hyphen,
 *      tag characters) EXCEPT ZWNJ U+200C and ZWJ U+200D, which carry meaning in Indic scripts and emoji;
 *   2. NFC, per extended grapheme cluster;
 *   3. curly single/double quotes (and primes) → ASCII ' and ", dashes and minus signs → "-";
 *   4. whitespace runs → one space; trim. Case is preserved.
 *
 * Offsets are JavaScript UTF-16 code-unit indices into `body` (W0 cross-cutting decision). A match must
 * start and end on grapheme-cluster boundaries, so a quote can never cut a character in half.
 *
 * Minimum (§10.7.4, extended by I1.8): after removing mask tokens and `[EXCLUDED_PARTICIPANT]`, the
 * normalised quote must have at least 12 characters (code points) and 3 word-like segments
 * (Intl.Segmenter, so unspaced scripts count correctly). Otherwise the check is `not_found`.
 */

import { EXCLUDED_PARTICIPANT_TOKEN } from "../contracts/parser";

export type QuoteCheckResult = {
  check: "exact" | "normalized" | "not_found";
  start: number | null;
  end: number | null;
};

export const QUOTE_MIN_CHARS = 12;
export const QUOTE_MIN_WORDS = 3;

/**
 * Mask tokens produced by lib/privacy/mask.ts (§12.1) and the excluded-participant placeholder (R8).
 * A test cross-checks this against maskText output so the vocabularies cannot drift apart.
 */
export const MASK_TOKEN_PATTERN = new RegExp(
  String.raw`\[(?:(?:PHONE|EMAIL|UPI|BANK|IFSC|CARD|ID)_\d+|PASSWORD|API_KEY|SECRET)\]|` +
    EXCLUDED_PARTICIPANT_TOKEN.replace(/[[\]]/g, (c) => `\\${c}`),
  "g",
);

const NOT_FOUND: QuoteCheckResult = { check: "not_found", start: null, end: null };

const FORMAT_CHAR = /^\p{Cf}$/u;
const ZWNJ = "‌";
const ZWJ = "‍";
const WHITESPACE = /^\s$/u;

const CHAR_MAP: Record<string, string> = {
  "‘": "'", // ‘
  "’": "'", // ’
  "‚": "'", // ‚
  "‛": "'", // ‛
  "′": "'", // ′
  "“": '"', // “
  "”": '"', // ”
  "„": '"', // „
  "‟": '"', // ‟
  "″": '"', // ″
  "‐": "-", // hyphen
  "‑": "-", // non-breaking hyphen
  "‒": "-", // figure dash
  "–": "-", // en dash
  "—": "-", // em dash
  "―": "-", // horizontal bar
  "−": "-", // minus sign
  "﹘": "-", // small em dash
  "﹣": "-", // small hyphen-minus
  "－": "-", // full-width hyphen-minus
};

let graphemeSegmenter: Intl.Segmenter | null = null;
let wordSegmenter: Intl.Segmenter | null = null;
const graphemes = () => (graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" }));
const words = () => (wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: "word" }));

interface NormalizedView {
  /** The normalised text. */
  text: string;
  /** For each UTF-16 unit of `text`: the source span [start, end) of the cluster (or whitespace run) it came from. */
  starts: number[];
  ends: number[];
}

function isStrippedFormatChar(ch: string): boolean {
  return ch !== ZWNJ && ch !== ZWJ && FORMAT_CHAR.test(ch);
}

/** Builds the normalised text together with a map back to source coordinates. */
function normalizedView(input: string): NormalizedView {
  // 1. Strip format characters, remembering where every kept code unit came from.
  let stripped = "";
  const origin: number[] = [];
  for (let i = 0; i < input.length; ) {
    const cp = input.codePointAt(i) as number;
    const size = cp > 0xffff ? 2 : 1;
    const ch = input.slice(i, i + size);
    if (!isStrippedFormatChar(ch)) {
      stripped += ch;
      for (let k = 0; k < size; k++) origin.push(i + k);
    }
    i += size;
  }

  // 2–3. NFC and character mapping per grapheme cluster; every output code point maps to its cluster.
  const pieces: Array<{ ch: string; start: number; end: number }> = [];
  for (const seg of graphemes().segment(stripped)) {
    const start = origin[seg.index];
    const end = origin[seg.index + seg.segment.length - 1] + 1;
    for (const ch of seg.segment.normalize("NFC")) pieces.push({ ch: CHAR_MAP[ch] ?? ch, start, end });
  }

  // 4. Collapse whitespace runs to one space and trim.
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let pending: { start: number; end: number } | null = null;
  const emit = (s: string, start: number, end: number) => {
    text += s;
    for (let k = 0; k < s.length; k++) {
      starts.push(start);
      ends.push(end);
    }
  };
  for (const piece of pieces) {
    if (WHITESPACE.test(piece.ch)) {
      if (pending) pending.end = piece.end;
      else pending = { start: piece.start, end: piece.end };
      continue;
    }
    if (pending && text.length > 0) emit(" ", pending.start, pending.end);
    pending = null;
    emit(piece.ch, piece.start, piece.end);
  }
  return { text, starts, ends };
}

/** §10.7.1 normalisation (with the I1.8 format-character extension). */
export function normalizeForQuoteMatch(s: string): string {
  return normalizedView(s).text;
}

/** §10.7.4 minimum, ignoring mask tokens and the excluded-participant placeholder. */
export function meetsQuoteMinimum(quote: string): boolean {
  const rest = normalizeForQuoteMatch(normalizeForQuoteMatch(quote).replace(MASK_TOKEN_PATTERN, " "));
  if ([...rest].length < QUOTE_MIN_CHARS) return false;
  let count = 0;
  for (const seg of words().segment(rest)) {
    if (seg.isWordLike && ++count >= QUOTE_MIN_WORDS) return true;
  }
  return false;
}

function graphemeBoundaries(body: string): Set<number> {
  const boundaries = new Set<number>([body.length]);
  for (const seg of graphemes().segment(body)) boundaries.add(seg.index);
  return boundaries;
}

/**
 * §10.7.2–4. Checks `quote` against the cited message's `body` only (no search in other messages).
 * Returns the first occurrence; `exact` before `normalized`. Offsets are in `body` coordinates.
 */
export function checkQuote(body: string, quote: string): QuoteCheckResult {
  if (typeof body !== "string" || typeof quote !== "string") return NOT_FOUND;
  if (!quote.isWellFormed() || !meetsQuoteMinimum(quote)) return NOT_FOUND;

  // Exact tier: the first occurrence that starts and ends on grapheme boundaries.
  let boundaries: Set<number> | null = null;
  for (let i = body.indexOf(quote); i !== -1; i = body.indexOf(quote, i + 1)) {
    boundaries ??= graphemeBoundaries(body);
    if (boundaries.has(i) && boundaries.has(i + quote.length)) return { check: "exact", start: i, end: i + quote.length };
  }

  // Normalised tier.
  const needle = normalizeForQuoteMatch(quote);
  if (needle.length === 0) return NOT_FOUND;
  const view = normalizedView(body);
  const { text, starts, ends } = view;
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    const j = i + needle.length;
    const startAligned = i === 0 || starts[i] !== starts[i - 1];
    const endAligned = j === text.length || starts[j] !== starts[j - 1];
    if (startAligned && endAligned) return { check: "normalized", start: starts[i], end: ends[j - 1] };
  }
  return NOT_FOUND;
}
