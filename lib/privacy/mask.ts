/**
 * PII and secret masking (§12.1). Pure and deterministic.
 *
 * - `maskText` (the contract `MaskTextFn`) masks one string with a fresh token map.
 * - `createMasker` returns a stateful masker for one source, so the same value always gets the
 *   same token across messages ("send to [UPI_1]" … "[UPI_1] received"). The value-to-token map
 *   lives only inside the masker object: it is never returned, persisted or logged.
 *
 * Detection runs on a "view" of the text in which Unicode decimal digits and full-width ASCII are
 * mapped one-to-one to ASCII, so indices line up with the original. Detectors run in a fixed
 * priority order; each masked span is replaced by an inert private-use placeholder so later
 * detectors cannot re-match it, and placeholders become tokens at the end.
 *
 * Masking errs toward over-masking: false positives are acceptable, false negatives are bugs.
 */

import type { MaskKind } from "../contracts/enums";
import { MASK_KINDS } from "../contracts/enums";
import type { MaskContext, MaskResult, MaskTextFn } from "../contracts/parser";
import { luhnValid, shannonEntropy, verhoeffValid } from "./checksums";
import { canonicalPhoneNumber, foldDigitCode } from "./phone";

// ---------------------------------------------------------------------------------------------
// Tokens

const NUMBERED_TOKEN_PREFIX: Partial<Record<MaskKind, string>> = {
  phone: "PHONE",
  email: "EMAIL",
  upi: "UPI",
  bank_account: "BANK",
  ifsc: "IFSC",
  card: "CARD",
  government_id: "ID",
};
const FIXED_TOKEN: Partial<Record<MaskKind, string>> = {
  password: "[PASSWORD]",
  api_key: "[API_KEY]",
  secret: "[SECRET]",
};

export function emptyMaskCounts(): Record<MaskKind, number> {
  const counts = {} as Record<MaskKind, number>;
  for (const k of MASK_KINDS) counts[k] = 0;
  return counts;
}

export function addMaskCounts(into: Record<MaskKind, number>, from: Record<MaskKind, number>): void {
  for (const k of MASK_KINDS) into[k] += from[k];
}

// ---------------------------------------------------------------------------------------------
// Detection view

function toViewChar(code: number): string | null {
  if (code < 0x80) return null;
  const digit = foldDigitCode(code);
  if (digit !== null) return digit;
  // Full-width ASCII (！ … ～) → ASCII.
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - 0xfee0);
  return null;
}

function buildView(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const mapped = toViewChar(text.charCodeAt(i));
    out += mapped ?? text[i];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Placeholders: \uE000 + id encoded in \uE010–\uE01F (hex) + \uE001. Never matched by detectors.

const PH_OPEN = "\uE000";
const PH_CLOSE = "\uE001";
const PLACEHOLDER_RE = /\uE000([\uE010-\uE01F]+)\uE001/g;

function encodePlaceholder(id: number): string {
  let enc = "";
  for (const ch of id.toString(16)) enc += String.fromCharCode(0xe010 + parseInt(ch, 16));
  return PH_OPEN + enc + PH_CLOSE;
}

function decodePlaceholderId(enc: string): number {
  let hex = "";
  for (let i = 0; i < enc.length; i++) hex += (enc.charCodeAt(i) - 0xe010).toString(16);
  return parseInt(hex, 16);
}

// ---------------------------------------------------------------------------------------------
// Detector plumbing

interface Span {
  start: number;
  end: number;
  kind: MaskKind;
  /** Canonical value used for consistent numbering. */
  value: string;
}

type Detector = (view: string) => Span[];

/** Separator characters allowed between digit groups of one number (incl. line breaks). */
const DIGIT_SEPARATOR = /^[\s\-.()/\\‐-―\u200B-\u200D\u2060\uFEFF]{1,3}$/;

interface DigitGroup {
  start: number;
  end: number;
  digits: string;
}

function digitGroups(view: string): DigitGroup[] {
  const groups: DigitGroup[] = [];
  const re = /\d+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(view))) groups.push({ start: m.index, end: m.index + m[0].length, digits: m[0] });
  return groups;
}

