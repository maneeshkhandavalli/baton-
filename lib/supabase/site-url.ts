/**
 * The application's trusted public URL (audit finding M1).
 *
 * Magic-link and invitation redirect destinations are built ONLY from this configured value, never from
 * request headers (Host / X-Forwarded-Host can be forged). The Supabase project's Redirect URL allow-list
 * must contain exactly `${BATON_SITE_URL}/auth/callback` (no wildcards).
 *
 * Proposal for main (§13.3, `.env.example` is main-owned): add `BATON_SITE_URL`, a server-only variable,
 * e.g. `BATON_SITE_URL=http://localhost:3000` in development and the https origin in each environment.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Accepts only a bare origin: https://host[:port], or http:// for localhost. No credentials, path,
 * query or fragment. Returns the normalised origin, or null if the value is unsafe.
 */
export function parseSiteUrl(value: string | undefined | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.origin;
  return null;
}

/** The configured site origin. Throws (fail closed) when it is missing or unsafe. */
export function getSiteUrl(): string {
  const origin = parseSiteUrl(process.env.BATON_SITE_URL);
  if (!origin) {
    throw new Error("BATON_SITE_URL is not configured as a safe absolute origin.");
  }
  return origin;
}

/** `${site}/auth/callback?next=<safe relative path>` built from the trusted origin only. */
export function authCallbackUrl(next: string | null): string {
  const callback = new URL("/auth/callback", getSiteUrl());
  if (next) callback.searchParams.set("next", next);
  return callback.toString();
}
