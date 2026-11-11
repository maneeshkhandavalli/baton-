/**
 * Participant identity hashing (§12.11, D28–D30). Implements lib/contracts/identity.ts and must
 * reproduce its `IDENTITY_GOLDEN_VECTORS` exactly (asserted in lib/privacy/__tests__/identity.test.ts).
 *
 * identity_hash = lower-case hex HMAC-SHA256(key = UTF-8 bytes of the pepper string,
 *                                            message = UTF-8 bytes of the normalized identity string).
 *
 * - The pepper is always passed in by the caller. This module never reads environment variables and
 *   never falls back to a default. A missing pepper, one shorter than 32 characters, or one with
 *   leading or trailing whitespace is `identity_pepper_invalid` (returned by the parser entry
 *   points as a `ParserInputFailure`, D34).
 * - Every hash is under pepper version `p1` (`CURRENT_IDENTITY_PEPPER_VERSION`), stable and
 *   non-rotating. Records match only when identity kind, hash and pepper version all agree.
 * - The normalization rules are FROZEN for p1: changing them changes stored hashes exactly like
 *   rotating the pepper (§12.11 point 8).
 */

import { createHmac } from "node:crypto";

import type { IdentityKind, IdentityPepperVersion } from "../contracts/enums";
import {
  CURRENT_IDENTITY_PEPPER_VERSION,
  IDENTITY_NAMESPACE_PREFIXES,
  IDENTITY_PEPPER_CANARY_MESSAGE,
  MIN_IDENTITY_PEPPER_LENGTH,
  identityKindOfNormalized,
} from "../contracts/identity";
import { ParserInputError } from "../parsers/errors";
import { canonicalPhoneNumber, foldDigits } from "./phone";

/** The pepper version of every hash this module produces (re-exported from the contract). */
export const IDENTITY_PEPPER_VERSION: IdentityPepperVersion = CURRENT_IDENTITY_PEPPER_VERSION;
export { MIN_IDENTITY_PEPPER_LENGTH };

export function assertIdentityPepper(pepper: unknown): asserts pepper is string {
  if (typeof pepper !== "string" || pepper.length < MIN_IDENTITY_PEPPER_LENGTH || pepper.trim() !== pepper) {
    // One message for every case: the reason is for operators, and the pepper is never described.
    throw new ParserInputError(
      "identity_pepper_invalid",
      "identityPepper",
      `identityPepper must be a string of at least ${MIN_IDENTITY_PEPPER_LENGTH} characters with no surrounding whitespace`,
    );
  }
}

// Bidi controls, zero-width characters, word joiner, BOM and soft hyphen. WhatsApp wraps phone
// numbers in U+202A…U+202C and prefixes iOS lines with U+200E.
const INVISIBLE = /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Strips invisible formatting characters, applies NFKC and collapses whitespace. */
export function cleanSenderString(raw: string): string {
  return raw.replace(INVISIBLE, "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

/**
 * True when a sender string is a phone number rather than a saved-contact name: only digits,
 * an optional leading "+", and spacing or punctuation, with 7–15 digits.
 */
export function isPhoneLikeSender(raw: string): boolean {
  // Unicode decimal digits (e.g. Devanagari) are folded so a number is a number in any script.
  const s = foldDigits(cleanSenderString(raw));
  if (!/^\+?[\d\s().\-]+$/.test(s)) return false;
  const digits = s.replace(/\D/g, "").length;
  return digits >= 7 && digits <= 15;
}

/**
 * Normalized identity string for a sender (§12.11 points 2–5, frozen for p1):
 * - phone-like senders → "tel:" + E.164 when the prefix is explicit ("+91 99999 00001",
 *   "0091 99999 00001", "+91 0 99999 00001" → "tel:+919999900001"), else "tel:" + the bare digits
 *   as written. No default region is ever applied;
 * - other senders → "name:" + NFKC, invisible characters removed, whitespace collapsed, lower-case.
 */
export function normalizeSenderIdentity(raw: string): string {
  const s = foldDigits(cleanSenderString(raw));
  if (isPhoneLikeSender(s)) {
    return `${IDENTITY_NAMESPACE_PREFIXES.phone}${canonicalPhoneNumber(s.replace(/\D/g, ""), s.startsWith("+"))}`;
  }
  return `${IDENTITY_NAMESPACE_PREFIXES.name}${cleanSenderString(raw).toLowerCase()}`;
}

/** Identity kind of a sender: "phone" for phone-like senders, otherwise "name". */
export function identityKindOf(raw: string): IdentityKind {
  const kind = identityKindOfNormalized(normalizeSenderIdentity(raw));
  if (kind === null) throw new Error("normalizeSenderIdentity produced a string without a namespace prefix");
  return kind;
}

function hmacHex(pepper: string, message: string): string {
  assertIdentityPepper(pepper);
  return createHmac("sha256", Buffer.from(pepper, "utf8")).update(message, "utf8").digest("hex");
}

/** HMAC-SHA256 of the normalized sender string, lower-case hex. Pepper version: `p1`. */
export function computeIdentityHash(rawSender: string, pepper: string): string {
  return hmacHex(pepper, normalizeSenderIdentity(rawSender));
}

/**
 * The pepper canary (§12.11 point 7): HMAC of `IDENTITY_PEPPER_CANARY_MESSAGE` under `pepper`, using
 * exactly the same derivation as identity hashes. The message has no namespace prefix, so it can never
 * equal a participant identity. Exposed so tests (and main's start-up check, if it chooses) can verify
 * that this implementation and the registry agree.
 */
export function computeIdentityPepperCanary(pepper: string): string {
  return hmacHex(pepper, IDENTITY_PEPPER_CANARY_MESSAGE);
}
