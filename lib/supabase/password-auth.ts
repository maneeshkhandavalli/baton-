import "server-only";

/**
 * Email + password sign-in on Supabase Auth's own functionality (signInWithPassword, signUp,
 * resetPasswordForEmail, updateUser). Sessions are written to this browser's cookies by the server client,
 * exactly like Google sign-in, so the rest of the app (proxy, RLS, actors) is unchanged.
 *
 * Privacy: no message ever says whether an address has an account. Sign-up and reset always give the same
 * answer; sign-in failures are "email or password is incorrect". Supabase links an email + password identity
 * and a Google identity with the same verified address to ONE user, so there are no duplicate accounts.
 */

import { z } from "zod";

import { DEMO_ACCOUNT_REFUSAL, isDemoAccountEmail } from "../demo-accounts";
import { createSupabaseServerClient } from "./server";
import { authCallbackUrl } from "./site-url";

export const PASSWORD_MIN = 8;

export type PasswordResult = { status: "ok"; message?: string } | { status: "error"; message: string; field?: "email" | "password" | "confirm" };

const email = z.email().max(254);

const GENERIC = "Something went wrong on our side. Please try again.";
const RATE_LIMITED = "Too many attempts. Please wait a minute and try again.";

function logFailure(step: string, error: { status?: number; code?: string } | null) {
  console.error(`[auth] ${step} failed`, { status: error?.status ?? null, code: error?.code ?? null });
}

/** A password Baton accepts (Supabase may add its own strength rules on top). */
export function checkNewPassword(password: unknown, confirm: unknown): PasswordResult | null {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return { status: "error", field: "password", message: `Use at least ${PASSWORD_MIN} characters.` };
  }
  if (password.length > 72) return { status: "error", field: "password", message: "Use at most 72 characters." };
  if (confirm !== password) return { status: "error", field: "confirm", message: "The two passwords don't match." };
  return null;
}

export async function passwordSignIn(rawEmail: unknown, password: unknown): Promise<PasswordResult> {
  const parsed = email.safeParse(typeof rawEmail === "string" ? rawEmail.trim() : rawEmail);
  if (!parsed.success) return { status: "error", field: "email", message: "Enter a valid email address." };
  if (typeof password !== "string" || password.length === 0) return { status: "error", field: "password", message: "Enter your password." };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: parsed.data, password });
  if (!error) return { status: "ok" };
  if (error.status === 429 || error.code === "over_request_rate_limit") return { status: "error", message: RATE_LIMITED };
  if (error.code === "email_not_confirmed") {
    return { status: "error", message: "Confirm your email address first: open the link we emailed you, then sign in." };
  }
  if (error.code === "invalid_credentials" || error.status === 400) {
    return { status: "error", message: "That email and password don't match. Try again, or set a new password." };
  }
  logFailure("signInWithPassword", error);
  return { status: "error", message: GENERIC };
}

export async function passwordSignUp(rawEmail: unknown, password: unknown, confirm: unknown, next: string | null): Promise<PasswordResult> {
  const parsed = email.safeParse(typeof rawEmail === "string" ? rawEmail.trim() : rawEmail);
  if (!parsed.success) return { status: "error", field: "email", message: "Enter a valid email address." };
  const bad = checkNewPassword(password, confirm);
  if (bad) return bad;
  let emailRedirectTo: string;
  try {
    emailRedirectTo = authCallbackUrl(next);
  } catch {
    console.error("[auth] BATON_SITE_URL is missing or unsafe; refusing to sign up");
    return { status: "error", message: GENERIC };
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email: parsed.data, password: password as string, options: { emailRedirectTo } });
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit" || error?.code === "over_request_rate_limit") {
    return { status: "error", message: RATE_LIMITED };
  }
  if (error?.code === "weak_password") return { status: "error", field: "password", message: "Choose a stronger password: longer, and not a common one." };
  if (error && error.code !== "user_already_exists") {
    logFailure("signUp", error);
    return { status: "error", message: GENERIC };
  }
  // Signed in straight away only when the project does not require email confirmation.
  if (data?.session) return { status: "ok" };
  // Same answer whether or not the address already has an account (Supabase obfuscates existing users too).
  return {
    status: "ok",
    message: "Check your email to confirm your address, then sign in. If you already have an account, sign in or set a new password instead.",
  };
}

export async function requestPasswordSetup(rawEmail: unknown): Promise<PasswordResult> {
  const parsed = email.safeParse(typeof rawEmail === "string" ? rawEmail.trim() : rawEmail);
  if (!parsed.success) return { status: "error", field: "email", message: "Enter a valid email address." };
  let redirectTo: string;
  try {
    redirectTo = authCallbackUrl("/account/password");
  } catch {
    console.error("[auth] BATON_SITE_URL is missing or unsafe; refusing to send a reset link");
    return { status: "error", message: GENERIC };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo });
  if (error?.status === 429 || error?.code === "over_email_send_rate_limit") return { status: "error", message: RATE_LIMITED };
  if (error) logFailure("resetPasswordForEmail", error); // never shown: the answer below is the same either way
  return { status: "ok", message: "If an account uses that address, we've emailed a link to set a new password. It can take a minute to arrive." };
}

/** For the signed-in user (after Google sign-in, a reset link, or a normal session). */
export async function setOwnPassword(password: unknown, confirm: unknown): Promise<PasswordResult> {
  const bad = checkNewPassword(password, confirm);
  if (bad) return bad;
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { status: "error", message: "Your session has ended. Sign in again, then set your password." };
  // Shared demo accounts keep their published password (lib/demo-accounts.ts).
  if (isDemoAccountEmail(userData.user.email)) return { status: "error", message: DEMO_ACCOUNT_REFUSAL };
  const { error } = await supabase.auth.updateUser({ password: password as string });
  if (!error) return { status: "ok", message: "Your password is set. You can now sign in with your email and password, or with Google." };
  if (error.code === "same_password") return { status: "error", field: "password", message: "That's your current password. Choose a different one." };
  if (error.code === "weak_password") return { status: "error", field: "password", message: "Choose a stronger password: longer, and not a common one." };
  if (error.code === "reauthentication_needed") {
    return { status: "error", message: "For security, use \"Forgot or never set a password?\" on the sign-in page to get a link, then set it from there." };
  }
  if (error.status === 429) return { status: "error", message: RATE_LIMITED };
  logFailure("updateUser(password)", error);
  return { status: "error", message: GENERIC };
}
