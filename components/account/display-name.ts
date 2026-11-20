/**
 * Round 4 audit D1: the name other members see. Mirrors set_own_display_name (20261121300200) so the form can say
 * what's wrong before the round trip; the database enforces the same rules. Pure, no I/O.
 */

export const DISPLAY_NAME_MAX = 60;

export type DisplayNameCheck = { ok: true; name: string } | { ok: false; message: string };

export function normaliseDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function checkDisplayName(raw: unknown): DisplayNameCheck {
  if (typeof raw !== "string") return { ok: false, message: "Enter a name." };
  const name = normaliseDisplayName(raw);
  if (name.length === 0) return { ok: false, message: "Enter a name." };
  if (name.length > DISPLAY_NAME_MAX) return { ok: false, message: `Use at most ${DISPLAY_NAME_MAX} characters.` };
  if (/[\u0000-\u001f\u007f]/.test(name) || /[[\]]/.test(name)) return { ok: false, message: "Use letters, numbers and ordinary punctuation (no square brackets)." };
  if (name.toLowerCase() === "former member") return { ok: false, message: "That name is reserved. Choose another." };
  return { ok: true, name };
}
