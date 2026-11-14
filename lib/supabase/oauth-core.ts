/**
 * Pure helpers for Google sign-in (Supabase OAuth, PKCE). No I/O, no secrets: unit-tested.
 */

/** Result of starting a Google sign-in, as returned to the browser. Messages are fixed and safe to show. */
export type GoogleStartResult = { status: "redirect"; url: string } | { status: "error"; message: string };

/**
 * The authorize URL Supabase returned must be our own project's Auth endpoint over HTTPS (or the local
 * Supabase stack over http), so a misconfigured client can never send the visitor anywhere else.
 */
export function isOwnAuthorizeUrl(url: string, supabaseUrl: string): boolean {
  try {
    const target = new URL(url);
    const project = new URL(supabaseUrl);
    if (target.origin !== project.origin) return false;
    if (target.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) return false;
    return target.pathname.startsWith("/auth/v1/authorize");
  } catch {
    return false;
  }
}

/** Login-page error tokens the callback can produce (shown by components/auth messages). */
export type CallbackErrorToken = "oauth_cancelled" | "oauth_failed" | "auth_callback_failed" | "auth_restart";

/**
 * Maps an OAuth error reported back to /auth/callback (`?error=…&error_code=…`) to a login-page token.
 * The visitor pressing "Cancel" at Google arrives as `error=access_denied`. Provider text is never shown.
 */
export function oauthErrorToken(error: string | null): CallbackErrorToken | null {
  if (!error) return null;
  return error === "access_denied" ? "oauth_cancelled" : "oauth_failed";
}

/** auth-js's error code when the PKCE verifier for the returned code is not in this browser. */
export const PKCE_VERIFIER_MISSING = "pkce_code_verifier_not_found";

/**
 * When sign-in starts on a different address than the trusted site origin (e.g. 127.0.0.1 vs localhost, or a
 * per-deployment Vercel URL), the PKCE verifier cookie is stored on that address while the callback runs on the
 * site origin, so the exchange can never succeed. Returns the URL on the site origin to continue from instead,
 * or null when the request is already on the site origin (or its host is unknown).
 */
export function canonicalRestartUrl(requestHost: string | null, siteOrigin: string, pathAndQuery: string): string | null {
  if (!requestHost) return null;
  let site: URL;
  try {
    site = new URL(siteOrigin);
  } catch {
    return null;
  }
  if (requestHost.toLowerCase() === site.host.toLowerCase()) return null;
  const target = new URL(pathAndQuery, site);
  // Never leave the trusted origin, whatever path is passed (e.g. a protocol-relative "//host").
  if (target.origin !== site.origin) return new URL("/login?continue=google", site).toString();
  target.searchParams.set("continue", "google");
  return target.toString();
}

/** User-facing text for the login page's `?error=` token. Unknown tokens show nothing. */
export const SIGN_IN_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  oauth_cancelled: "Google sign-in was cancelled. Continue with Google again when you're ready.",
  oauth_failed: "Google couldn't sign you in. Try again, or choose a different Google account.",
  auth_callback_failed: "That sign-in didn't complete. It may have expired or been used already, so please try again.",
  auth_restart: "That sign-in couldn't be matched to this browser. Please start again here, in the same browser.",
};
