/**
 * Participant identity contract (docs/architecture/shared-contracts.md §12.8 point 9, §12.11).
 *
 * identity_hash = lower-case hex HMAC-SHA256(key = UTF-8 bytes of IDENTITY_PEPPER,
 *                                            message = UTF-8 bytes of the normalized identity string).
 *
 * The normalized identity string always starts with its namespace prefix ("tel:" or "name:"), so a
 * phone identity can never equal a name identity. Two stored hashes refer to the same participant
 * only when identity kind, hash AND pepper version all agree (`sameIdentity`).
 *
 * This module holds constants and pure helpers only. It never computes an HMAC (no `node:crypto`), so
 * it is safe to import from client code. The parser (lib/privacy/identity.ts) implements hashing and
 * must reproduce `IDENTITY_GOLDEN_VECTORS` exactly; the contract tests verify the vectors themselves.
 */

import type { IdentityKind, IdentityPepperVersion } from "./enums";

export const IDENTITY_HASH_ALGORITHM = "HMAC-SHA256" as const;

/** The only pepper version in v1. Stable and non-rotating (§12.8 point 9). */
export const CURRENT_IDENTITY_PEPPER_VERSION: IdentityPepperVersion = "p1";

/** Namespace prefix of the normalized identity string, per identity kind. */
export const IDENTITY_NAMESPACE_PREFIXES = {
  phone: "tel:",
  name: "name:",
} as const satisfies Record<IdentityKind, string>;

/** A pepper shorter than this, or with leading/trailing whitespace, is a configuration error. */
export const MIN_IDENTITY_PEPPER_LENGTH = 32;

/** Stored and transported form of an identity hash: 64 lower-case hex characters. */
export const IDENTITY_HASH_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Canary input (§12.8 point 9). The key registry stores HMAC(pepper, this string) for `p1`; a
 * recovered or configured pepper is valid only if it reproduces that value. The message is fixed
 * forever for `p1`; it is never a participant identity because it has no namespace prefix.
 */
export const IDENTITY_PEPPER_CANARY_MESSAGE = "baton:identity-pepper-canary:p1";

/** A stored participant identity: what must agree for two records to name the same person. */
export interface IdentityRef {
  identityKind: IdentityKind;
  identityHash: string; // lower-case hex, IDENTITY_HASH_PATTERN
  identityPepperVersion: IdentityPepperVersion;
}

/**
 * True only when kind, hash and pepper version all agree. Hashes are compared in their canonical
 * lower-case form; anything that is not a 64-character hex string never matches.
 */
export function sameIdentity(a: IdentityRef, b: IdentityRef): boolean {
  const ha = a.identityHash.toLowerCase();
  const hb = b.identityHash.toLowerCase();
  return (
    a.identityKind === b.identityKind &&
    a.identityPepperVersion === b.identityPepperVersion &&
    IDENTITY_HASH_PATTERN.test(ha) &&
    ha === hb
  );
}

/** The identity kind encoded in a normalized identity string, or null if it has no valid prefix. */
export function identityKindOfNormalized(normalized: string): IdentityKind | null {
  if (normalized.startsWith(IDENTITY_NAMESPACE_PREFIXES.phone)) return "phone";
  if (normalized.startsWith(IDENTITY_NAMESPACE_PREFIXES.name)) return "name";
  return null;
}

// ── Golden vectors (frozen for p1) ───────────────────────────────────────────

/**
 * Test-only pepper for the golden vectors. NOT a secret and never valid in any environment: the
 * start-up check rejects it because it cannot match the registry canary of a real `p1` pepper.
 */
export const IDENTITY_GOLDEN_TEST_PEPPER = "baton-golden-vector-pepper-NOT-A-SECRET-v1";

/** HMAC of IDENTITY_PEPPER_CANARY_MESSAGE under IDENTITY_GOLDEN_TEST_PEPPER. */
export const IDENTITY_GOLDEN_TEST_CANARY = "fb4d51c3b9123c223b0247799c2a97f9c8b7500239d65e792830c7a028f5c7b9";

export interface IdentityGoldenVector {
  /** Sender string exactly as it appears in the export (escapes are part of the input). */
  raw: string;
  identityKind: IdentityKind;
  normalized: string;
  /** HMAC-SHA256 under IDENTITY_GOLDEN_TEST_PEPPER, lower-case hex. */
  hash: string;
  note: string;
}

/**
 * Normalization rules these vectors freeze (§12.11):
 *  1. Remove invisible formatting characters (bidi controls U+200E/U+200F/U+202A–U+202E/U+2066–U+2069,
 *     zero-width U+200B–U+200D, U+2060–U+2064, U+061C, U+FEFF, U+00AD), apply NFKC, collapse
 *     whitespace runs to one space, trim. Fold Unicode decimal digits to ASCII.
 *  2. Phone-like (only digits, an optional leading "+", spaces and ( ) . -; 7–15 digits) → "tel:".
 *     - "+" or "00" prefix → E.164 "+<digits>"; "+00…" is read as "00…".
 *     - "+91" followed by a trunk "0" and 10 national digits drops the trunk zero.
 *     - No prefix → the bare national digits, no "+", no default region. A local number never equals
 *       an E.164 identity.
 *  3. Anything else → "name:" + the cleaned string in lower case (String.prototype.toLowerCase).
 */