/** Splits digit groups into chains whose gaps are only short separators. */
function digitChains(view: string): DigitGroup[][] {
  const chains: DigitGroup[][] = [];
  let current: DigitGroup[] = [];
  for (const g of digitGroups(view)) {
    if (current.length > 0) {
      const gap = view.slice(current[current.length - 1].end, g.start);
      if (!DIGIT_SEPARATOR.test(gap)) {
        chains.push(current);
        current = [];
      }
    }
    current.push(g);
  }
  if (current.length > 0) chains.push(current);
  return chains;
}

/** Index of a "+" directly before position `start` (optionally followed by spaces), or -1. */
function plusBefore(view: string, start: number): number {
  let i = start - 1;
  while (i >= 0 && (view[i] === " " || view[i] === "\u00A0")) i--;
  return i >= 0 && view[i] === "+" ? i : -1;
}

/**
 * Greedy longest-first search over runs of consecutive digit groups. `accept` returns the
 * canonical value for a match or null. Matching groups are consumed.
 */
function scanDigitWindows(
  view: string,
  kind: MaskKind,
  maxDigits: number,
  accept: (digits: string, hasPlus: boolean, start: number, end: number) => string | null,
): Span[] {
  const spans: Span[] = [];
  for (const chain of digitChains(view)) {
    let i = 0;
    while (i < chain.length) {
      let matched = false;
      const plusIdx = plusBefore(view, chain[i].start);
      // Collect the maximal window not exceeding maxDigits.
      let lastJ = i;
      let total = chain[i].digits.length;
      while (lastJ + 1 < chain.length && total + chain[lastJ + 1].digits.length <= maxDigits) {
        lastJ++;
        total += chain[lastJ].digits.length;
      }
      for (let j = lastJ; j >= i; j--) {
        let digits = "";
        for (let k = i; k <= j; k++) digits += chain[k].digits;
        const start = plusIdx >= 0 ? plusIdx : chain[i].start;
        const value = accept(digits, plusIdx >= 0, start, chain[j].end);
        if (value !== null) {
          spans.push({ start, end: chain[j].end, kind, value });
          i = j + 1;
          matched = true;
          break;
        }
      }
      if (!matched) i++;
    }
  }
  return spans;
}

function regexSpans(view: string, re: RegExp, kind: MaskKind, value: (m: RegExpExecArray) => string | null): Span[] {
  const spans: Span[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(view))) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const v = value(m);
    if (v !== null) spans.push({ start: m.index, end: m.index + m[0].length, kind, value: v });
  }
  return spans;
}

// ---------------------------------------------------------------------------------------------
// Detectors (in priority order)

const PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;

const API_KEY_RE = new RegExp(
  [
    "sk-ant-[A-Za-z0-9_\\-]{10,}",
    "sk-(?:proj-|live-|test-)?[A-Za-z0-9_\\-]{16,}",
    "(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}",
    "whsec_[A-Za-z0-9]{16,}",
    "gh[pousr]_[A-Za-z0-9]{20,}",
    "github_pat_[A-Za-z0-9_]{20,}",
    "glpat-[A-Za-z0-9_\\-]{16,}",
    "npm_[A-Za-z0-9]{30,}",
    "(?:AKIA|ASIA)[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_\\-]{30,}",
    "ya29\\.[0-9A-Za-z_\\-]{20,}",
    "xox[abpr]-[A-Za-z0-9\\-]{10,}",
    "xapp-[A-Za-z0-9\\-]{10,}",
    "rzp_(?:live|test)_[A-Za-z0-9]{10,}",
    "SG\\.[A-Za-z0-9_\\-]{16,}\\.[A-Za-z0-9_\\-]{16,}",
    "eyJ[A-Za-z0-9_\\-]{5,}\\.[A-Za-z0-9_\\-]{5,}\\.[A-Za-z0-9_\\-]{5,}",
  ].join("|"),
  "g",
);

const PASSWORD_RE =
  /(^|[^A-Za-z])(passwords?|passwd|passcode|passphrase|pass|pwd|mpin|pin|otp)(?![A-Za-z])(?:[ \t]*[:=]+|[ \t]*[\-\u2013\u2014]+(?=\s)|[ \t]+[\-\u2013\u2014]+|\s+is\b)\s*("[^"\n]{1,200}"|'[^'\n]{1,200}'|`[^`\n]{1,200}`|[^\s\uE000]+)/gi;

