/**
 * Participant-name pseudonymisation (Round 3 Task 02, PRIV-1).
 *
 * Every KNOWN participant of a handover (a chat sender, from the uploaded source's metadata) gets a stable,
 * handover-scoped placeholder `[PERSON_n]`. Author labels become the placeholder, and mentions of known
 * participants inside message text are replaced before anything is persisted or sent to the AI. The
 * placeholder → name mapping lives only in the encrypted identity vault (identity-vault.ts) and is resolved
 * on the server for viewers with clearance.
 *
 * What is detected, deliberately conservative so ordinary words survive:
 *  - the participant's whole name (all name words of the label, in order), case-insensitive, with flexible
 *    spacing or "." / "_" / "-" between the words ("Ravi Kumar", "RAVI  KUMAR", "ravi.kumar", "RaviKumar"
 *    is NOT matched: words must be separated);
 *  - each single name word of at least three letters ("Ravi", "Kumar"), case-insensitive, as a whole word,
 *    UNLESS it is a common word (COMMON_WORDS: "will", "mark", "asha", "lead", "mom", …): those are replaced
 *    only as an explicit @mention or inside the whole name;
 *  - @mentions, including WhatsApp's "@⁨~Name⁩" form;
 *  - any script (Devanagari, Tamil, Arabic, …): matching is on Unicode letters, marks and digits, NFC.
 * A name word shared by two or more people ("Ravi" for "Ravi Kumar" and "Ravi Shankar") is ambiguous: it
 * becomes `[PERSON]` (a person, unnumbered), never a guess. A whole name always wins over a shared word.
 *
 * Limitations (documented in docs/round3/privacy-and-data-protection.md): only KNOWN participants are
 * detected. Names of people who never sent a message in any chat source of the handover, nicknames,
 * misspellings, transliterations into another script, names glued to other words ("Ravibhai") and common
 * words used as names are not replaced. This is not a general named-entity recogniser.
 */

/** A known participant: its placeholder number and the masked display label (null: no usable name). */
export interface KnownPerson {
  ordinal: number;
  label: string | null;
}

export const PERSON_TOKEN_PATTERN = /\[PERSON(?:_[1-9]\d*)?\]/g;
export const AMBIGUOUS_PERSON_TOKEN = "[PERSON]";

export function personToken(ordinal: number): string {
  if (!Number.isInteger(ordinal) || ordinal < 1) throw new Error("person ordinal must be a positive integer");
  return `[PERSON_${ordinal}]`;
}

/** True for a whole `[PERSON_n]` / `[PERSON]` token. */
export function isPersonToken(s: string): boolean {
  return /^\[PERSON(?:_[1-9]\d*)?\]$/.test(s);
}

