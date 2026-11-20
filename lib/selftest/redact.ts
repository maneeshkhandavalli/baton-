/**
 * Defence in depth for the /test page: every row is passed through `redactRows` before it is rendered, so a
 * secret value that slipped into a detail string (e.g. a provider error echoing a token) is replaced.
 * Checks are written to never include secrets in the first place; this is the second line.
 */

import type { CheckRow, CheckSection, SelfTestEnv } from "./types";

/** Env names whose VALUES are secret (names themselves are fine to show). */
const SECRET_NAME = /(KEY|SECRET|TOKEN|PEPPER|PASSWORD|PRIVATE|CREDENTIAL)/i;
const MIN_REDACT_LENGTH = 8;

export function secretValues(env: SelfTestEnv): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!SECRET_NAME.test(name) || typeof value !== "string") continue;
    for (const v of [value, value.trim(), value.replace(/\\n/g, "\n")]) {
      if (v.length >= MIN_REDACT_LENGTH) out.add(v);
    }
    // multi-line keys: also each long line
    for (const line of value.replace(/\\n/g, "\n").split(/\r?\n/)) {
      if (line.trim().length >= 16) out.add(line.trim());
    }
  }
  // longest first, so a value that contains another is replaced whole
  return [...out].sort((a, b) => b.length - a.length);
}

export function redactText(text: string, secrets: readonly string[]): string {
  let s = text;
  for (const secret of secrets) if (s.includes(secret)) s = s.split(secret).join("[redacted]");
  return s;
}

export function redactRows(rows: CheckRow[], secrets: readonly string[]): CheckRow[] {
  return rows.map((r) => ({ ...r, name: redactText(r.name, secrets), detail: redactText(r.detail, secrets) }));
}

export function redactSections(sections: CheckSection[], secrets: readonly string[]): CheckSection[] {
  return sections.map((s) => ({ ...s, rows: redactRows(s.rows, secrets), note: s.note === undefined ? undefined : redactText(s.note, secrets) }));
}

/** The host of a URL, or null. Never returns credentials, path or query. */
export function hostOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}