const UPI_PSPS = new Set([
  "abfspay", "airtel", "airtelpaymentsbank", "albk", "allahabadbank", "andb", "apb", "apl", "aubank", "axis",
  "axisb", "axisbank", "axl", "bandhan", "barodampay", "barodapay", "birla", "boi", "cbin", "cboi", "centralbank",
  "citi", "citigold", "cmsidfc", "cnrb", "csbpay", "dbs", "dcb", "dlb", "equitas", "ezeepay", "fam", "fbl",
  "federal", "freecharge", "hdfcbank", "hdfcbankjd", "hsbc", "ibl", "icici", "idbi", "idfc", "idfcbank",
  "idfcfirst", "ikwik", "imobile", "indbank", "indianbank", "indus", "iob", "jio", "jkb", "jupiteraxis",
  "karurvysyabank", "kaypay", "kbl", "kmbl", "kotak", "kvb", "lvb", "mahb", "myicici", "naviaxis", "nsdl",
  "obc", "okaxis", "okbizaxis", "okhdfcbank", "okicici", "oksbi", "paytm", "payzapp", "pingpay", "pnb",
  "pockets", "postbank", "psb", "ptaxis", "pthdfc", "ptsbi", "ptyes", "rajgovhdfcbank", "rapl", "rbl", "sbi",
  "sc", "scb", "scmobile", "sib", "slc", "sliceaxis", "srcb", "superyes", "synd", "tapicici", "timecosmos",
  "tjsb", "ubi", "uboi", "uco", "unionbank", "unionbankofindia", "united", "upi", "utbi", "vijb", "waaxis",
  "wahdfcbank", "waicici", "wasbi", "ybl", "yapl", "yesbank", "yesbankltd", "yesg",
]);

const AT_LIKE = /^[A-Za-z0-9._\-]{1,256}@[A-Za-z][A-Za-z0-9\-]{1,63}/;

function upiDetector(view: string): Span[] {
  return regexSpans(view, /[A-Za-z0-9._\-]{1,256}@[A-Za-z][A-Za-z0-9.\-]{1,63}/g, "upi", (m) => {
    if (!AT_LIKE.test(m[0])) return null;
    const [local, domainRaw] = m[0].split("@");
    const domain = domainRaw.replace(/[.\-]+$/, "");
    if (domain.includes(".")) return null; // an email domain
    const psp = domain.toLowerCase();
    const known = UPI_PSPS.has(psp) || /(?:bank|pay|upi|axis|icici|sbi|hdfc)$/.test(psp);
    const phoneHandle = /^\d{10,12}$/.test(local);
    return known || phoneHandle ? `${local.toLowerCase()}@${psp}` : null;
  }).map((s) => ({ ...s, end: s.start + s.value.length }));
}

const EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,24}/g;
const AT_FORM = "(?:@|\\s*[\\[\\(\\{<]\\s*at\\s*[\\]\\)\\}>]\\s*)";
const DOT_FORM = "(?:\\s*\\.\\s*|\\s*[\\[\\(\\{<]\\s*dot\\s*[\\]\\)\\}>]\\s*|\\s+dot\\s+)";
const OBFUSCATED_EMAIL_RE = new RegExp(
  `[A-Za-z0-9._%+\\-]+${AT_FORM}[A-Za-z0-9\\-]+(?:${DOT_FORM}[A-Za-z0-9\\-]+)+`,
  "gi",
);
const WORD_EMAIL_RE =
  /[A-Za-z0-9._%+\-]+\s+at\s+[A-Za-z0-9\-]+(?:\s+dot\s+[A-Za-z0-9\-]+)*\s+dot\s+(?:com|in|org|net|edu|co|io|ac|gov|info|me)\b/gi;

function canonicalEmail(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\s*[\[\(\{<]\s*at\s*[\]\)\}>]\s*|\s+at\s+/g, "@")
    .replace(/\s*[\[\(\{<]\s*dot\s*[\]\)\}>]\s*|\s+dot\s+|\s*\.\s*/g, ".");
}

