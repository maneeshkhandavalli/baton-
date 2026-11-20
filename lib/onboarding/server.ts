import "server-only";

/**
 * Round 4 (Worker 02): reads and writes the onboarding value in the signed-in user's Supabase Auth
 * `user_metadata` with the user's OWN server client (their session cookie; never the service role). Reads ask
 * the Auth server (getUser), never a decoded cookie. Call only inside <Suspense> or a Server Function.
 */

import type { OnboardingDeps, OnboardingStore } from "../actions/core/onboarding";
import { requireVerifiedActor } from "../supabase/auth";
import { createSupabaseServerClient } from "../supabase/server";
import { ONBOARDING_METADATA_KEY, onboardingFromMetadata, type OnboardingState } from "./state";

export interface SessionOnboarding {
  userId: string;
  state: OnboardingState;
  /** The profile's display name (for the welcome), never shown elsewhere. */
  firstName: string | null;
}

function firstNameOf(meta: Record<string, unknown> | undefined): string | null {
  for (const key of ["display_name", "full_name", "name"]) {
    const v = meta?.[key];
    if (typeof v === "string" && v.trim()) return v.trim().split(/\s+/)[0].slice(0, 40);
  }
  return null;
}

/** The signed-in user's onboarding value, or null when signed out (or Auth is unreachable). */
export async function readSessionOnboarding(): Promise<SessionOnboarding | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;
    if (error || !user) return null;
    return { userId: user.id, state: onboardingFromMetadata(user.user_metadata), firstName: firstNameOf(user.user_metadata) };
  } catch {
    return null;
  }
}

const store: OnboardingStore = Object.freeze({
  async read() {
    const s = await readSessionOnboarding();
    return s ? { userId: s.userId, state: s.state } : null;
  },
  async write(state: OnboardingState) {
    const supabase = await createSupabaseServerClient();
    // updateUser merges top-level metadata keys: only ours changes; the profile's name etc. are untouched.
    const { error } = await supabase.auth.updateUser({ data: { [ONBOARDING_METADATA_KEY]: state } });
    if (error) throw new Error("onboarding_write_failed");
  },
});

const DEPS: OnboardingDeps = Object.freeze({ getActor: requireVerifiedActor, store, now: () => new Date().toISOString() });

export function onboardingDeps(): OnboardingDeps {
  return DEPS;
}
