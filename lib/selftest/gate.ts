/**
 * Owner allow-list for the /test self-check page (pure; safe to import from proxy.ts and tests).
 *
 * BATON_OWNER_EMAILS is a comma-separated list of email addresses. Entries are trimmed and compared
 * case-insensitively. Unset, empty or only separators means NOBODY is an owner (safe by default), so the page
 * is a 404 for everyone. Only a signed-in user whose email is CONFIRMED and in the list passes.
 */

export type OwnerEnv = Readonly<Record<string, string | undefined>>;

export interface OwnerCandidate {
  email: string | null;
  emailConfirmed: boolean;
}

/** The normalised allow-list (lower-case, trimmed, empty entries dropped). */
export function parseOwnerEmails(raw: string | undefined | null): ReadonlySet<string> {
  if (typeof raw !== "string") return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && s.includes("@")),
  );
}

/** True only for a signed-in user with a confirmed email that is on the allow-list. */
export function isOwner(user: OwnerCandidate | null | undefined, env: OwnerEnv = process.env): boolean {
  if (!user || !user.emailConfirmed || typeof user.email !== "string") return false;
  const email = user.email.trim().toLowerCase();
  if (email === "") return false;
  return parseOwnerEmails(env.BATON_OWNER_EMAILS).has(email);
}
