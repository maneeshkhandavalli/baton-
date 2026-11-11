/**
 * Magic-link callback (§11.7, §12.3). Supports both Supabase flows:
 *   * PKCE: ?code=…            → exchangeCodeForSession (the code verifier cookie was set when the link was requested)
 *   * OTP:  ?token_hash=…&type=… → verifyOtp (email template pointing at /auth/callback)
 * Redirects to a sanitised same-origin `next` path, or to /login?error=… on failure (§11.2 Auth).
 */

import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { loginPath, safeNextPath } from "@/lib/supabase/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const OTP_TYPES: readonly EmailOtpType[] = ["email", "magiclink", "signup", "invite", "email_change", "recovery"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const next = safeNextPath(url.searchParams.get("next")) ?? "/dashboard";
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const supabase = await createSupabaseServerClient();
  let failed = true;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failed = Boolean(error);
  } else if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    failed = Boolean(error);
  }

  const target = failed ? loginPath(next, "auth_callback_failed") : next;
  const response = NextResponse.redirect(new URL(target, request.url));
  response.headers.set("Referrer-Policy", "no-referrer"); // the URL may carry a token path in `next`
  return response;
}
