/**
 * Deterministic candidate-signal detection (R3 Task 03, EXT-1). Pure: no I/O, no clock, no AI.
 *
 * Input is the PERSISTED message text, which is already masked (phones, emails, UPI ids, credentials →
 * [PHONE_1], [UPI_2], [PASSWORD] …) and pseudonymised (people → [PERSON_n]). Nothing here un-masks,
 * resolves or guesses anything. Each signal keeps the message id and UTF-16 offsets into that body, so the
 * original evidence is never copied or altered: `body.slice(start, end)` is the matched span.
 *
 * Signals are hints for coverage and review. They are never turned into points or evidence here or
 * anywhere else (taxonomy.ts).
 */

import {
  CONTEXT_ONLY_KINDS,
  MAX_SIGNAL_VALUE_CHARS,
  MAX_SIGNALS_PER_MESSAGE,
  SIGNAL_DETECTOR_VERSION,
  type SignalKind,
  type SignalStrength,
} from "./taxonomy";

export interface SignalMessage {
  id: string;
  body: string;
}

export interface DetectedSignal {
  messageId: string;
  kind: SignalKind;
  strength: SignalStrength;
  /** UTF-16 offsets into the message body. */
  start: number;
  end: number;
  /** A short normalised value (a person token, a currency amount, a URL host, a mask token kind); null otherwise. */
  value: string | null;
}

// ── Patterns ─────────────────────────────────────────────────────────────────
// Every pattern is case-insensitive and global. Word boundaries use Unicode-aware lookarounds where a
// pattern can begin with a non-ASCII character.

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORD = "(?:st|nd|rd|th)?";
// "sat"/"sun" are ordinary English words, so only their full forms count.
const WEEKDAY = "(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri)";

const DATE_RE = new RegExp(
  [
    `\\b\\d{1,2}${ORD}\\s*(?:of\\s+)?${MONTH}\\b(?:,?\\s*\\d{4})?`,
    `\\b${MONTH}\\s+\\d{1,2}${ORD}\\b(?:,?\\s*\\d{4})?`,
    `\\b\\d{4}-\\d{2}-\\d{2}\\b`,
    `\\b\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?\\b`,
    `\\b(?:next|this|coming)\\s+(?:${WEEKDAY}|week|month|weekend)\\b`,
    `\\b${WEEKDAY}\\b`,
    `\\b(?:today|tonight|tomorrow|tmrw|tmr|day after tomorrow|eod|eow|end of (?:the )?(?:day|week|month))\\b`,
    `\\b(?:kal|parso)\\b`,
  ].join("|"),
  "giu",
);

const DEADLINE_CUE_RE = /\b(?:by|before|due|deadline|latest(?: by)?|no later than|until|till|last date|closes?|cut-?off|submit(?:ted)? by|tak)\b/iu;

const AMOUNT_RE = new RegExp(
  [
    // symbol or code first: ₹5,000 · Rs. 500 · INR 2 lakh · $40
    `(?:₹|\\brs\\.?|\\binr|\\busd|\\$|€|£)\\s?\\d[\\d,]*(?:\\.\\d+)?(?:\\s?(?:k|lakhs?|lacs?|cr|crores?|thousand))?\\b`,
    // number first: 5000 rupees · 20k · 2 lakh · 300 bucks
    `\\b\\d[\\d,]*(?:\\.\\d+)?\\s?(?:rupees|rs\\b|inr\\b|bucks|dollars|lakhs?|lacs?|crores?|k\\b|\\/-)`,
  ].join("|"),
  "giu",
);

const FINANCE_CUE_RE =
  /\b(?:pay(?:s|ing|ment)?|paid|transfer(?:red)?|reimburs\w*|budget|sponsor\w*|invoice|deposit|advance|fee|fees|refund\w*|owe[sd]?|quot(?:e|ation)|bill|dues|collect(?:ed|ion)?|fund(?:s|ing)?|cost(?:s)?|price|charges?)\b/iu;

const PERSON = "@?\\[PERSON(?:_[1-9]\\d*)?\\]";
const TASK_VERB =
  "(?:handle|take care of|take over|own|do|send|book|call|email|follow up|sort out|coordinate|manage|prepare|collect|arrange|confirm|submit|contact|update|share|check|look after|finish|print|order|renew|pay)";