export const IDENTITY_GOLDEN_VECTORS: readonly IdentityGoldenVector[] = [
  { raw: "+91 99999 00001", identityKind: "phone", normalized: "tel:+919999900001", hash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924", note: "explicit +91" },
  { raw: "+919999900001", identityKind: "phone", normalized: "tel:+919999900001", hash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924", note: "explicit +91, no spaces" },
  { raw: "0091 99999 00001", identityKind: "phone", normalized: "tel:+919999900001", hash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924", note: "international 00 prefix" },
  { raw: "+0091 99999 00001", identityKind: "phone", normalized: "tel:+919999900001", hash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924", note: "+00 is read as 00" },
  { raw: "+91 0 99999 00001", identityKind: "phone", normalized: "tel:+919999900001", hash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924", note: "trunk zero after +91 (mobile)" },
  { raw: "+91 022 1234 5678", identityKind: "phone", normalized: "tel:+912212345678", hash: "bd793ff5698bda6bf1bc206b40988cf2fbb8698179d1b3c3dcd08f8b7b10d00f", note: "trunk zero after +91 (landline)" },
  { raw: "+44 20 7946 0958", identityKind: "phone", normalized: "tel:+442079460958", hash: "f1995fb82b3d47d0a214f426c2ede91badcad83674cb5c68f74167c9dd68bcf4", note: "explicit non-Indian prefix" },
  { raw: "+1 (650) 253-0000", identityKind: "phone", normalized: "tel:+16502530000", hash: "9314dd1d62eac63740ade3e5373d92416776c09316ea6f7c8748fdddeac05cff", note: "punctuation removed" },
  { raw: "\u202A+91 99999 00001\u202C", identityKind: "phone", normalized: "tel:+919999900001", hash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924", note: "WhatsApp bidi wrapping" },
  { raw: "+\u096F\u0967 \u096F\u096F\u096F\u096F\u096F \u0966\u0966\u0966\u0966\u0967", identityKind: "phone", normalized: "tel:+919999900001", hash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924", note: "Devanagari digits folded" },
  { raw: "99999 00001", identityKind: "phone", normalized: "tel:9999900001", hash: "d7dacd1ac503a51b7178726dbdbd25d1925a660e822fb9bfe7299e58ad4be585", note: "unprefixed: local, no +91 inferred" },
  { raw: "099999 00001", identityKind: "phone", normalized: "tel:09999900001", hash: "159b7fb62de738b584587c736b5a86ae51f748d1d97f4919950e1793f40ab767", note: "unprefixed with trunk zero: kept as written" },
  { raw: "(650) 253-0000", identityKind: "phone", normalized: "tel:6502530000", hash: "d9831614d44fc000906c8f1266c378d6568befac2b0481faed4c9485fa17a1cc", note: "unprefixed foreign number stays local" },
  { raw: "020 7946 0958", identityKind: "phone", normalized: "tel:02079460958", hash: "5b9b73179cce111a2fdb1d654597776df765ce19ce78f6dcf7c22105edca6928", note: "unprefixed landline stays local" },
  { raw: "Ravi Kumar", identityKind: "name", normalized: "name:ravi kumar", hash: "c5eae44a7d1116bffa263282048a6f9e905fb8450dc368ae3c0d87ac7826da73", note: "saved-contact name" },
  { raw: "  RAVI   Kumar ", identityKind: "name", normalized: "name:ravi kumar", hash: "c5eae44a7d1116bffa263282048a6f9e905fb8450dc368ae3c0d87ac7826da73", note: "case and whitespace" },
  { raw: "\u200ERavi Kumar", identityKind: "name", normalized: "name:ravi kumar", hash: "c5eae44a7d1116bffa263282048a6f9e905fb8450dc368ae3c0d87ac7826da73", note: "iOS left-to-right mark" },
  { raw: "\uFF32\uFF41\uFF56\uFF49", identityKind: "name", normalized: "name:ravi", hash: "4486ef970e5b390ea112f57d71adce8473891f4ee6dad6542b684a50b2d8dd11", note: "fullwidth letters (NFKC)" },
  { raw: "Asha (Treasurer)", identityKind: "name", normalized: "name:asha (treasurer)", hash: "ad88d2ea82d4e2d55e9f46188f570f714ac27af9c063d48ef2639161a53ad46d", note: "punctuation kept in names" },
  { raw: "12345", identityKind: "name", normalized: "name:12345", hash: "099b04735f56aaac633c48e5ebd3fdaf0a895dbad9bbdf5545898f1107e7f3fa", note: "fewer than 7 digits is not a phone" },
];
