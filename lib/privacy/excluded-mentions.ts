/**
 * Redaction of excluded participants' names and @mentions inside messages that are KEPT
 * (messages written by other people). Applied in memory, before masking, so the names never
 * reach masking, persistence or the AI.
 *
 * Message bodies (`redact`), deliberately conservative so unrelated text survives:
 *  - Multi-word names ("Ravi Kumar"): the whole name, case-insensitive, flexible whitespace, never
 *    inside a longer word, with or without "@" (and the "~" / bidi isolates WhatsApp puts around
 *    mentions: "@\u2068~Ravi Kumar\u2069"). Not replaced when the name is extended into a
 *    different person's name: a generational suffix ("Ravi Kumar Sr", "Ravi Kumar Jr."), a hyphenated
 *    continuation ("Ravi Kumar-Jr"), or a KEPT participant whose name extends it ("Ravi Kumar
 *    Singh" when that person is in the chat and not excluded).
 *  - Single-word names ("Mom", "Admin", "Asha"): ONLY explicit @mentions ("@Mom", "@\u2068~Mom\u2069").
 *    Free-text occurrences are left alone, because single-word contact names are so often
 *    ordinary words ("Tell mom", "Great work team", "asha" = hope in Hindi).
 *  - Phone-number senders: any number in the text that denotes their number (all written forms
 *    of it, including national forms, are compared; numbers are also masked independently).
 *
 * Display labels of other participants (`mentionsExcluded`) use a STRICT check instead: any
 * whole-word occurrence of any excluded name, single-word included, or their number. A label
 * that matches is replaced by "Participant N" by the caller.
 *
 * Documented limitations (not matched in bodies): single-word names and first names or nicknames
 * written without "@" ("ask Ravi"), misspellings, other scripts or transliterations, names with
 * fewer than two letters, and people excluded handover-wide who never appear in this source under
 * a name (only their hash is known). Masking is not proof that names are gone (§12.8).
 */

import { EXCLUDED_PARTICIPANT_TOKEN } from "../contracts/parser";
import { canonicalPhoneNumber, foldDigits, indianNationalReading } from "./phone";
import { cleanSenderString, isPhoneLikeSender } from "./identity";

/**
 * The reserved token (§11.4, §12.1, D31) comes from the contract. It is NOT a mask token: it is
 * written before masking, is never numbered, and never appears in masking counts.
 */
export { EXCLUDED_PARTICIPANT_TOKEN };

export interface ExcludedMentionRedactor {
  readonly isEmpty: boolean;
  /** Replaces mentions in a message body; returns the new text and how many were replaced. */
  redact(text: string): { text: string; count: number };
  /** Strict check for display labels: true if `label` names any excluded participant. */
  mentionsExcluded(label: string): boolean;
}