const ASSIGNMENT_RE = new RegExp(
  [
    `\\bassign(?:ed|ing)?\\s+(?:to|this|that|it)\\b`,
    `${PERSON}\\s*[,:]?\\s*(?:can you|could you|will you|please|pls|plz)\\b`,
    `\\b(?:can you|could you|will you|please|pls|plz)\\s+${TASK_VERB}\\b`,
    `${PERSON}\\s+(?:will|to|should|must|needs to|has to)\\s+${TASK_VERB}\\b`,
    `\\b(?:your job is|you(?:'ll| will) (?:need to )?${TASK_VERB}|you are in charge)\\b`,
  ].join("|"),
  "giu",
);

const OWNERSHIP_RE =
  /\b(?:in charge of|in-charge|incharge|responsible for|owner of|owns the|point of contact|poc for|is handling|handles the|looks after|manages the|takes care of|leads? the|lead for|head of)\b/giu;

// Cues may end in ":" ("final:", "confirmed:", "correction:"), so the right edge of DECISION_RE and REVERSAL_RE is
// a lookahead: a trailing \b would need a word character right after ":" and never matched those cues.
const DECISION_RE =
  /\b(?:we(?:'ve| have)? decided|decided (?:to|that|on)|decision(?: is|:)|final(?:ised|ized)?:|(?:it'?s|its|that'?s) final|finali[sz]ed|agreed (?:to|on|that)|we(?:'re| are) going with|let'?s go with|going ahead with|we will go with|settled on|voted (?:to|for)|approved|is confirmed|has been confirmed|confirmed:|decide (?:kiya|ho gaya)|final hai|pakka)(?=\W|$)/giu;

const REVERSAL_RE =
  /\b(?:actually|change of plans?|plans? changed?|instead(?: of)?|no longer|not anymore|cancel(?:l?ed|ling)?|called off|moved to|moving it to|postponed|rescheduled|pushed to|scratch that|ignore (?:my|the) (?:last|previous)|correction:|changed (?:to|from)|revert(?:ed|ing)?|switch(?:ed|ing) to|won'?t be (?:happening|needed))(?=\W|$)/giu;

const COMMITMENT_STRONG_RE =
  /\b(?:i'?ll|i will|i shall|i can take|i'?m on it|will do|i promise|promise to|leave it (?:to|with) me|count on me|i'?ll make sure|main kar (?:dunga|dungi|lunga|lungi)|kar dunga|kar dungi|bhej dunga|bhej dungi)\b/giu;
const COMMITMENT_WEAK_RE = /\b(?:we'?ll|we will|we shall)\b/giu;

const DEPENDENCY_RE =
  /\b(?:depends on|dependent on|waiting (?:for|on)|blocked (?:by|on)|need(?:s)? (?:approval|sign-?off|permission|confirmation) from|can'?t (?:start|proceed|book|pay|go ahead) (?:until|without|before)|once [^.?!\n]{1,40}? (?:approves?|confirms?|replies|sends|signs))\b/giu;

const OPEN_QUESTION_STRONG_RE =
  /\b(?:does anyone know|anyone know|who is|who's|who will|who has|did we|have we|has anyone|any update|what(?:'s| is) the status|where (?:is|are) the|kis\s?ke paas|kis paas|kaun)\b[^?\n]{0,160}\?/giu;
const QUESTION_SENTENCE_RE = /[^.?!\n]{6,200}\?/gu;

const MENTION_RE = /@?\[PERSON(?:_[1-9]\d*)?\]/gu;
const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]]+|\bwww\.[^\s<>"'`)\]]+|\b(?:bit\.ly|forms\.gle|drive\.google\.com|docs\.google\.com|tinyurl\.com|chat\.whatsapp\.com)\/[^\s<>"'`)\]]+/giu;
const MASK_TOKEN_RE = /\[(?:EMAIL|UPI|BANK|IFSC|CARD|ID|PHONE)_[1-9]\d*\]|\[(?:PASSWORD|API_KEY|SECRET)\]/gu;
const ACCOUNT_CUE_RE =
  /\b(?:login|log in|password|credentials?|admin access|drive folder|shared drive|gmail|instagram|username|user id|otp|2fa|account (?:details|access)|access to the)\b/giu;

// ── Helpers ──────────────────────────────────────────────────────────────────

function* matches(re: RegExp, body: string): Generator<{ start: number; end: number; text: string }> {
  re.lastIndex = 0;
  for (let m = re.exec(body); m !== null; m = re.exec(body)) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    yield { start: m.index, end: m.index + m[0].length, text: m[0] };
  }
}

const clip = (s: string) => (s.length > MAX_SIGNAL_VALUE_CHARS ? s.slice(0, MAX_SIGNAL_VALUE_CHARS) : s);

/** The sentence-ish window before `start` (back to the previous . ! ? or newline, at most 48 chars). */
function before(body: string, start: number): string {
  const from = Math.max(0, start - 48);
  const window = body.slice(from, start);
  const cut = Math.max(window.lastIndexOf("."), window.lastIndexOf("!"), window.lastIndexOf("?"), window.lastIndexOf("\n"));
  return cut >= 0 ? window.slice(cut + 1) : window;
}

function sentenceAround(body: string, start: number, end: number): string {
  const left = Math.max(body.lastIndexOf(".", start - 1), body.lastIndexOf("?", start - 1), body.lastIndexOf("!", start - 1), body.lastIndexOf("\n", start - 1));
  const rights = [".", "?", "!", "\n"].map((c) => body.indexOf(c, end)).filter((i) => i >= 0);
  const right = rights.length > 0 ? Math.min(...rights) : body.length;
  return body.slice(left + 1, right);
}

/** "₹5,000" → "INR 5000"; "20k" → "20k"; unknown currency → null prefix. */
export function normaliseAmount(text: string): string {
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  const currency = /₹|rs|inr|rupees|lakh|lac|crore|\/-/.test(t) ? "INR" : /\$|usd|dollars|bucks/.test(t) ? "USD" : /€/.test(t) ? "EUR" : /£/.test(t) ? "GBP" : null;
  const num = (t.match(/\d[\d,]*(?:\.\d+)?/) ?? [""])[0].replace(/,/g, "");
  const scale = (t.match(/(?:\d\s?)(k|lakhs?|lacs?|cr|crores?|thousand)\b/) ?? [])[1] ?? "";
  const unit = scale.startsWith("lak") || scale.startsWith("lac") ? "lakh" : scale.startsWith("cr") ? "crore" : scale;
  return clip(`${currency ?? "?"} ${num}${unit ? ` ${unit}` : ""}`);
}

/** A lower-case date key good enough for "shared date" matching ("5 dec", "friday", "12/12"). */
export function normaliseDate(text: string): string {
  return clip(
    text
      .toLowerCase()
      .replace(/(\d)(?:st|nd|rd|th)\b/g, "$1")
      .replace(/\bof\s+/g, "")
      .replace(/,/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function urlHost(text: string): string {
  const t = text.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  return clip(t.split(/[/?#]/)[0].toLowerCase());
}

// ── Detector ─────────────────────────────────────────────────────────────────

export function detectMessageSignals(message: SignalMessage): DetectedSignal[] {
  const body = message.body;
  const out: DetectedSignal[] = [];
  if (!body || body.trim().length === 0) return out;
  const push = (kind: SignalKind, strength: SignalStrength, start: number, end: number, value: string | null = null) => {
    out.push({ messageId: message.id, kind, strength, start, end, value });
  };

  const deadlineAnywhere = /\b(?:deadline|due date|last date|cut-?off)\b/iu.test(body);
  for (const m of matches(DATE_RE, body)) {
    const isDeadline = deadlineAnywhere || DEADLINE_CUE_RE.test(before(body, m.start));
    push(isDeadline ? "deadline" : "date", isDeadline ? "strong" : "weak", m.start, m.end, normaliseDate(m.text));
  }
  for (const m of matches(AMOUNT_RE, body)) {
    const financial = FINANCE_CUE_RE.test(sentenceAround(body, m.start, m.end));
    push(financial ? "financial_commitment" : "amount", financial ? "strong" : "weak", m.start, m.end, normaliseAmount(m.text));
  }
  for (const m of matches(ASSIGNMENT_RE, body)) {
    const person = m.text.match(/\[PERSON(?:_[1-9]\d*)?\]/u);
    push("assignment", "strong", m.start, m.end, person ? person[0] : null);
  }
  for (const m of matches(OWNERSHIP_RE, body)) push("ownership", "strong", m.start, m.end);
  for (const m of matches(DECISION_RE, body)) push("decision", "strong", m.start, m.end);
  for (const m of matches(REVERSAL_RE, body)) push("reversal", "strong", m.start, m.end);
  for (const m of matches(COMMITMENT_STRONG_RE, body)) push("commitment", "strong", m.start, m.end);
  for (const m of matches(COMMITMENT_WEAK_RE, body)) push("commitment", "weak", m.start, m.end);
  for (const m of matches(DEPENDENCY_RE, body)) push("dependency", "strong", m.start, m.end);

  const strongQuestions: Array<[number, number]> = [];
  for (const m of matches(OPEN_QUESTION_STRONG_RE, body)) {
    strongQuestions.push([m.start, m.end]);
    push("open_question", "strong", m.start, m.end);
  }
  for (const m of matches(QUESTION_SENTENCE_RE, body)) {
    const start = m.start + (m.text.length - m.text.trimStart().length);
    if (strongQuestions.some(([s, e]) => start < e && m.end > s)) continue;
    push("open_question", "weak", start, m.end);
  }

  for (const m of matches(MENTION_RE, body)) push("person_mention", "weak", m.start, m.end, clip(m.text.replace(/^@/, "")));
  for (const m of matches(URL_RE, body)) push("url", "strong", m.start, m.end, urlHost(m.text));
  for (const m of matches(MASK_TOKEN_RE, body)) push("account_identifier", "strong", m.start, m.end, m.text.replace(/_\d+\]$/, "]"));
  for (const m of matches(ACCOUNT_CUE_RE, body)) push("account_identifier", "weak", m.start, m.end);

  return dedupe(out).slice(0, MAX_SIGNALS_PER_MESSAGE);
}

/** One signal per (kind, start, end); strong kinds first, then by position, so the per-message cap keeps the useful ones. */
function dedupe(signals: DetectedSignal[]): DetectedSignal[] {
  const seen = new Set<string>();
  const kept: DetectedSignal[] = [];
  for (const s of signals) {
    const key = `${s.kind}\u0000${s.start}\u0000${s.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(s);
  }
  return kept.sort((a, b) => (a.strength === b.strength ? a.start - b.start || a.end - b.end || (a.kind < b.kind ? -1 : 1) : a.strength === "strong" ? -1 : 1));
}

/**
 * True when a message's signals make it worth a reviewer's attention: at least one strong signal, or weak
 * signals of two different non-context kinds. A person mention alone never does.
 */
export function isSignalBearing(signals: readonly Pick<DetectedSignal, "kind" | "strength">[]): boolean {
  const relevant = signals.filter((s) => !CONTEXT_ONLY_KINDS.has(s.kind));
  if (relevant.some((s) => s.strength === "strong")) return true;
  return new Set(relevant.map((s) => s.kind)).size >= 2;
}

export interface SourceSignalScan {
  detectorVersion: string;
  messagesInspected: number;
  /** Messages for which `isSignalBearing` holds. */
  messagesWithSignals: number;
  /** Signals on signal-bearing messages only (the ones stored and reported). */
  signals: DetectedSignal[];
  byKind: Record<string, number>;
}

/** Scans every message of one source. Only signal-bearing messages contribute stored signals. */
export function scanSourceSignals(messages: readonly SignalMessage[]): SourceSignalScan {
  const signals: DetectedSignal[] = [];
  let messagesWithSignals = 0;
  for (const m of messages) {
    const found = detectMessageSignals(m);
    if (!isSignalBearing(found)) continue;
    messagesWithSignals += 1;
    signals.push(...found);
  }
  const byKind: Record<string, number> = {};
  for (const s of signals) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  return { detectorVersion: SIGNAL_DETECTOR_VERSION, messagesInspected: messages.length, messagesWithSignals, signals, byKind };
}
