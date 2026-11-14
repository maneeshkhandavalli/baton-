/**
 * Magic-link callback (§11.7, §12.3). Supports both Supabase flows:
 *   * PKCE: ?code=…            → exchangeCodeForSession (the code verifier cookie was set when the link was requested)
 *   * OTP:  ?token_hash=…&type=… → verifyOtp (email template pointing at /auth/callback)
 *   * OAuth error: ?error=…&error_code=… (Google sign-in cancelled or refused) → /login?error=oauth_cancelled|oauth_failed
 * Redirects to a sanitised same-origin `next` path, or to /login?error=… on failure (§11.2 Auth).
 */

import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { oauthErrorToken, PKCE_VERIFIER_MISSING } from "@/lib/supabase/oauth-core";
import { loginPath, safeNextPath } from "@/lib/supabase/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite", "email_change", "recovery"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNextPath(url.searchParams.get("next")) ?? "/dashboard";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  // The provider reported an error (e.g. the visitor pressed Cancel at Google): nothing to exchange.
  const oauthError = !code && !tokenHash ? oauthErrorToken(url.searchParams.get("error")) : null;
  if (oauthError) {
    const response = NextResponse.redirect(new URL(loginPath(next, oauthError), request.url));
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  const supabase = await createSupabaseServerClient();
  let failed = true;
  let failure: { name?: string; status?: number; code?: string } | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
    if (error) failure = { name: error.name, status: error.status, code: error.code };
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = Boolean(error);
    if (error) failure = { name: error.name, status: error.status, code: error.code };
  }
  if (failed) {
    // Operators only: which step failed and why, never the code, token or cookie values.
    const verifierCookie = (request.cookies?.getAll() ?? []).some((c) => c.name.endsWith("-code-verifier") && c.value !== "");
    console.error("[auth] callback failed", { flow: code ? "pkce" : tokenHash ? "otp" : "none", verifierCookie, ...failure });
  }

  const target = failed ? loginPath(next, failure?.code === PKCE_VERIFIER_MISSING ? "auth_restart" : "auth_callback_failed") : next;
  const response = NextResponse.redirect(new URL(target, request.url));
  response.headers.set("Referrer-Policy", "no-referrer"); // the URL may carry a token path in `next`
  return response;
}