function emailDetector(view: string): Span[] {
  const plain = regexSpans(view, EMAIL_RE, "email", (m) => m[0].toLowerCase());
  // Obfuscated forms; the plain regex already covers ordinary addresses.
  const obfuscated = [
    ...regexSpans(view, OBFUSCATED_EMAIL_RE, "email", (m) => (/[\[\(\{<]|\s/.test(m[0]) ? canonicalEmail(m[0]) : null)),
    ...regexSpans(view, WORD_EMAIL_RE, "email", (m) => canonicalEmail(m[0])),
  ];
  return [...plain, ...obfuscated];
}

function cardDetector(view: string): Span[] {
  return scanDigitWindows(view, "card", 19, (digits) =>
    digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? digits : null,
  );
}

const BANK_KEYWORD_RE = /(^|[^A-Za-z])(a\/c|a\.c\.?|acct|accno|acno|account|acc)(?![A-Za-z])/gi;

function bankDetector(view: string): Span[] {
  const keywords: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  BANK_KEYWORD_RE.lastIndex = 0;
  while ((m = BANK_KEYWORD_RE.exec(view))) {
    const start = m.index + m[1].length;
    keywords.push({ start, end: start + m[2].length });
  }
  if (keywords.length === 0) return [];
  const near = (start: number, end: number) =>
    keywords.some((k) => (start >= k.end && start - k.end <= 40) || (end <= k.start && k.start - end <= 40));
  return scanDigitWindows(view, "bank_account", 18, (digits, _plus, start, end) =>
    digits.length >= 9 && digits.length <= 18 && near(start, end) ? digits : null,
  );
}

function phoneDetector(view: string): Span[] {
  return scanDigitWindows(view, "phone", 15, (digits, hasPlus) => {
    const n = digits.length;
    let ok = false;
    if (hasPlus) ok = n >= 8 && n <= 15;
    else if (n === 10 && /^[6-9]/.test(digits)) ok = true;
    else if (n === 11 && /^0[6-9]/.test(digits)) ok = true;
    else if (n === 12 && /^91[6-9]/.test(digits)) ok = true;
    else if (n === 14 && /^0091[6-9]/.test(digits)) ok = true;
    else if ((n === 10 || n === 11) && /^0[1-9]/.test(digits)) ok = true; // landline with STD code
    // Same canonical form as identity hashing, so +91 / 0091 / 0 / bare forms share one token.
    return ok ? canonicalPhoneNumber(digits, hasPlus) : null;
  });
}

function aadhaarDetector(view: string): Span[] {
  return scanDigitWindows(view, "government_id", 12, (digits) =>
    digits.length === 12 && /^[2-9]/.test(digits) && verhoeffValid(digits) ? `aadhaar:${digits}` : null,
  );
}

const PAN_RE = /(^|[^A-Za-z0-9])([A-Za-z]{5}[0-9]{4}[A-Za-z])(?![A-Za-z0-9])/g;
const IFSC_RE = /(^|[^A-Za-z0-9])([A-Za-z]{4}0[A-Za-z0-9]{6})(?![A-Za-z0-9])/g;

function prefixedDetector(re: RegExp, kind: MaskKind, value: (s: string) => string | null): Detector {
  return (view) => {
    const spans: Span[] = [];
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(view))) {
      const start = m.index + m[1].length;
      const v = value(m[2]);
      if (v !== null) spans.push({ start, end: start + m[2].length, kind, value: v });
    }
    return spans;
  };
}
const panDetector = prefixedDetector(PAN_RE, "government_id", (s) => {
  // A PAN's fourth letter is the holder type; be lenient (over-mask) but require letters/digits shape.
  return `pan:${s.toUpperCase()}`;
});

const ifscDetector = prefixedDetector(IFSC_RE, "ifsc", (s) => {
  // Lower-case all-letter tails ("abcd0efghij") are unlikely IFSCs; anything with a digit or in
  // upper case is masked.
  return /\d/.test(s.slice(5)) || s === s.toUpperCase() ? s.toUpperCase() : null;
});

const SECRET_CANDIDATE_RE = /[A-Za-z0-9+\/=_\-]{32,}/g;

function secretDetector(view: string): Span[] {
  return regexSpans(view, SECRET_CANDIDATE_RE, "secret", (m) => {
    const s = m[0];
    // No punctuation guard: emails and UPI IDs are already masked (they run first), so a
    // candidate next to ".", ",", ")" or end of text is a bare token and must be masked.
    if (shannonEntropy(s) > 4.0) return s;
    // Long hex strings (hex secrets, tokens) cannot exceed 4.0 bits/char; mask them anyway.
    if (/^[0-9a-fA-F]{32,}$/.test(s)) return s;
    return null;
  });
}

function passwordDetector(view: string): Span[] {
  const spans: Span[] = [];
  PASSWORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PASSWORD_RE.exec(view))) {
    const value = m[3];
    const start = m.index + m[0].length - value.length;
    spans.push({ start, end: start + value.length, kind: "password", value });
  }
  return spans;
}

