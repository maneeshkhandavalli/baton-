/** Checksum and entropy helpers used by the masking detectors. All pure. */

/** Luhn (mod 10) check for payment card numbers. `digits` must be ASCII digits only. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Verhoeff check (Aadhaar). `digits` must be ASCII digits including the check digit. */
export function verhoeffValid(digits: string): boolean {
  let c = 0;
  const n = digits.length;
  for (let i = 0; i < n; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][digits.charCodeAt(n - 1 - i) - 48]];
  }
  return n > 0 && c === 0;
}

/** Computes the Verhoeff check digit for `digits` (used to build synthetic fixtures). */
export function verhoeffCheckDigit(digits: string): string {
  let c = 0;
  const n = digits.length;
  for (let i = 0; i < n; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][digits.charCodeAt(n - 1 - i) - 48]];
  }
  return String(VERHOEFF_INV[c]);
}

/** Computes the Luhn check digit for `digits` (used to build synthetic fixtures). */
export function luhnCheckDigit(digits: string): string {
  for (let d = 0; d <= 9; d++) if (luhnValid(digits + d)) return String(d);
  throw new Error("unreachable");
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
