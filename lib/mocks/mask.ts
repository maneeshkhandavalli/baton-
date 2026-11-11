/**
 * Minimal stand-in for the parser agent's `maskText` (§12.1), applied to user-entered text in mock
 * actions so the UI shows the same behaviour (mask tokens, never the raw value). The real masking
 * lives in lib/privacy/mask.ts and is far more thorough.
 */

const RULES: Array<[RegExp, string]> = [
  [/[A-Za-z0-9._-]+@(okicici|oksbi|okaxis|okhdfcbank|ybl|ibl|axl|paytm|upi)\b/gi, "UPI"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "EMAIL"],
  [/(\+91[\s-]?)?[6-9]\d{9}\b/g, "PHONE"],
];

export function mockMaskText(text: string): string {
  let out = text;
  for (const [re, label] of RULES) {
    let n = 0;
    const seen = new Map<string, string>();
    out = out.replace(re, (m) => {
      if (!seen.has(m)) seen.set(m, `[${label}_${++n}]`);
      return seen.get(m)!;
    });
  }
  return out.replace(/\b(password|pwd|pass|passcode|pin|otp)(\s*(?:[:=-]|is)\s*)\S+/gi, "$1$2[PASSWORD]");
}
