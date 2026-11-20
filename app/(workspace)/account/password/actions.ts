"use server";

/**
 * Set or change the signed-in user's password (Supabase updateUser). Used after Google sign-in or a reset link.
 * Round 4 audit A2: an account that already has a password must give the current one first (reauthentication),
 * unless it just signed in through a "set a new password" email link. Google-only accounts set one directly.
 * When whether a password exists can't be read, the current one is required too (fail closed), and a check that
 * can't be done refuses with a retryable error.
 */

import { createClient } from "@supabase/supabase-js";

import { needsCurrentPassword, nowSeconds } from "@/components/account/password-mode";
import { serverDb } from "@/lib/db";
import { getVerifiedActor } from "@/lib/db/actor";
import { accountHasPassword } from "@/lib/db/mutations";
import { DEMO_ACCOUNT_REFUSAL, isDemoAccountEmail } from "@/lib/demo-accounts";
import { readSessionAmr } from "@/lib/supabase/account-auth";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { setOwnPassword, type PasswordResult } from "@/lib/supabase/password-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type PasswordFormResult = PasswordResult | { status: "error"; message: string; field: "current" };

const GENERIC = "Something went wrong on our side. Please try again.";

/**
 * Checks the current password on a throwaway, cookie-less client, then ends that check's session. Never throws:
 * a check that couldn't be done is "error" (the caller refuses; never treated as a match).
 */
async function currentPasswordMatches(email: string, password: string): Promise<"ok" | "wrong" | "rate_limited" | "error"> {
  try {
    const { url, anonKey } = getSupabasePublicEnv();
    const probe = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await probe.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.status === 429 || error.code === "over_request_rate_limit") return "rate_limited";
      if (error.code === "invalid_credentials" || error.status === 400) return "wrong";
      console.error("[auth] current password check failed", { status: error.status ?? null, code: error.code ?? null });
      return "error";
    }
    if (data.session) await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
    return "ok";
  } catch {
    console.error("[auth] current password check failed", { status: null, code: "unreachable" });
    return "error";
  }
}

export async function setPassword(password: string, confirm: string, current?: string): Promise<PasswordFormResult> {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { status: "error", message: "Your session has ended. Sign in again, then set your password." };
  if (isDemoAccountEmail(user.email)) return { status: "error", message: DEMO_ACCOUNT_REFUSAL };

  let hasPassword: boolean | null = null;
  try {
    const actor = await getVerifiedActor();
    if (actor) hasPassword = await accountHasPassword(serverDb(), actor);
  } catch {
    hasPassword = null;
  }
  const amr = await readSessionAmr(supabase);

  // Same rule as the page (password-mode.ts): required unless the account has no password or this is a fresh
  // recovery sign-in; hasPassword null (couldn't be read) requires it.
  const required = needsCurrentPassword(hasPassword, amr, nowSeconds());
  if (required) {
    if (!current) return { status: "error", field: "current", message: "Enter your current password." };
    if (!user.email) return { status: "error", message: GENERIC };
    const check = await currentPasswordMatches(user.email, current);
    if (check === "wrong") return { status: "error", field: "current", message: "That isn't your current password." };
    if (check === "rate_limited") return { status: "error", message: "Too many attempts. Please wait a minute and try again." };
    if (check === "error") return { status: "error", message: GENERIC };
  }
  return setOwnPassword(password, confirm);
}
