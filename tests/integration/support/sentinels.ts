/**
 * Sentinel scanner: finds raw PII or secrets in ANY value (deep walk over strings and object keys).
 * Used on persisted payloads, AI requests, error results and captured logs (§12.1, §12.7, §11.8 rule 6).
 *
 * Two layers:
 *   1. literals: the exact synthetic values planted in the fixtures (fixtures/parser/**) and in tests;
 *   2. patterns: generic detectors, so a value the fixture author did not list is still caught.
 * Mask tokens ("[PHONE_1]", "[PASSWORD]", "[EXCLUDED_PARTICIPANT]") never match.
 * All values here are synthetic (99999 0000N numbers, example.org addresses).
 */

import assert from "node:assert/strict";

/** Raw values in fixtures/parser/whatsapp/pii-chat.txt. */
export const PII_CHAT_LITERALS = [
  "clubfunds@okaxis",
  "9999900003@ybl",
  "99999 00004",
  "099999 00004",
  "001234567890",
  "SBIN0001234",
  "Robo@2024!",
  "pin is 4321",
  "treasurer [at] example [dot] org",
  "sk-test1234567890abcdefghijkl",
  "080-23456789",
] as const;

/** Raw values in other fixtures (ios-12h-dmy, android-24h-dmy, documents/*). */
export const OTHER_FIXTURE_LITERALS = [
  "99999 00002", // unsaved-number sender in ios-12h-dmy.txt
  "meera.sponsor@example.org",
  "robotics.club@example.org",
  "99999 00005",
  "notes.owner@example.com",
] as const;

/** Extra synthetic values tests plant themselves (documents built with fixtures/parser/builders.ts, inputs). */
export const PLANTED = {
  phone: "+91 99999 00007",
  email: "planted.person@example.org",
  upi: "planted.funds@oksbi",
  card: "4111 1111 1111 1111",
  bank: "a/c 112233445566",
  password: "password: Planted#2026",
  apiKey: "ghp_PlantedTokenABCDEFGHIJ0123456789",
} as const;

export const ALL_LITERALS: readonly string[] = [...PII_CHAT_LITERALS, ...OTHER_FIXTURE_LITERALS, ...Object.values(PLANTED)];

export const PII_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "in_mobile", re: /(?<![\dA-Za-z])(?:\+?91[\s-]?|0)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/ },
  { name: "e164", re: /\+\d{1,3}[\s-]?\(?\d[\d\s().-]{6,}\d/ },
  { name: "landline", re: /(?<!\d)0\d{2,4}[\s-]\d{6,8}(?!\d)/ },
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/ },
  { name: "email_obfuscated", re: /\w[\w.]*\s*[[(]\s*at\s*[\])]\s*\w+/i },
  { name: "upi", re: /[A-Za-z0-9._-]+@(?:ok(?:icici|sbi|axis|hdfcbank)|ybl|ibl|axl|paytm|upi)\b/i },
  { name: "ifsc", re: /\b[A-Z]{4}0[A-Z0-9]{6}\b/ },
  { name: "pan", re: /\b[A-Z]{5}\d{4}[A-Z]\b/ },
  { name: "long_digits", re: /(?<![0-9A-Fa-f-])\d{9,18}(?![0-9A-Fa-f])/ },
  { name: "card", re: /(?<!\d)\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}(?!\d)/ },
  { name: "api_key", re: /\b(?:sk-|sk_live_|pk_live_|ghp_|gho_|github_pat_|AKIA|AIza|xox[abpr]-)[A-Za-z0-9_-]{8,}/ },
  { name: "jwt", re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./ },
  { name: "password", re: /\b(?:password|passwd|pwd|pin|otp|passcode)\s*(?:[:=]|\bis\b)\s*(?![[\s])\S+/i },
];

export interface Leak {
  path: string;
  kind: string;
  /** the matched text, truncated; synthetic data only */
  match: string;
}

/** Every string (values and object keys) in a value, with a JSONPath-like location. */
export function collectStrings(value: unknown, path = "$", out: Array<{ path: string; text: string }> = []) {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${path}[${i}]`, out));
  else if (value instanceof Uint8Array) out.push({ path, text: new TextDecoder().decode(value) });
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push({ path: `${path}{key}`, text: k });
      collectStrings(v, `${path}.${k}`, out);
    }
  }
  return out;
}

export function findLeaks(value: unknown, literals: readonly string[] = ALL_LITERALS): Leak[] {
  const leaks: Leak[] = [];
  for (const { path, text } of collectStrings(value)) {
    const lower = text.toLowerCase();
    for (const lit of literals) {
      if (lower.includes(lit.toLowerCase())) leaks.push({ path, kind: `literal`, match: lit });
    }
    for (const { name, re } of PII_PATTERNS) {
      const m = re.exec(text);
      if (m) leaks.push({ path, kind: name, match: m[0].slice(0, 40) });
    }
  }
  return leaks;
}

export function assertNoLeaks(value: unknown, label: string, literals: readonly string[] = ALL_LITERALS): void {
  const leaks = findLeaks(value, literals);
  assert.deepEqual(leaks, [], `${label}: raw PII or secrets found:\n${leaks.map((l) => `  ${l.path} [${l.kind}] ${l.match}`).join("\n")}`);
}

/** Literal strings must not occur anywhere in the value (e.g. an excluded participant's messages). */
export function assertAbsent(value: unknown, label: string, needles: readonly string[]): void {
  const hits = collectStrings(value).flatMap(({ path, text }) =>
    needles.filter((n) => text.toLowerCase().includes(n.toLowerCase())).map((n) => `${path}: ${n}`),
  );
  assert.deepEqual(hits, [], `${label}: excluded content found:\n${hits.join("\n")}`);
}
