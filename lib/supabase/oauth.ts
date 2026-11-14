import "server-only";

/**
 * Google sign-in (Supabase OAuth, PKCE), started on the server so it reuses Baton's session architecture:
 *   - the redirect destination is built ONLY from BATON_SITE_URL (authCallbackUrl, audit M1), never from
 *     request headers, so localhost, Vercel Preview and Production each return to their own origin;
 *   - the server Supabase client stores the PKCE code verifier in this browser's cookies, and the existing
 *     /auth/callback route exchanges the returned code for a session (exchangeCodeForSession);
 *   - no email is involved, so it does not depend on the email provider.
 * Supabase links a Google identity to an existing user with the same verified email address (its automatic
 * identity linking), so an existing account signs in to the same account rather than a duplicate.
 */

import { getSupabasePublicEnv } from "./env";
import { isOwnAuthorizeUrl, type GoogleStartResult } from "./oauth-core";
import { createSupabaseServerClient } from "./server";
import { authCallbackUrl } from "./site-url";

const START_FAILED = "We couldn't start Google sign-in. Please try again in a moment.";

/**
 * `next` must already be a sanitised same-origin path (safeNextPath) or null. The same-host check (the PKCE
 * verifier cookie must live on the callback's host) happens in the browser: GoogleSignInButton `siteOrigin`.
 */
export async function startGoogleOAuth(next: string | null): Promise<GoogleStartResult> {
  let redirectTo: string;
  try {
    redirectTo = authCallbackUrl(next);
  } catch {
    console.error("[auth] BATON_SITE_URL is missing or unsafe; refusing to start Google sign-in");
    return { status: "error", message: "Sign-in isn't available on this site right now." };
  }
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true, queryParams: { prompt: "select_account" } },
    });
    if (error || !data?.url) {
      // Never log provider text; status and code only.
      console.error("[auth] signInWithOAuth failed", { status: error?.status ?? null, code: error?.code ?? null });
      return { status: "error", message: START_FAILED };
    }
    if (!isOwnAuthorizeUrl(data.url, getSupabasePublicEnv().url)) {
      console.error("[auth] signInWithOAuth returned an unexpected URL; refusing to redirect");
      return { status: "error", message: START_FAILED };
    }
    return { status: "redirect", url: data.url };
  } catch {
    console.error("[auth] Google sign-in could not start");
    return { status: "error", message: START_FAILED };
  }
}
