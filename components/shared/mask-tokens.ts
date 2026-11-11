/**
 * Splits stored text into plain text, mask tokens and excluded-participant tokens (§12.1, D31).
 *
 * Only the canonical mask tokens count as masks: `[PHONE_n]`, `[EMAIL_n]`, `[UPI_n]`, `[BANK_n]`,
 * `[IFSC_n]`, `[CARD_n]`, `[ID_n]`, `[PASSWORD]`, `[API_KEY]` and `[SECRET]`. `[EXCLUDED_PARTICIPANT]`
 * is a separate parser token: never a mask, never numbered. Any other bracketed text is left as is.
 */

import { EXCLUDED_PARTICIPANT_TOKEN } from "@/lib/contracts/parser";

export type MaskedSegment =
  | { kind: "text"; text: string }
  | { kind: "mask"; token: string }
  | { kind: "excluded_participant" };

const NUMBERED = ["PHONE", "EMAIL", "UPI", "BANK", "IFSC", "CARD", "ID"];
const UNNUMBERED = ["PASSWORD", "API_KEY", "SECRET"];

const MASK_TOKEN = new RegExp(`^\\[(?:(?:${NUMBERED.join("|")})_\\d+|${UNNUMBERED.join("|")})\\]$`);
const ANY_TOKEN = new RegExp(`(\\[(?:(?:${NUMBERED.join("|")})_\\d+|${UNNUMBERED.join("|")}|EXCLUDED_PARTICIPANT)\\])`, "g");

export const isMaskToken = (s: string) => MASK_TOKEN.test(s);

export function segmentMaskedText(text: string): MaskedSegment[] {
  const out: MaskedSegment[] = [];
  for (const part of text.split(ANY_TOKEN)) {
    if (part === "") continue;
    if (part === EXCLUDED_PARTICIPANT_TOKEN) out.push({ kind: "excluded_participant" });
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
    .map((s) => (s.kind === "text" ? s.text : s.kind === "mask" ? s.token : "excluded participant"))
    .join("");
}