/**
 * Common words that are also given names or label words. Never replaced as a free-standing word; only as
 * part of the participant's whole name or as an explicit @mention. Lower case, NFC.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set([
  // roles and relations that appear in contact names
  "admin", "aunt", "aunty", "auntie", "baba", "babu", "bhabhi", "bhai", "bhaiya", "bhaia", "boss", "bro", "brother",
  "captain", "chacha", "chachi", "coach", "dad", "daddy", "dada", "dadi", "didi", "dost", "hod", "head", "lead",
  "madam", "mama", "mami", "mam", "maam", "mausi", "member", "mom", "mommy", "mother", "nana", "nani", "papa",
  "president", "principal", "secretary", "sir", "sis", "sister", "teacher", "treasurer", "uncle", "work", "office",
  "home", "team", "group", "club", "college", "school", "official", "support", "new", "old", "the", "and", "for",
  "you", "not", "all", "one", "two", "ji", "jee", "saab", "sahab", "sahib", "anna", "akka", "amma", "appa",
  // English words that are also names
  "will", "mark", "bill", "grace", "hope", "joy", "faith", "rose", "lily", "ivy", "dawn", "june", "may", "april",
  "august", "summer", "sunny", "rich", "frank", "art", "guy", "pat", "sue", "rob", "ray", "jack", "bob", "don",
  "max", "sky", "star", "angel", "honey", "baby", "king", "queen", "prince", "princess", "earl", "case", "page",
  "chase", "dean", "drew", "gene", "glen", "hunter", "miles", "penny", "rusty", "sandy", "victor", "wade", "win",
  "young", "long", "may", "lee", "kim", "joe", "jay", "ash", "cash", "chip", "cliff", "dale", "eve", "gay",
  "holly", "iris", "jade", "jewel", "ruby", "pearl", "amber", "crystal", "heather", "violet", "autumn", "storm",
  // Hindi / Hinglish words that are also names
  "asha", "kiran", "pooja", "puja", "raja", "rani", "sagar", "deep", "deepak", "prem", "pyar", "shanti", "sona",
  "chanda", "amar", "jeevan", "gyan", "dhan", "laxmi", "lakshmi", "suraj", "chand", "tara", "jyoti", "roshni",
  "khushi", "anand", "sukh", "dil", "jaan", "neel", "hari", "ram", "shiv", "dev", "devi", "guru", "mitra", "mitr",
  "sathi", "saathi", "bharat", "india", "aaj", "kal", "abhi", "bas", "haan", "nahi", "accha", "acha", "theek",
  "sahi", "kya", "kaise", "kab", "kaun", "kuch", "sab", "log", "yaar", "arre", "bhi", "toh", "hai", "hain",
  "raat", "din", "subah", "sham", "shaam", "meet", "milan", "mohan", "param", "veer", "vijay", "jai", "jaya",
  "shakti", "kamal", "pankaj", "neha", "sneha", "preet", "preeti", "priti", "prerna", "seva", "daya", "karan",
  "arjun", "nidhi", "sudha", "mukti", "moksha", "santosh", "sanjay", "uday", "vikas", "vidya", "vinay", "vishal",
]);

const LETTERS = /[\p{L}\p{M}]/u;
const WORD = /[\p{L}\p{M}\p{N}]+(?:['’][\p{L}\p{M}]+)?/gu;

/** NFC, invisible characters removed, whitespace collapsed. */
function clean(s: string): string {
  return s
    .replace(/[­؜​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** The name words of a label: bracketed tokens ([PHONE_1], [PERSON_2]) and words without letters are dropped. */
export function nameWords(label: string): string[] {
  const withoutTokens = clean(label).replace(/\[[A-Z_]+(?:_\d+)?\]/g, " ");
  return (withoutTokens.match(WORD) ?? []).filter((w) => LETTERS.test(w));
}

function letterCount(s: string): number {
  return (s.match(/\p{L}/gu) ?? []).length;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const key = (words: readonly string[]) => words.map((w) => w.toLocaleLowerCase("und")).join(" ");

const ISOLATES = "[\\u2066-\\u2069\\u200E\\u200F]";
const NOT_BEFORE = "(?<![\\p{L}\\p{N}\\p{M}_\\[])";
const NOT_AFTER = "(?![\\p{L}\\p{N}\\p{M}_\\]])";
const SEP = "[\\s\\u00A0\\u202F._-]+";

interface Form {
  words: string[];
  /** The ordinal, or 0 for an ambiguous word shared by several people. */
  ordinal: number;
  /** Replace only as an explicit @mention. */
  mentionOnly: boolean;
}

export interface Pseudonymizer {
  /** No known names: `apply` is the identity and `containsKnownName` is always false. */
  readonly isEmpty: boolean;
  /** Replaces known participants' names and mentions with their placeholders. */
  apply(text: string): { text: string; count: number };
  /** True when `text` contains a known participant's name (used to refuse model output that reintroduces one). */
  containsKnownName(text: string): boolean;
}

/**
 * Builds the detector for a handover's known people. Labels are the masked display labels from the source
 * metadata (never message text). People without a usable label (phone-number senders) are skipped.
 */
export function createPseudonymizer(people: readonly KnownPerson[]): Pseudonymizer {
  const wholeNames = new Map<string, { words: string[]; ordinals: Set<number> }>();
  const singles = new Map<string, { word: string; ordinals: Set<number> }>();
  for (const p of people) {
    if (p.label === null) continue;
    const words = nameWords(p.label).filter((w) => letterCount(w) >= 1);
    if (words.length === 0) continue;
    const whole = key(words);
    if (letterCount(words.join("")) >= 2) {
      const entry = wholeNames.get(whole) ?? { words, ordinals: new Set<number>() };
      entry.ordinals.add(p.ordinal);
      wholeNames.set(whole, entry);
    }
    if (words.length > 1) {
      for (const w of words) {
        if (letterCount(w) < 3) continue;
        const k = key([w]);
        const entry = singles.get(k) ?? { word: w, ordinals: new Set<number>() };
        entry.ordinals.add(p.ordinal);
        singles.set(k, entry);
      }
    }
  }

  const forms = new Map<string, Form>();
  for (const [k, e] of wholeNames) {
    const ordinal = e.ordinals.size === 1 ? [...e.ordinals][0] : 0;
    // A one-word whole name ("Ravi", "Mom") is a single word: the common-word rule applies to it too.
    const mentionOnly = e.words.length === 1 && (COMMON_WORDS.has(k) || letterCount(e.words[0]) < 3);
    forms.set(k, { words: e.words, ordinal, mentionOnly });
  }
  for (const [k, e] of singles) {
    if (forms.has(k)) continue; // a whole name always wins over a shared word
    const ordinal = e.ordinals.size === 1 ? [...e.ordinals][0] : 0;
    forms.set(k, { words: [e.word], ordinal, mentionOnly: COMMON_WORDS.has(k) });
  }

  if (forms.size === 0) {
    return { isEmpty: true, apply: (text) => ({ text, count: 0 }), containsKnownName: () => false };
  }

  const ordered = [...forms.values()].sort(
    (a, b) => b.words.length - a.words.length || b.words.join("").length - a.words.join("").length,
  );
  const alt = (list: Form[]) => list.map((f) => f.words.map(escapeRegExp).join(SEP)).join("|");
  const free = ordered.filter((f) => !f.mentionOnly);
  const mention = `@${ISOLATES}*~?`;
  const parts: string[] = [];
  // Mentions first (they consume the "@"), then free-standing names.
  parts.push(`${NOT_BEFORE}${mention}(${alt(ordered)})${ISOLATES}*${NOT_AFTER}`);
  if (free.length > 0) parts.push(`${NOT_BEFORE}(${alt(free)})${NOT_AFTER}`);
  const re = new RegExp(parts.join("|"), "giu");

  const tokenFor = (matched: string): string => {
    const words = clean(matched).match(WORD) ?? [];
    const form = forms.get(key(words));
    if (!form || form.ordinal === 0) return AMBIGUOUS_PERSON_TOKEN;
    return personToken(form.ordinal);
  };

  return {
    isEmpty: false,
    apply(text: string) {
      let count = 0;
      const out = text.normalize("NFC").replace(re, (_whole, mentioned?: string, plain?: string) => {
        count += 1;
        return tokenFor(mentioned ?? plain ?? "");
      });
      return { text: count === 0 ? text : out, count };
    },
    containsKnownName(text: string) {
      re.lastIndex = 0;
      const hit = re.test(text.normalize("NFC"));
      re.lastIndex = 0;
      return hit;
    },
  };
}
