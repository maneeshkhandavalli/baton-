import "server-only";

/**
 * The auth side of account deletion (§12.9) and the Account page's details. Server-only: the service-role
 * client never leaves this module's callers, and nothing here logs a secret, token, email address or name.
 *
 * Soft delete: the profile row must survive anonymised (memberships, sources, publications and access tokens
 * reference it, and profiles.id → auth.users is ON DELETE RESTRICT), so the auth user is soft-deleted with the
 * Admin API (deleteUser(id, true)): Supabase scrubs its email, phone and identities, ends its sessions and keeps
 * the row with deleted_at set. The address can then be used for a brand-new account.
 */

import { cookies } from "next/headers";

import { serverDb } from "../db";
import { getVerifiedActor } from "../db/actor";
import { accountHasPassword } from "../db/mutations";
import { createSupabaseAdminClient } from "./admin";
import { createSupabaseServerClient } from "./server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Soft-deletes the auth user, retrying transient failures. Throws when it could not be done. */
export async function softDeleteAuthUser(profileId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  let last: { status: number | null; code: string | null } = { status: null, code: null };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { error } = await admin.auth.admin.deleteUser(profileId, true);
      if (!error) return;
      if (error.status === 404) return; // already gone (a retried request)
      last = { status: error.status ?? null, code: error.code ?? null };
      if (error.status && error.status >= 400 && error.status < 500 && error.status !== 429) break; // not transient
    } catch {
      last = { status: null, code: "network" };
    }
    await sleep(250 * attempt);
  }
  console.error("[account] auth user soft delete failed", last);
  throw new Error("auth user deletion failed");
}

/** Ends this browser's session: Supabase sign-out, then any leftover Supabase cookie. Never throws. */
export async function endBrowserSession(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // the user may already be gone; the cookies are removed below either way
  }
  try {
    const jar = await cookies();
    for (const c of jar.getAll()) if (c.name.startsWith("sb-")) jar.delete(c.name);
  } catch {
    // outside a request (tests)
  }
}

/** Server log for a cleanup step that failed after the point of no return. Ids and counts only. */
export function logAccountIssue(event: string, details: Record<string, string | number>): void {
  console.error(`[account] ${event}`, details);
}

export type SignInProvider = "google" | "email";

export interface AccountOverview {
  email: string | null;
  emailConfirmed: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  /** Identity providers linked to the account (Supabase identities and app_metadata.providers). */
  providers: SignInProvider[];
  /** Whether a password is set; null when it could not be read (migration not applied yet). */
  hasPassword: boolean | null;
}

/** The signed-in user's own account details, or null when signed out. */
export async function getAccountOverview(): Promise<AccountOverview | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user) return null;

  const raw = new Set<string>([
    ...(user.identities ?? []).map((i) => i.provider),
    ...(Array.isArray(user.app_metadata?.providers) ? (user.app_metadata.providers as unknown[]) : []).filter((p): p is string => typeof p === "string"),
  ]);
  const providers = (["google", "email"] as const).filter((p) => raw.has(p));

  let hasPassword: boolean | null = null;
  try {
    const actor = await getVerifiedActor();
    if (actor) hasPassword = await accountHasPassword(serverDb(), actor);
  } catch {
    hasPassword = null;
  }

  return {
    email: user.email ?? null,
    emailConfirmed: typeof user.email_confirmed_at === "string" && user.email_confirmed_at.length > 0,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    providers,
    hasPassword,
  };
}
