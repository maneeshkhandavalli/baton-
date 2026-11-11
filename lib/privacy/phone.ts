/**
 * Shared phone-number helpers for identity hashing, masking and mention redaction. Pure.
 *
 * IDENTITY NORMALIZATION IS FROZEN for pepper version p1 (§12.11 point 4, D28; golden vectors in
 * lib/contracts/identity.ts):
 *  - an explicit international prefix ("+" or "00") gives E.164 "+<digits>"; "+00…" is read as "00…";
 *  - after an explicit +91, a trunk "0" followed by exactly 10 national digits is removed
 *    ("+91 0 99999 00001" → "+919999900001", "+91 022 1234 5678" → "+912212345678");
 *  - NO DEFAULT REGION: a number without a prefix stays as its bare digits ("9999900001",
 *    "09999900001"), so it never equals an E.164 value and numbers from different countries never
 *    collide. Under-matching between local and international forms is accepted in v1.
 * `canonicalPhoneNumber` implements exactly these rules and takes no policy argument.
 *
 * `indianNationalReading` is NOT an identity rule. It is used only to widen excluded-mention
 * redaction (lib/privacy/excluded-mentions.ts), where over-redaction is the safe failure
 * (reconciliation P2). It must never feed an identity hash.
 */

/** Zero code points of Unicode decimal-digit blocks in the BMP that are folded to ASCII. */
export const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50,
  0x0ed0, 0x0f20, 0x1040, 0x17e0, 0x1810, 0xff10,
] as const;

/** ASCII digit for a BMP decimal-digit code unit, or null. */
export function foldDigitCode(code: number): string | null {
  if (code >= 0x30 && code <= 0x39) return String.fromCharCode(code);
  for (const zero of DIGIT_ZEROS) {
    if (code >= zero && code <= zero + 9) return String.fromCharCode(48 + code - zero);
  }
  return null;
}

/** Replaces every folded decimal digit in `s` with its ASCII digit (length-preserving). */
export function foldDigits(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out += code < 0x80 ? s[i] : (foldDigitCode(code) ?? s[i]);
  }
  return out;
}

/**
 * Canonical phone value (§12.11 point 4) from ASCII `digits` and whether a leading "+" was present:
 * "+<E.164 digits>" when the country is explicit, otherwise the bare digits as written.
 */
export function canonicalPhoneNumber(digits: string, hasPlus: boolean): string {
  let international: string | null = null;
  if (hasPlus) international = digits.startsWith("00") ? digits.slice(2) : digits;
  else if (digits.startsWith("00") && digits.length > 4) international = digits.slice(2);
  if (international === null) return digits;
  // Trunk zero after an explicit +91 before 10 national digits: "+91 0 99999 00001", "+91 022 1234 5678".
  const trunk = /^910(\d{10})$/.exec(international);
  return `+${trunk ? `91${trunk[1]}` : international}`;
}

/**
 * Mention redaction only, never identities: the E.164 reading of an unprefixed number written in an
 * Indian national mobile form (10 digits starting 6-9, optionally after "0" or "91"), or null.
 * Shape alone cannot tell these apart from some landlines and foreign numbers. That is acceptable
 * only because the caller uses it to redact MORE text, never to match identities.
 */
export function indianNationalReading(digits: string, hasPlus: boolean): string | null {
  if (hasPlus || digits.startsWith("00")) return null;
  const mobile = /^(?:91|0)?([6-9]\d{9})$/.exec(digits);
  return mobile ? `+91${mobile[1]}` : null;
}
