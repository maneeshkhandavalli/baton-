/**
 * Splits stored text into plain text, mask tokens and excluded-participant tokens (§12.1, D31).
 *
 * Only the canonical mask tokens count as masks: `[PHONE_n]`, `[EMAIL_n]`, `[UPI_n]`, `[BANK_n]`,
 * `[IFSC_n]`, `[CARD_n]`, `[ID_n]`, `[PASSWORD]`, `[API_KEY]` and `[SECRET]`. `[EXCLUDED_PARTICIPANT]`
 * is a separate parser token: never a mask, never numbered. R3 Task 02: `[PERSON_n]` is a participant
 * placeholder (and `[PERSON]` an ambiguous one); it is resolved to a name only for viewers with clearance
 * (components/shared/person-token.tsx). Any other bracketed text is left as is.
 */

import { EXCLUDED_PARTICIPANT_TOKEN } from "@/lib/contracts/parser";

export type MaskedSegment =
  | { kind: "text"; text: string }
  | { kind: "mask"; token: string }
  | { kind: "excluded_participant" }
  | { kind: "person"; ordinal: number | null };

const NUMBERED = ["PHONE", "EMAIL", "UPI", "BANK", "IFSC", "CARD", "ID"];
const UNNUMBERED = ["PASSWORD", "API_KEY", "SECRET"];

const MASK_TOKEN = new RegExp(`^\\[(?:(?:${NUMBERED.join("|")})_\\d+|${UNNUMBERED.join("|")})\\]$`);
const ANY_TOKEN = new RegExp(
  `(\\[(?:(?:${NUMBERED.join("|")})_\\d+|${UNNUMBERED.join("|")}|EXCLUDED_PARTICIPANT|PERSON(?:_[1-9]\\d{0,5})?)\\])`,
  "g",
);
const PERSON_TOKEN = /^\[PERSON(?:_([1-9]\d{0,5}))?\]$/;

export const isMaskToken = (s: string) => MASK_TOKEN.test(s);

export function segmentMaskedText(text: string): MaskedSegment[] {
  const out: MaskedSegment[] = [];
  for (const part of text.split(ANY_TOKEN)) {
    if (part === "") continue;
    const person = PERSON_TOKEN.exec(part);
    if (part === EXCLUDED_PARTICIPANT_TOKEN) out.push({ kind: "excluded_participant" });
    else if (person) out.push({ kind: "person", ordinal: person[1] ? Number(person[1]) : null });
    else if (isMaskToken(part)) out.push({ kind: "mask", token: part });
    else {
      const last = out[out.length - 1];
      if (last?.kind === "text") last.text += part;
      else out.push({ kind: "text", text: part });
    }
  }
  return out;
}

/**
 * For places that can only hold plain text (`<option>`, `title`, `aria-label`): mask tokens stay as
 * written, and the excluded-participant token becomes the words "excluded participant", never the raw
 * token and never a mask-style label.
 */
export function maskedTextToPlain(text: string): string {
  return segmentMaskedText(text)
    .map((s) =>
      s.kind === "text" ? s.text : s.kind === "mask" ? s.token : s.kind === "person" ? personPlainLabel(s.ordinal) : "excluded participant",
    )
    .join("");
}

/** A placeholder without a resolved name: "Person 3", or "a participant" for an ambiguous mention. */
export function personPlainLabel(ordinal: number | null): string {
  return ordinal === null ? "a participant" : `Person ${ordinal}`;
}

/** Spoken names for mask tokens: "[PHONE_1]" → "masked phone number 1". */
const TOKEN_NAMES: Record<string, string> = {
  PHONE: "phone number",
  EMAIL: "email address",
  UPI: "UPI handle",
  BANK: "bank account number",
  IFSC: "IFSC code",
  CARD: "card number",
  ID: "ID number",
  PASSWORD: "password",
  API_KEY: "API key",
  SECRET: "secret",
};

export function maskTokenLabel(token: string): string {
  const m = /^\[([A-Z_]+?)(?:_(\d+))?\]$/.exec(token);
  if (!m) return "masked detail";
  const name = TOKEN_NAMES[m[1]] ?? "detail";
  return m[2] ? `masked ${name} ${m[2]}` : `masked ${name}`;
}