export interface ExcludedMentionOptions {
  /** Raw sender strings of participants who are KEPT in this source (used to avoid misattribution). */
  keptSenders?: readonly string[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LETTER = new RegExp("\\p{L}", "gu");

/** Letters (any script) in `s`; used to skip names too short to match safely. */
function letterCount(s: string): number {
  const m = s.match(LETTER);
  return m ? m.length : 0;
}

function words(name: string): string[] {
  return name.split(" ").filter((w) => w !== "");
}

function namePattern(name: string): string {
  return words(name).map(escapeRegExp).join("[\\s\\u00A0\\u202F]+");
}

function alternation(names: Iterable<string>): string {
  // Longest first, so a name that contains another one is matched whole.
  return Array.from(names)
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .map(namePattern)
    .join("|");
}

const ISOLATES = "[\\u2066-\\u2069\\u200E\\u200F]";
const NOT_BEFORE = "(?<![\\p{L}\\p{N}\\p{M}_@])";
const NOT_AFTER = "(?![\\p{L}\\p{N}\\p{M}_])";
/** A name extended into a different person's name: suffix or hyphenated continuation. */
const NOT_EXTENDED =
  "(?!-\\p{L})(?![\\s\\u00A0\\u202F]+(?:Sr|Snr|Jr|Jnr|Senior|Junior|II|III|IV)\\.?(?![\\p{L}\\p{N}]))";

// A run of digits with phone-style separators, optionally "@" / "+" prefixed.
const NUMBER_RUN = /@?\+?\d[\d \u00A0\-().]{5,22}\d/g;

/**
 * Every reading of a number for REDACTION: its frozen identity form (§12.11) plus, for unprefixed
 * Indian mobile shapes, the +91 reading. Widening is allowed here only because over-redaction is the
 * safe failure (reconciliation P2); these readings never feed an identity hash.
 */
function phoneReadings(raw: string): string[] {
  const folded = foldDigits(raw);
  const digits = folded.replace(/\D/g, "");
  const plus = /^@?\+/.test(folded);
  const national = indianNationalReading(digits, plus);
  const canonical = canonicalPhoneNumber(digits, plus);
  return national === null ? [canonical] : [canonical, national];
}

// Private-use placeholders for protected (kept) names while redacting. Disjoint from the masker's
// U+E000 range; any pre-existing U+F000-U+F0FF in the input is left untouched by restore().
const PROTECT_OPEN = "\uF000";
const PROTECT_CLOSE = "\uF001";

export function createExcludedMentionRedactor(
  excludedSenders: readonly string[],
  options: ExcludedMentionOptions = {},
): ExcludedMentionRedactor {
  const multiWord = new Set<string>();
  const singleWord = new Set<string>();
  const phones = new Set<string>();
  for (const raw of excludedSenders) {
    const clean = cleanSenderString(raw);
    if (isPhoneLikeSender(clean)) {
      for (const r of phoneReadings(clean)) phones.add(r);
      continue;
    }
    if (letterCount(clean) < 2) continue;
    // Bodies are NFC while identity cleaning is NFKC; match both spellings.
    const nfc = raw.normalize("NFC").replace(/\s+/g, " ").trim();
    for (const form of new Set([clean, nfc])) {
      if (form === "") continue;
      (words(form).length >= 2 ? multiWord : singleWord).add(form);
    }
  }

  const parts: string[] = [];
  if (multiWord.size > 0) {
    parts.push(`${NOT_BEFORE}(?:@${ISOLATES}*~?)?(?:${alternation(multiWord)})${ISOLATES}*${NOT_AFTER}${NOT_EXTENDED}`);
  }
  if (singleWord.size > 0) {
    parts.push(`${NOT_BEFORE}@${ISOLATES}*~?(?:${alternation(singleWord)})${ISOLATES}*${NOT_AFTER}${NOT_EXTENDED}`);
  }
  const bodyRe = parts.length > 0 ? new RegExp(parts.join("|"), "giu") : null;

  const allNames = [...multiWord, ...singleWord];
  const labelRe = allNames.length > 0 ? new RegExp(`${NOT_BEFORE}(?:${alternation(allNames)})${NOT_AFTER}`, "iu") : null;

  // Kept participants whose name extends an excluded multi-word name ("Ravi Kumar Singh" vs
  // excluded "Ravi Kumar") are protected in bodies, so they are not misattributed.
  const protectedNames = new Set<string>();
  for (const raw of options.keptSenders ?? []) {
    const kept = raw.normalize("NFC").replace(/\s+/g, " ").trim();
    for (const ex of multiWord) {
      if (kept.length > ex.length && new RegExp(`^${namePattern(ex)}[\\s\\u00A0\\u202F-]+\\p{L}`, "iu").test(kept)) {
        protectedNames.add(kept);
      }
    }
  }
  const protectRe =
    protectedNames.size > 0 ? new RegExp(`${NOT_BEFORE}(?:${alternation(protectedNames)})${NOT_AFTER}`, "giu") : null;

  const replaceNumbers = (text: string, onHit: () => void): string =>
    text.replace(NUMBER_RUN, (run) => {
      if (!phoneReadings(run).some((r) => phones.has(r))) return run;
      onHit();
      return EXCLUDED_PARTICIPANT_TOKEN;
    });

  return {
    isEmpty: bodyRe === null && phones.size === 0,
    redact(text: string) {
      let count = 0;
      let out = text;
      if (bodyRe) {
        const saved: string[] = [];
        if (protectRe) {
          out = out.replace(protectRe, (m) => {
            saved.push(m);
            return `${PROTECT_OPEN}${saved.length - 1}${PROTECT_CLOSE}`;
          });
        }
        out = out.replace(bodyRe, () => {
          count++;
          return EXCLUDED_PARTICIPANT_TOKEN;
        });
        if (saved.length > 0) {
          out = out.replace(new RegExp(`${PROTECT_OPEN}(\\d+)${PROTECT_CLOSE}`, "g"), (whole, i: string) => saved[Number(i)] ?? whole);
        }
      }
      if (phones.size > 0) out = replaceNumbers(out, () => count++);
      return { text: out, count };
    },
    mentionsExcluded(label: string) {
      const clean = label.normalize("NFC").replace(/\s+/g, " ");
      if (labelRe && labelRe.test(clean)) return true;
      if (phones.size === 0) return false;
      let hit = false;
      replaceNumbers(foldDigits(clean), () => (hit = true));
      return hit;
    },
  };
}