const DETECTORS: Detector[] = [
  (v) => regexSpans(v, PRIVATE_KEY_RE, "secret", (m) => m[0]),
  (v) => regexSpans(v, API_KEY_RE, "api_key", (m) => m[0]),
  // UPI before email (§12.1); both before the secret detector, so a long local part or domain
  // label is masked as part of the address rather than leaving the rest of the address behind.
  upiDetector,
  emailDetector,
  // Before the password and digit detectors, so a long token is masked whole, never in pieces
  // (a hex token must not be split into phone numbers).
  secretDetector,
  passwordDetector,
  cardDetector,
  bankDetector,
  phoneDetector,
  aadhaarDetector,
  panDetector,
  ifscDetector,
];

/** Removes overlapping spans: earlier start wins, then longer span. */
function nonOverlapping(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Span[] = [];
  let lastEnd = -1;
  for (const s of sorted) {
    if (s.start >= lastEnd) {
      out.push(s);
      lastEnd = s.end;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Masker

export interface Masker {
  /** Masks `text` (NFC-normalized first). Token numbering is shared across calls. */
  mask(text: string, context?: MaskContext): MaskResult;
  /** Running totals of masked occurrences across all calls. */
  totals(): Record<MaskKind, number>;
}

export function createMasker(): Masker {
  // value → token, per kind. In memory only; never exposed.
  const tokens = new Map<string, string>();
  const nextNumber = new Map<MaskKind, number>();
  const totals = emptyMaskCounts();

  function tokenFor(kind: MaskKind, value: string): string {
    const fixed = FIXED_TOKEN[kind];
    if (fixed) return fixed;
    const key = `${kind}\u0000${value}`;
    let token = tokens.get(key);
    if (!token) {
      const n = (nextNumber.get(kind) ?? 0) + 1;
      nextNumber.set(kind, n);
      token = `[${NUMBERED_TOKEN_PREFIX[kind]}_${n}]`;
      tokens.set(key, token);
    }
    return token;
  }

  function mask(text: string, _context: MaskContext = "chat"): MaskResult {
    // The context is accepted for the contract; v1 applies the same rules to every context.
    void _context;
    const counts = emptyMaskCounts();
    let work = (text ?? "").normalize("NFC");
    let view = buildView(work);
    const replacements: string[] = [];

    for (const detect of DETECTORS) {
      const spans = nonOverlapping(detect(view));
      if (spans.length === 0) continue;
      let newWork = "";
      let newView = "";
      let cursor = 0;
      for (const s of spans) {
        const token = tokenFor(s.kind, s.value);
        const placeholder = encodePlaceholder(replacements.length);
        replacements.push(token);
        counts[s.kind]++;
        newWork += work.slice(cursor, s.start) + placeholder;
        newView += view.slice(cursor, s.start) + placeholder;
        cursor = s.end;
      }
      work = newWork + work.slice(cursor);
      view = newView + view.slice(cursor);
    }

    const out = work.replace(PLACEHOLDER_RE, (whole, enc: string) => {
      const token = replacements[decodePlaceholderId(enc)];
      return token ?? whole;
    });
    addMaskCounts(totals, counts);
    return { text: out, counts };
  }

  return {
    mask,
    totals: () => ({ ...totals }),
  };
}

/** Contract `MaskTextFn`: sync, pure; a fresh token map per call. */
export const maskText: MaskTextFn = (input) => createMasker().mask(input.text, input.context);
